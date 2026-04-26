const fs = require('fs');
const path = require('path');

const INPUT_FILE  = path.join(__dirname, 'found_apis.json');
const OUTPUT_FILE = path.join(__dirname, 'results.json');
const IMPORT_FILE = path.join(__dirname, 'libre_tv_import.json');
const FETCH_TIMEOUT = 8000;
const SEARCH_TIMEOUT = 5000;

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...(opts.headers || {})
            }
        });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function testSite(site) {
    const result = {
        name: site.name,
        api: site.api,
        source: site.source || '',
        accessible: false,
        requiresAuth: false,
        searchApi: null,
        error: null
    };

    const apiUrl = site.api.includes('?') ? `${site.api}&ac=videolist` : `${site.api}?ac=videolist`;

    let text = '';
    try {
        const res = await fetchWithTimeout(apiUrl);
        if (!res.ok) {
            result.error = `HTTP ${res.status}`;
            return result;
        }
        text = await res.text();
    } catch (e) {
        if (e.name === 'AbortError') result.error = 'Timeout';
        else result.error = e.message;
        return result;
    }

    if (text.includes('403 Forbidden') || text.includes('Unauthorized')) {
        result.accessible = true;
        result.requiresAuth = true;
        result.error = 'Requires Auth / Locked';
        return result;
    }

    try {
        const data = JSON.parse(text);
        if (!data.list && !data.class && !data.code && !data.msg) {
            result.error = 'Invalid JSON structure';
            return result;
        }
    } catch {
        result.error = 'Invalid format';
        return result;
    }

    result.accessible = true;

    const searchUrl = site.api.includes('?') ? `${site.api}&ac=videolist&wd=阿凡达` : `${site.api}?ac=videolist&wd=阿凡达`;
    try {
        const searchRes = await fetchWithTimeout(searchUrl, { timeout: SEARCH_TIMEOUT });
        if (searchRes.ok) {
            const searchData = JSON.parse(await searchRes.text());
            if (searchData.list && searchData.list.length > 0) {
                result.searchApi = 'standard';
                return result;
            }
        }
    } catch { /* ignore */ }

    let suggestUrl = site.api.replace(/api\.php\/provide\/vod\/?/i, 'index.php/ajax/suggest?mid=1&wd=a');
    if (suggestUrl !== site.api) {
        try {
            const sugRes = await fetchWithTimeout(suggestUrl, { timeout: SEARCH_TIMEOUT });
            if (sugRes.ok) {
                const sugData = JSON.parse(await sugRes.text());
                if (sugData.list && Array.isArray(sugData.list)) {
                    result.searchApi = site.api.replace(/api\.php\/provide\/vod\/?/i, 'index.php/ajax/suggest?mid=1&wd=');
                }
            }
        } catch { /* ignore */ }
    }

    return result;
}

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  视频源 API 自动测试 & 合并清洗工具        ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');

    // 1. 读取新抓取的 API
    let newApis = [];
    if (fs.existsSync(INPUT_FILE)) {
        const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
        newApis = input.apis || [];
    }

    // 2. 读取以前测试成功的 API（用于合并）
    let existingApis = [];
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            const previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            if (previous.usable) {
                existingApis = previous.usable.map(u => ({ name: u.name, api: u.api, source: 'Previous' }));
            }
        } catch (e) { /* ignore */ }
    }

    // 3. 合并去重
    const map = new Map();
    for (const item of [...existingApis, ...newApis]) {
        const key = item.api.replace(/\/+$/, '');
        if (!map.has(key)) {
            map.set(key, { ...item, api: key });
        }
    }
    const sites = [...map.values()];

    if (sites.length === 0) {
        console.error('❌ 没有找到任何需要测试的 API');
        process.exit(1);
    }

    log('START', `共 ${sites.length} 个 API 待清洗和测试（包含新增和历史记录）`);

    const results = [];
    // 采用一定并发或者快速跳过
    for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        log('TEST', `[${i + 1}/${sites.length}] ${site.name} → ${site.api}`);
        const r = await testSite(site);

        const statusIcon = r.accessible ? (r.requiresAuth ? '🔒' : '✅') : '❌';
        const searchIcon = r.searchApi ? `🔍${r.searchApi === 'standard' ? '标准' : 'AJAX'}` : '—';
        log('RESULT', `${statusIcon} ${r.name}  搜索:${searchIcon}  ${r.error || ''}`);

        results.push(r);
    }

    const accessible = results.filter(r => r.accessible && !r.requiresAuth);
    const withSearch = accessible.filter(r => r.searchApi);
    const authRequired = results.filter(r => r.requiresAuth);
    const failed = results.filter(r => !r.accessible);

    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  测试报告                                  ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  总计:     ${String(results.length).padStart(4)}                              ║`);
    console.log(`║  ✅ 可用:  ${String(accessible.length).padStart(4)}                              ║`);
    console.log(`║  🔍 可搜:  ${String(withSearch.length).padStart(4)}                              ║`);
    console.log(`║  🔒 鉴权:  ${String(authRequired.length).padStart(4)}                              ║`);
    console.log(`║  ❌ 不可用:${String(failed.length).padStart(4)}                              ║`);
    console.log('╚════════════════════════════════════════════╝');

    const output = {
        testedAt: new Date().toISOString(),
        summary: {
            total: results.length,
            accessible: accessible.length,
            withSearch: withSearch.length,
            authRequired: authRequired.length,
            failed: failed.length
        },
        usable: accessible.map(r => ({
            name: r.name,
            api: r.api,
            searchApi: r.searchApi === 'standard' ? r.api + '?ac=videolist&wd=' : r.searchApi
        })),
        all: results
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
    log('SAVE', `详细测试报告已保存至 ${OUTPUT_FILE}`);

    // 生成一键导入格式
    const importFormat = output.usable.map(u => ({
        name: u.name,
        url: u.api,
        search_api: u.searchApi || ''
    }));
    fs.writeFileSync(IMPORT_FILE, JSON.stringify(importFormat, null, 2), 'utf8');
    log('SAVE', `✨ 前端一键导入格式已生成: ${IMPORT_FILE} ✨`);
    console.log('\n你可以直接打开 libre_tv_import.json 并复制其内容到前端项目中！');
}

main().catch(e => {
    console.error('脚本异常:', e);
    process.exit(1);
});
