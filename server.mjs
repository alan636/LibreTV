import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createLogger } from './logger.mjs';

dotenv.config();

const logger = createLogger({ scope: 'server' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isHostedRuntime = Boolean(
  process.env.RENDER ||
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.FLY_APP_NAME
);
const defaultHost = isHostedRuntime ? '0.0.0.0' : '127.0.0.1';
const parsedPort = Number.parseInt(process.env.PORT || '8080', 10);

const config = {
  host: process.env.HOST || defaultHost,
  port: Number.isInteger(parsedPort) ? parsedPort : 8080,
  password: process.env.PASSWORD || '112233',
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
  if (!fs.existsSync(filePath)) {
    throw new Error(`页面文件不存在: ${filePath}`);
  }

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
    logger.error('页面渲染错误', {
      status: 'FAIL',
      error: error.message
    });
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    logger.error('搜索页面渲染错误', {
      status: 'FAIL',
      error: error.message
    });
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

function validateTimestamp(timestamp) {
  if (!timestamp) {
    return { ok: true };
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  const now = Date.now();
  const maxAge = 10 * 60 * 1000;
  if (now - parsedTimestamp > maxAge) {
    return { ok: false, reason: 'expired_timestamp' };
  }

  return { ok: true };
}

// 验证代理请求的鉴权
function validateProxyAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  const serverPassword = config.password;

  if (!serverPassword) {
    logger.warn('鉴权配置缺失', {
      reason: 'missing_server_password',
      message: '未设置 PASSWORD 环境变量，禁用代理'
    });
    return { ok: false, reason: 'missing_server_password' };
  }

  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  if (!authHash) {
    return { ok: false, reason: 'missing_auth_hash' };
  }

  if (authHash !== serverPasswordHash) {
    return { ok: false, reason: 'auth_hash_mismatch' };
  }

  const timestampValidation = validateTimestamp(timestamp);
  if (!timestampValidation.ok) {
    return timestampValidation;
  }

  return { ok: true };
}

app.get('/proxy/:encodedUrl', async (req, res) => {
  const encodedUrl = req.params.encodedUrl;
  const targetUrl = decodeURIComponent(encodedUrl);

  try {
    // 验证鉴权
    const authResult = validateProxyAuth(req);
    if (!authResult.ok) {
      logger.warn('鉴权失败', {
        tag: 'AUTH_FAIL',
        reason: authResult.reason,
        targetUrl,
        hasAuth: Boolean(req.query.auth),
        hasTimestamp: Boolean(req.query.t)
      });
      return res.status(401).json({ success: false, error: '代理访问未授权' });
    }

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      logger.warn('非法 URL', {
        tag: 'INVALID_URL',
        targetUrl
      });
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

    logger.success('代理完成', {
      targetUrl,
      durationMs: Date.now() - startTime
    });

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

    logger.error('代理请求失败', {
      status,
      error: errorMsg,
      targetUrl,
      requestTimeout: config.timeout,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });

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
  logger.error('服务器内部错误', {
    status: 500,
    method: req.method,
    path: req.originalUrl,
    error: err.stack || err.message
  });
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

function buildListenErrorDetails(error) {
  return {
    code: error.code,
    syscall: error.syscall,
    address: error.address || config.host,
    port: error.port || config.port,
    message: error.message
  };
}

function getListenErrorHint(error) {
  if (error.code === 'EACCES') {
    return '当前环境禁止监听该地址/端口，请尝试修改 HOST 或 PORT，或检查系统安全策略';
  }

  if (error.code === 'EADDRINUSE') {
    return '端口已被占用，请更换 PORT 或停止占用该端口的进程';
  }

  return '请根据错误码检查监听地址、端口和运行环境权限';
}

function logStartupSummary(address) {
  const resolvedHost = typeof address === 'object' && address?.address ? address.address : config.host;
  const resolvedPort = typeof address === 'object' && address?.port ? address.port : config.port;
  const accessHost = resolvedHost === '0.0.0.0' ? 'localhost' : resolvedHost;

  logger.info('服务器启动成功', {
    url: `http://${accessHost}:${resolvedPort}`,
    bindAddress: resolvedHost,
    bindPort: resolvedPort,
    runtime: isHostedRuntime ? 'hosted' : 'local'
  });

  if (config.password !== '') {
    logger.info('安全运行模式: 访问控制已启用');
  } else {
    logger.warn('警告: 未设置 PASSWORD 环境变量，处于低安全性模式');
  }

  logger.info('启动配置', {
    host: config.host,
    port: resolvedPort,
    corsOrigin: config.corsOrigin,
    timeout: config.timeout,
    cacheMaxAge: config.cacheMaxAge,
    debug: config.debug
  });
}

function buildCandidatePorts() {
  const ports = [config.port];

  if (!process.env.PORT && !isHostedRuntime) {
    ports.push(5173, 3000, 4173);
  }

  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0))];
}

function isRetryableListenError(error) {
  return error.code === 'EACCES' || error.code === 'EADDRINUSE';
}

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 异常', {
    tag: 'UNHANDLED_REJECTION',
    reason
  });
});

process.on('uncaughtException', (error) => {
  logger.error('未捕获异常导致服务异常', {
    tag: 'UNCAUGHT_EXCEPTION',
    error
  });
  process.exitCode = 1;
});

const candidatePorts = buildCandidatePorts();

function startServer(portIndex = 0) {
  const listenPort = candidatePorts[portIndex];
  const server = app.listen(listenPort, config.host);

  server.on('listening', () => {
    config.port = listenPort;
    logStartupSummary(server.address());
  });

  server.on('error', (error) => {
    const details = buildListenErrorDetails({ ...error, port: listenPort });
    const hasNextPort = portIndex < candidatePorts.length - 1;

    logger.error('服务器启动失败', {
      tag: 'LISTEN_FAIL',
      ...details
    });

    if (hasNextPort && isRetryableListenError(error)) {
      const nextPort = candidatePorts[portIndex + 1];
      logger.warn('监听失败，尝试备用端口', {
        failedPort: listenPort,
        nextPort,
        reason: error.code
      });
      startServer(portIndex + 1);
      return;
    }

    logger.warn('启动失败提示', getListenErrorHint(error));
    process.exitCode = 1;
  });

  server.on('close', () => {
    logger.warn('HTTP 服务已关闭', `${config.host}:${listenPort}`);
  });
}

startServer();

