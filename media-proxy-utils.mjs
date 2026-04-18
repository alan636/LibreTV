export function getBaseUrl(urlStr) {
  if (!urlStr) return '';

  try {
    const parsedUrl = new URL(urlStr);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathSegments.length <= 1) {
      return `${parsedUrl.origin}/`;
    }

    pathSegments.pop();
    return `${parsedUrl.origin}/${pathSegments.join('/')}/`;
  } catch {
    const lastSlashIndex = urlStr.lastIndexOf('/');
    if (lastSlashIndex > urlStr.indexOf('://') + 2) {
      return urlStr.substring(0, lastSlashIndex + 1);
    }

    return `${urlStr}/`;
  }
}

export function resolveUrl(baseUrl, relativeUrl) {
  if (!relativeUrl) return '';
  if (/^https?:\/\//i.test(relativeUrl)) {
    return relativeUrl;
  }
  if (!baseUrl) {
    return relativeUrl;
  }

  try {
    return new URL(relativeUrl, baseUrl).toString();
  } catch {
    if (relativeUrl.startsWith('/')) {
      try {
        return `${new URL(baseUrl).origin}${relativeUrl}`;
      } catch {
        return relativeUrl;
      }
    }

    return `${baseUrl}${relativeUrl}`;
  }
}

export function isM3u8ContentType(contentType = '') {
  const lowerType = String(contentType).toLowerCase();
  return lowerType.includes('application/vnd.apple.mpegurl') ||
    lowerType.includes('application/x-mpegurl') ||
    lowerType.includes('audio/mpegurl');
}

export function looksLikeM3u8Url(targetUrl = '') {
  return /\.m3u8($|\?)/i.test(targetUrl);
}

export function isM3u8Text(content = '') {
  return typeof content === 'string' && content.trim().startsWith('#EXTM3U');
}

export function buildInternalProxyUrl(proxyBasePath, targetUrl, authHash = '') {
  const encodedUrl = encodeURIComponent(targetUrl);
  const authQuery = authHash ? `?auth=${encodeURIComponent(authHash)}` : '';
  return `${proxyBasePath}${encodedUrl}${authQuery}`;
}

export function rewriteM3u8Content(content, sourceUrl, { proxyBasePath, authHash = '' }) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const baseUrl = getBaseUrl(sourceUrl);
  const lines = content.split('\n');

  return lines.map((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      return rawLine;
    }

    if (line.startsWith('#')) {
      return rawLine.replace(/URI="([^"]+)"/g, (match, uri) => {
        const absoluteUrl = resolveUrl(baseUrl, uri);
        return `URI="${buildInternalProxyUrl(proxyBasePath, absoluteUrl, authHash)}"`;
      });
    }

    const absoluteUrl = resolveUrl(baseUrl, line);
    return buildInternalProxyUrl(proxyBasePath, absoluteUrl, authHash);
  }).join('\n');
}
