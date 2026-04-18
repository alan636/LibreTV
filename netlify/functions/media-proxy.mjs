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
  scope: 'netlify-media-proxy',
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

function validateAuth(event) {
  const authHash = event.queryStringParameters?.auth;
  const timestamp = event.queryStringParameters?.t;
  const serverPassword = process.env.PASSWORD;

  if (!serverPassword) {
    return false;
  }

  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  return authHash === serverPasswordHash && validateTimestamp(timestamp);
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

function buildUpstreamHeaders(event, targetUrl) {
  const requestHeaders = event.headers || {};
  const headers = {
    'User-Agent': process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': requestHeaders.accept || '*/*',
    'Accept-Language': requestHeaders['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': requestHeaders.referer || new URL(targetUrl).origin,
    'Cache-Control': 'no-cache'
  };

  ['range', 'if-range', 'if-none-match', 'if-modified-since'].forEach((headerName) => {
    if (requestHeaders[headerName]) {
      headers[headerName] = requestHeaders[headerName];
    }
  });

  return headers;
}

function buildResponseHeaders(responseHeaders, { rewritten = false } = {}) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };

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

export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  let targetUrl = null;

  try {
    if (!validateAuth(event)) {
      return {
        statusCode: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ success: false, error: '视频转发未授权' })
      };
    }

    const proxyPrefix = '/media-proxy/';
    const encodedPath = event.path?.startsWith(proxyPrefix)
      ? event.path.substring(proxyPrefix.length)
      : '';
    targetUrl = getTargetUrlFromPath(encodedPath);

    if (!targetUrl || !isValidUrl(targetUrl)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: '无效的 URL'
      };
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: event.httpMethod === 'HEAD' ? 'HEAD' : 'GET',
      headers: buildUpstreamHeaders(event, targetUrl),
      redirect: 'follow'
    });

    const contentType = upstreamResponse.headers.get('content-type') || '';
    const maybeM3u8Resource = isM3u8ContentType(contentType) || looksLikeM3u8Url(targetUrl);

    if (maybeM3u8Resource && event.httpMethod !== 'HEAD') {
      const rawM3u8 = await upstreamResponse.text();
      const headers = buildResponseHeaders(upstreamResponse.headers, { rewritten: true });

      if (isM3u8ContentType(contentType) || isM3u8Text(rawM3u8)) {
        const rewrittenM3u8 = rewriteM3u8Content(rawM3u8, targetUrl, {
          proxyBasePath: '/media-proxy/',
          authHash: event.queryStringParameters?.auth || ''
        });
        headers['Content-Type'] = 'application/vnd.apple.mpegurl;charset=utf-8';
        return {
          statusCode: upstreamResponse.status,
          headers,
          body: rewrittenM3u8
        };
      }

      return {
        statusCode: upstreamResponse.status,
        headers,
        body: rawM3u8
      };
    }

    if (event.httpMethod === 'HEAD') {
      return {
        statusCode: upstreamResponse.status,
        headers: buildResponseHeaders(upstreamResponse.headers),
        body: ''
      };
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    return {
      statusCode: upstreamResponse.status,
      headers: buildResponseHeaders(upstreamResponse.headers),
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    logger.error('Netlify 视频转发失败', {
      targetUrl: targetUrl || '解析失败',
      error: error.stack || error.message
    });

    return {
      statusCode: 502,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: `视频转发错误: ${error.message}`,
        targetUrl
      })
    };
  }
};
