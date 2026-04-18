import { createLogger } from '../../logger.mjs';
import {
  isM3u8ContentType,
  isM3u8Text,
  looksLikeM3u8Url,
  rewriteM3u8Content
} from '../../media-proxy-utils.mjs';

function isValidUrl(urlString, env) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    const blockedHostnames = (env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    const blockedPrefixes = (env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');

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

async function validateAuth(request, env) {
  const url = new URL(request.url);
  const authHash = url.searchParams.get('auth');
  const timestamp = url.searchParams.get('t');
  const serverPassword = env.PASSWORD;

  if (!serverPassword || !authHash || !validateTimestamp(timestamp)) {
    return false;
  }

  const data = new TextEncoder().encode(serverPassword);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const serverPasswordHash = hashArray.map((item) => item.toString(16).padStart(2, '0')).join('');
  return authHash === serverPasswordHash;
}

function getTargetUrlFromPath(pathname) {
  const encodedUrl = pathname.replace(/^\/media-proxy\//, '');
  if (!encodedUrl) return null;

  try {
    const decodedUrl = decodeURIComponent(encodedUrl);
    if (/^https?:\/\/.+/i.test(decodedUrl)) {
      return decodedUrl;
    }
    if (/^https?:\/\/.+/i.test(encodedUrl)) {
      return encodedUrl;
    }
    return null;
  } catch {
    return null;
  }
}

function buildUpstreamHeaders(request, targetUrl, env) {
  const headers = new Headers({
    'User-Agent': env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': request.headers.get('Accept') || '*/*',
    'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': request.headers.get('Referer') || new URL(targetUrl).origin,
    'Cache-Control': 'no-cache'
  });

  ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since'].forEach((headerName) => {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  });

  return headers;
}

function buildResponseHeaders(responseHeaders, { rewritten = false } = {}) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });

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

    headers.set(key, value);
  });

  return headers;
}

export async function onRequest(context) {
  const { request, env } = context;
  const logger = createLogger({
    scope: 'cloudflare-media-proxy',
    debugEnabled: env.DEBUG === 'true'
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  let targetUrl = null;

  try {
    if (!(await validateAuth(request, env))) {
      return new Response(JSON.stringify({ success: false, error: '视频转发未授权' }), {
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Content-Type': 'application/json'
        }
      });
    }

    const requestUrl = new URL(request.url);
    targetUrl = getTargetUrlFromPath(requestUrl.pathname);

    if (!targetUrl || !isValidUrl(targetUrl, env)) {
      return new Response('无效的 URL', {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: buildUpstreamHeaders(request, targetUrl, env),
      redirect: 'follow'
    });

    const contentType = upstreamResponse.headers.get('content-type') || '';
    const maybeM3u8Resource = isM3u8ContentType(contentType) || looksLikeM3u8Url(targetUrl);

    if (maybeM3u8Resource && request.method !== 'HEAD') {
      const rawM3u8 = await upstreamResponse.text();
      const headers = buildResponseHeaders(upstreamResponse.headers, { rewritten: true });

      if (isM3u8ContentType(contentType) || isM3u8Text(rawM3u8)) {
        const rewrittenM3u8 = rewriteM3u8Content(rawM3u8, targetUrl, {
          proxyBasePath: '/media-proxy/',
          authHash: requestUrl.searchParams.get('auth') || ''
        });
        headers.set('Content-Type', 'application/vnd.apple.mpegurl;charset=utf-8');
        return new Response(rewrittenM3u8, {
          status: upstreamResponse.status,
          headers
        });
      }

      return new Response(rawM3u8, {
        status: upstreamResponse.status,
        headers
      });
    }

    return new Response(request.method === 'HEAD' ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: buildResponseHeaders(upstreamResponse.headers)
    });
  } catch (error) {
    logger.error('Cloudflare 视频转发失败', {
      targetUrl: targetUrl || '解析失败',
      error: error.stack || error.message
    });

    return new Response(JSON.stringify({
      success: false,
      error: `视频转发错误: ${error.message}`,
      targetUrl
    }), {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': 'application/json'
      }
    });
  }
}

export async function onOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    }
  });
}
