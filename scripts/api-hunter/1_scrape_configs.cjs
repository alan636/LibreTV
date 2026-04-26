/**
 * TVBox 配置爬取脚本
 * ──────────────────
 * 1. 抓取 https://tvbox.wpcoder.cn/user.php 页面
 * 2. 提取所有 TVBox 配置入口 URL
 * 3. 逐个抓取配置 → 层层解码（base64 / JPEG隐写 / 非标准JSON / 重定向）
 * 4. 从配置的 sites[] 中提取可用的视频源 API
 *    - type:0/1 的标准苹果CMS采集API（/api.php/provide/vod）
 *    - 任意 type 中 api 字段为完整 HTTP URL 且包含 /api.php/provide/vod 的
 * 5. 去重后输出 found_apis.json
 */

const fs = require('fs');
const path = require('path');

// ─── 配置 ───────────────────────────────────────────────
const WPCODER_URL = 'https://tvbox.wpcoder.cn/user.php';
const OUTPUT_FILE = path.join(__dirname, 'found_apis.json');
const FETCH_TIMEOUT = 12000;
const CONCURRENCY = 3;

// ─── 工具函数 ────────────────────────────────────────────

function log(tag, msg, extra = '') {
    const ts = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${ts}] [${tag}] ${msg}`, extra ? extra : '');
}

async function fetchWithTimeout(url, opts = {}) {
    const { timeout = FETCH_TIMEOUT } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            ...opts,
            signal: controller.signal,
            headers: {
                'User-Agent': 'okhttp/4.12.0',
                'Accept': '*/*',
                ...(opts.headers || {})
            },
            redirect: 'follow'
        });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

/** 尝试 base64 解码（支持标准 & URL-safe） */
function tryBase64Decode(str) {
    try {
        const cleaned = str.trim().replace(/^\uFEFF/, '');
        if (/^[\[{<]/.test(cleaned)) return null;
        if (!/^[A-Za-z0-9+/=_-]+$/.test(cleaned.replace(/\s/g, ''))) return null;

        const raw = cleaned.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        if (decoded.includes('\x00')) return null;
        return decoded;
    } catch {
        return null;
    }
}

// 已知的 JPEG 隐写分隔符列表（饭太硬等格式）
const JPEG_SEPARATORS = ['KYfruwYU**', '**KYfruwYU', 'FTY**'];

/**
 * 从 JPEG 隐写中提取 JSON
 * 饭太硬格式：JPEG EOI (FFD9) 后 → 分隔符 → Base64(带注释的JSON)
 */
function tryExtractFromJpeg(buffer) {
    // 查找 JPEG EOI 标记 (0xFF 0xD9)
    for (let i = 0; i < buffer.length - 2; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
            const afterEoi = buffer.slice(i + 2);
            if (afterEoi.length < 10) continue;

            let text = afterEoi.toString('utf8').trim();

            // 1. 检查是否有已知分隔符，去掉分隔符后取 base64 部分
            for (const sep of JPEG_SEPARATORS) {
                const sepIdx = text.indexOf(sep);
                if (sepIdx !== -1) {
                    const b64Part = text.slice(sepIdx + sep.length).trim();
                    if (b64Part.length > 10) {
                        const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
                        if (decoded.length > 10) return decoded;
                    }
                }
            }

            // 2. 直接是 JSON
            if (text.startsWith('{') || text.startsWith('[')) {
                return text;
            }

            // 3. 纯 base64（无分隔符）
            const decoded = tryBase64Decode(text);
            if (decoded && (decoded.startsWith('{') || decoded.startsWith('['))) {
                return decoded;
            }
        }
    }
    return null;
}

// 移除 JSON 中的单行注释(//)和多行注释，保留字符串内容
function stripJsonComments(text) {
    let result = '';
    let inString = false;
    let stringChar = '';
    let i = 0;
    while (i < text.length) {
        if (inString) {
            if (text[i] === '\\') {
                result += text[i] + (text[i + 1] || '');
                i += 2;
                continue;
            }
            if (text[i] === stringChar) {
                inString = false;
            }
            result += text[i];
            i++;
        } else {
            if (text[i] === '"' || text[i] === "'") {
                inString = true;
                stringChar = text[i];
                result += text[i];
                i++;
            } else if (text[i] === '/' && text[i + 1] === '/') {
                // 单行注释，跳到行尾
                while (i < text.length && text[i] !== '\n') i++;
            } else if (text[i] === '/' && text[i + 1] === '*') {
                // 多行注释
                i += 2;
                while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
                i += 2;
            } else {
                result += text[i];
                i++;
            }
        }
    }
    return result;
}

/** 尝试将文本解析为 JSON（支持 JSONP 包裹、注释、尾逗号） */
function tryParseJson(text) {
    const trimmed = text.trim().replace(/^\uFEFF/, '');

    // 直接解析
    try { return JSON.parse(trimmed); } catch { /* continue */ }

    // 去注释后解析
    try {
        const stripped = stripJsonComments(trimmed);
        return JSON.parse(stripped);
    } catch { /* continue */ }

    // 去注释 + 修复尾逗号
    try {
        let stripped = stripJsonComments(trimmed);
        stripped = stripped.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(stripped);
    } catch { /* continue */ }

    // JSONP: callback({...})
    const jsonpMatch = trimmed.match(/^\w+\s*\(\s*(\{[\s\S]+\})\s*\)\s*;?\s*$/);
    if (jsonpMatch) {
        try { return JSON.parse(jsonpMatch[1]); } catch { /* continue */ }
    }

    return null;
}

/**
 * 从 TVBox 配置 JSON 中递归提取视频源 API
 * 识别模式: sites[].api 中包含 /api.php/provide/vod 的完整URL地址
 */
function extractApisFromConfig(config, source) {
    const apis = [];
    if (!config || typeof config !== 'object') return apis;

    const sites = config.sites || config.video?.sites || [];
    if (Array.isArray(sites)) {
        for (const site of sites) {
            if (!site || typeof site !== 'object') continue;
            const api = site.api || '';
            if (typeof api !== 'string') continue;

            // 1. 标准苹果CMS API
            if (typeof api === 'string' && api.startsWith('http') && api.includes('/api.php/provide/vod')) {
                apis.push({
                    name: site.name || site.key || '未知',
                    api: api.trim(),
                    source
                });
                continue;
            }

            // 2. 提取 type:3 自定义爬虫的 ext 字段中的 URL
            if (site.type === 3 && typeof api === 'string' && api.startsWith('csp_')) {
                let extUrl = null;
                if (typeof site.ext === 'string' && site.ext.startsWith('http')) {
                    // 处理类似 "http://xxx.com|1234567887654321" 附带密钥的格式
                    extUrl = site.ext.split('|')[0].trim();
                } else if (typeof site.ext === 'object') {
                    // 有些 ext 是对象，尝试提取 url 相关字段
                    const obj = site.ext;
                    const possibleUrl = obj.site_urls || obj.url || obj.host || obj.api;
                    if (typeof possibleUrl === 'string' && possibleUrl.startsWith('http')) {
                        extUrl = possibleUrl.trim();
                    } else if (Array.isArray(obj.site_urls) && obj.site_urls[0]) {
                        extUrl = obj.site_urls[0];
                    }
                }

                if (extUrl) {
                    apis.push({
                        name: `[${api}] ${site.name || site.key || '未知'}`,
                        api: extUrl,
                        source: `${source} (Spider Ext)`
                    });
                }
            }
        }
    }

    return apis;
}

// ─── 核心逻辑 ────────────────────────────────────────────

/** 第一步：抓取 wpcoder 页面，提取所有配置入口 URL */
async function scrapeWpcoderPage() {
    log('STEP', '正在抓取 wpcoder 页面...');
    const res = await fetchWithTimeout(WPCODER_URL);
    if (!res.ok) throw new Error(`wpcoder 页面请求失败: HTTP ${res.status}`);
    const html = await res.text();

    const entries = [];
    const regex = /data-url="([^"]+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const url = match[1].replace(/&amp;/g, '&').trim();
        if (url) entries.push(url);
    }

    const nameRegex = /<td class="td-name">([^<]+)<\/td>/g;
    const names = [];
    while ((match = nameRegex.exec(html)) !== null) {
        names.push(match[1].trim());
    }

    const result = entries.map((url, i) => ({
        name: names[i] || `配置${i + 1}`,
        url
    }));

    log('STEP', `共提取到 ${result.length} 个配置入口`);
    return result;
}

/** 第二步：抓取单个配置 URL，层层解码，提取视频 API */
async function processConfigUrl(entry) {
    const { name, url } = entry;
    const apis = [];

    log('FETCH', `[${name}] ${url}`);

    let res;
    try {
        res = await fetchWithTimeout(url);
        if (!res.ok) {
            log('WARN', `[${name}] HTTP ${res.status}`);
            return apis;
        }
    } catch (e) {
        log('WARN', `[${name}] 请求失败: ${e.message}`);
        return apis;
    }

    // 获取原始 buffer（用于 JPEG 隐写检测）
    let buffer;
    try {
        buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
        log('WARN', `[${name}] 读取响应失败: ${e.message}`);
        return apis;
    }

    if (buffer.length < 10) {
        log('WARN', `[${name}] 响应内容过短`);
        return apis;
    }

    // ── 解码管道 ──

    // 1. 检测 JPEG 隐写（饭太硬格式）
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        log('DECODE', `[${name}] 检测到 JPEG 格式，尝试提取隐写数据...`);
        const hidden = tryExtractFromJpeg(buffer);
        if (hidden) {
            log('DECODE', `[${name}] 从 JPEG 中提取到 ${hidden.length} 字符`);
            const json = tryParseJson(hidden);
            if (json) {
                const found = extractApisFromConfig(json, `${name} (${url}) [JPEG隐写]`);
                if (found.length > 0) {
                    log('OK', `[${name}] 从JPEG隐写中找到 ${found.length} 个视频 API`);
                    apis.push(...found);
                    return apis;
                }
                // JPEG 解码成功但全是 csp 爬虫
                if (json.sites && Array.isArray(json.sites)) {
                    const cspCount = json.sites.filter(s => typeof s.api === 'string' && s.api.startsWith('csp_')).length;
                    if (cspCount > 0) {
                        log('INFO', `[${name}] JPEG解码成功，含 ${json.sites.length} 个站点（${cspCount} 个为 csp 爬虫，跳过）`);
                        return apis;
                    }
                }
            }
            // JPEG 中的数据可能还包含正则可提取的 API URL
            const apiPattern = /https?:\/\/[a-zA-Z0-9.\-]+(?::\d+)?\/api\.php\/provide\/vod\/?/gi;
            const directMatches = hidden.match(apiPattern);
            if (directMatches) {
                const unique = [...new Set(directMatches)];
                log('REGEX', `[${name}] 从JPEG隐写中正则提取到 ${unique.length} 个 API`);
                for (const apiUrl of unique) {
                    apis.push({ name: `${name}(JPEG)`, api: apiUrl, source: `${name} (${url}) [JPEG]` });
                }
                return apis;
            }
        }
        log('SKIP', `[${name}] JPEG 格式但无法提取有效数据`);
        return apis;
    }

    // 2. 文本模式解码
    const text = buffer.toString('utf8');

    // 尝试解析管道：原始 → base64解码 → 再base64解码（双重编码）
    const candidates = [text];
    const decoded1 = tryBase64Decode(text);
    if (decoded1) candidates.push(decoded1);
    const decoded2 = decoded1 ? tryBase64Decode(decoded1) : null;
    if (decoded2) candidates.push(decoded2);

    for (const candidate of candidates) {
        const json = tryParseJson(candidate);
        if (json) {
            const found = extractApisFromConfig(json, `${name} (${url})`);
            if (found.length > 0) {
                log('OK', `[${name}] 找到 ${found.length} 个视频 API`);
                apis.push(...found);
                return apis;
            }
            // JSON 解析成功但没有找到 API（可能全是 type:3 csp 爬虫）
            if (json.sites && Array.isArray(json.sites)) {
                const cspCount = json.sites.filter(s => typeof s.api === 'string' && s.api.startsWith('csp_')).length;
                const totalSites = json.sites.length;
                if (cspCount > 0) {
                    log('INFO', `[${name}] 配置含 ${totalSites} 个站点（${cspCount} 个为 csp 爬虫，需 jar 包执行，跳过）`);
                }
            }
        }
    }

    // 3. 特殊情况：响应本身是一个 URL，指向真正的配置
    const urlMatch = text.trim().match(/^https?:\/\/\S+$/);
    if (urlMatch) {
        log('REDIRECT', `[${name}] 内容指向另一个 URL: ${urlMatch[0]}`);
        const subApis = await processConfigUrl({ name: `${name}(跳转)`, url: urlMatch[0] });
        apis.push(...subApis);
        return apis;
    }

    // 4. 正则兜底：从任意文本中提取 API URL
    const apiPattern = /https?:\/\/[a-zA-Z0-9.\-]+(?::\d+)?\/api\.php\/provide\/vod\/?/gi;
    const directMatches = text.match(apiPattern);
    if (directMatches && directMatches.length > 0) {
        const unique = [...new Set(directMatches)];
        log('REGEX', `[${name}] 正则提取到 ${unique.length} 个 API`);
        for (const apiUrl of unique) {
            apis.push({ name: `${name}(正则)`, api: apiUrl, source: `${name} (${url})` });
        }
        return apis;
    }

    log('SKIP', `[${name}] 未能解析出视频 API`);
    return apis;
}

/** 并发控制 */
async function processWithConcurrency(entries, concurrency) {
    const allApis = [];
    let idx = 0;

    async function worker() {
        while (idx < entries.length) {
            const current = entries[idx++];
            const apis = await processConfigUrl(current);
            allApis.push(...apis);
        }
    }

    const workers = Array(Math.min(concurrency, entries.length))
        .fill(null)
        .map(() => worker());
    await Promise.all(workers);
    return allApis;
}

/** 去重：按 api URL 去重，优先保留有名称的 */
function deduplicateApis(apis) {
    const map = new Map();
    for (const item of apis) {
        const key = item.api.replace(/\/+$/, '');
        if (!map.has(key) || (item.name && !item.name.includes('正则') && !item.name.includes('JPEG'))) {
            map.set(key, { ...item, api: key });
        }
    }
    return [...map.values()];
}

// ─── 入口 ────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  TVBox 配置爬取 & 视频 API 提取工具       ║');
    console.log('║  支持: JSON / Base64 / JPEG隐写 / 注释JSON ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    // 1. 抓取配置入口
    const entries = await scrapeWpcoderPage();

    // 2. 逐个处理
    const rawApis = await processWithConcurrency(entries, CONCURRENCY);

    // 3. 去重
    const apis = deduplicateApis(rawApis);

    // 4. 输出
    console.log('');
    log('DONE', `共找到 ${apis.length} 个去重后的视频 API`);

    const output = {
        updatedAt: new Date().toISOString(),
        totalConfigs: entries.length,
        totalApis: apis.length,
        apis: apis.map(a => ({ name: a.name, api: a.api, source: a.source }))
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
    log('SAVE', `结果已保存至 ${OUTPUT_FILE}`);
}

main().catch(e => {
    console.error('脚本异常:', e);
    process.exit(1);
});
