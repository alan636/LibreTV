import fetch from 'node-fetch';
import crypto from 'crypto';
import { createLogger } from '../../logger.mjs';
import {
  isM3u8ContentType,
  isM3u8Text,
  looksLikeM3u8Url,
  rewriteM3u8Content
} from '../../media-proxy-utils.mjs';

const logger = createLogger({
  scope: 'vercel-media-proxy',
  debugEnabled: process.env.DEBUG === 'true'
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
    return true;
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  return Date.now() - parsedTimestamp <= 10 * 60 * 1000;
}

function validateAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  const serverPassword = process.env.PASSWORD;

  if (!serverPassword) {
    return false;
  }

  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  return authHash === serverPasswordHash && validateTimestamp(timestamp);
}

function getEncodedPath(req) {
  const pathData = req.query['...path'];
  if (Array.isArray(pathData)) {
    return pathData.join('/');
  }
  if (typeof pathData === 'string') {
    return pathData;
  }
  if (req.url && req.url.startsWith('/media-proxy/')) {
    return req.url.substring('/media-proxy/'.length).split('?')[0];
  }
  return '';
}

function getTargetUrlFromPath(encodedPath) {
  if (!encodedPath) return null;
  try {
    const decodedUrl = decodeURIComponent(encodedPath);
    if (/^https?:\/\/.+/i.test(decodedUrl)) {
      return decodedUrl;
    }
    if (/^https?:\/\/.+/i.test(encodedPath)) {
      return encodedPath;
    }
    return null;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(req, targetUrl) {
  const headers = {
    'User-Agent': process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': req.headers.accept || '*/*',
    'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': req.headers.referer || new URL(targetUrl).origin,
    'Cache-Control': 'no-cache'
  };

  ['range', 'if-range', 'if-none-match', 'if-modified-since'].forEach((headerName) => {
    if (req.headers[headerName]) {
      headers[headerName] = req.headers[headerName];
    }
  });

  return headers;
}

function sanitizeHeaders(responseHeaders, { rewritten = false } = {}) {
  const headers = {};
  responseHeaders.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.startsWith('access-control-') ||
      lowerKey === 'set-cookie' ||
      lowerKey === 'content-encoding' ||
      lowerKey === 'transfer-encoding'
    ) {
      return;
    }

    if (rewritten && lowerKey === 'content-length') {
      return;
    }

    headers[key] = value;
  });
  return headers;
}

function pipeStreamToResponse(stream, res) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    res.on('finish', resolve);
    res.on('close', resolve);
    stream.pipe(res);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).setHeader('Access-Control-Max-Age', '86400').end();
    return;
  }

  let targetUrl = null;

  try {
    if (!validateAuth(req)) {
      res.status(401).json({ success: false, error: '视频转发未授权' });
      return;
    }

    const encodedPath = getEncodedPath(req);
    targetUrl = getTargetUrlFromPath(encodedPath);

    if (!targetUrl || !isValidUrl(targetUrl)) {
      res.status(400).send('无效的 URL');
      return;
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: buildUpstreamHeaders(req, targetUrl),
      redirect: 'follow'
    });

    const contentType = upstreamResponse.headers.get('content-type') || '';
    const maybeM3u8Resource = isM3u8ContentType(contentType) || looksLikeM3u8Url(targetUrl);

    if (maybeM3u8Resource && req.method !== 'HEAD') {
      const rawM3u8 = await upstreamResponse.text();
      const headers = sanitizeHeaders(upstreamResponse.headers, { rewritten: true });

      if (isM3u8ContentType(contentType) || isM3u8Text(rawM3u8)) {
        const rewrittenM3u8 = rewriteM3u8Content(rawM3u8, targetUrl, {
          proxyBasePath: '/media-proxy/',
          authHash: req.query.auth || ''
        });
        headers['Content-Type'] = 'application/vnd.apple.mpegurl;charset=utf-8';
        res.status(upstreamResponse.status).set(headers).send(rewrittenM3u8);
        return;
      }

      res.status(upstreamResponse.status).set(headers).send(rawM3u8);
      return;
    }

    res.status(upstreamResponse.status).set(sanitizeHeaders(upstreamResponse.headers));
    if (req.method === 'HEAD' || !upstreamResponse.body) {
      res.end();
      return;
    }

    await pipeStreamToResponse(upstreamResponse.body, res);
  } catch (error) {
    logger.error('Vercel 视频转发失败', {
      targetUrl: targetUrl || '解析失败',
      error: error.stack || error.message
    });

    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: `视频转发错误: ${error.message}`,
        targetUrl
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
