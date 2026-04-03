import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import logger from './logger.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

function sha256Hash(input) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    resolve(hash.digest('hex'));
  });
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (password !== '') {
    const sha256 = await sha256Hash(password);
    content = content.replace('{{PASSWORD}}', sha256);
  } else {
    content = content.replace('{{PASSWORD}}', '');
  }
  return content;
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    logger.error('FAIL', '页面渲染错误', error.message);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    logger.error('FAIL', '搜索页面渲染错误', error.message);
    res.status(500).send('读取静态页面失败');
  }
});

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    if (blockedHostnames.includes(parsed.hostname)) return false;
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 验证代理请求的鉴权
function validateProxyAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  const serverPassword = config.password;
  
  if (!serverPassword) {
    logger.warn('鉴权配置缺失', '未设置 PASSWORD 环境变量，禁用代理');
    return false;
  }
  
  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  if (!authHash || authHash !== serverPasswordHash) {
    return false;
  }
  
  // 验证时间戳（10分钟有效期）
  if (timestamp) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;
    if (now - parseInt(timestamp) > maxAge) {
      return false;
    }
  }
  return true;
}

app.get('/proxy/:encodedUrl', async (req, res) => {
  const encodedUrl = req.params.encodedUrl;
  const targetUrl = decodeURIComponent(encodedUrl);

  try {
    // 验证鉴权
    if (!validateProxyAuth(req)) {
      logger.warn('[AUTH_FAIL] 鉴权失败', targetUrl);
      return res.status(401).json({ success: false, error: '代理访问未授权' });
    }

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      logger.warn('[INVALID_URL] 非法URL', targetUrl);
      return res.status(400).send('无效的 URL');
    }

    // 智能请求头伪装
    const headers = {
      'User-Agent': config.userAgent,
      'Accept': '*/*',
      'Cache-Control': 'no-cache'
    };

    // 针对豆瓣的特殊伪装
    if (targetUrl.includes('doubanio.com') || targetUrl.includes('douban.com')) {
      headers['Referer'] = 'https://movie.douban.com/';
      headers['Host'] = new URL(targetUrl).hostname;
    }

    const startTime = Date.now();
    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      timeout: config.timeout,
      headers: headers
    });

    logger.success(`代理完成: ${targetUrl}`, Date.now() - startTime);

    const respHeaders = { ...response.headers };
    ['content-security-policy', 'cookie', 'set-cookie', 'x-frame-options', 'access-control-allow-origin'].forEach(h => delete respHeaders[h]);
    
    res.set(respHeaders);
    response.data.pipe(res);

  } catch (error) {
    const status = error.response ? error.response.status : 'ECONN';
    let errorMsg = error.message;
    
    if (status === 429) errorMsg = '触发频率限制 (Too Many Requests)';
    if (status === 403) errorMsg = '访问被拒绝 (Forbidden)';
    if (status === 418) errorMsg = '被识别为机器人 (I\'m a teapot)';

    logger.error(status, errorMsg, targetUrl);
    
    if (error.response) {
      res.status(status).send(`目标服务器返回错误: ${status}`);
    } else {
      res.status(500).send(`请求异常: ${error.message}`);
    }
  }
});

app.use(express.static(path.join(__dirname), {
  maxAge: config.cacheMaxAge
}));

app.use((err, req, res, next) => {
  logger.error(500, '服务器内部错误', err.message);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  logger.info(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    logger.info('安全运行模式: 访问控制已启用');
  } else {
    logger.warn('警告: 未设置 PASSWORD 环境变量，处于低安全性模式');
  }
  if (config.debug) {
    logger.debug('配置概况:', { ...config, password: '******' });
  }
});

