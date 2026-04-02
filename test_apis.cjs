const fs = require('fs');

const sites = [
    { name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod' },
    { name: '非凡影视', api: 'http://ffzy5.tv/api.php/provide/vod' },
    { name: '非凡资源', api: 'http://cj.ffzyapi.com/api.php/provide/vod/' },
    { name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
    { name: '量子资源(lziapi)', api: 'https://cj.lziapi.com/api.php/provide/vod/' },
    { name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod' },
    { name: '360资源', api: 'https://360zy.com/api.php/provide/vod/' },
    { name: 'iKun资源', api: 'https://ikunzyapi.com/api.php/provide/vod/' },
    { name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod/' },
    { name: '卧龙资源', api: 'https://collect.wolongzyw.com/api.php/provide/vod/' },
    { name: '天涯资源', api: 'https://tyyszy.com/api.php/provide/vod' },
    { name: '如意资源', api: 'https://cj.rycjapi.com/api.php/provide/vod' },
    { name: '无尽资源', api: 'https://api.wujinapi.me/api.php/provide/vod/' },
    { name: '旺旺短剧', api: 'https://wwzy.tv/api.php/provide/vod/' },
    { name: '樱花资源', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod/' },
    { name: '火狐资源', api: 'https://hhzyapi.com/api.php/provide/vod/' },
    { name: '电影天堂', api: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
    { name: '百度云资源', api: 'https://api.apibdzy.com/api.php/provide/vod/' },
    { name: '索尼资源', api: 'https://suoniapi.com/api.php/provide/vod/' },
    { name: '索尼资源2', api: 'https://suonizy.com/api.php/provide/vod/' },
    { name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod/' },
    { name: '红牛资源(无www)', api: 'https://hongniuzy2.com/api.php/provide/vod/' },
    { name: '豆瓣资源', api: 'https://dbzy.tv/api.php/provide/vod/' },
    { name: '金鹰资源(jyzyapi)', api: 'https://jyzyapi.com/api.php/provide/vod/' },
    { name: '金鹰资源(jinyingzy)', api: 'https://jinyingzy.com/api.php/provide/vod/' },
    { name: '魔都资源', api: 'https://www.mdzyapi.com/api.php/provide/vod/' },
    { name: '快看资源', api: 'https://kuaikan-api.com/api.php/provide/vod/' },
    { name: '虎牙资源', api: 'https://www.huyaapi.com/api.php/provide/vod/' },
    { name: '新浪资源', api: 'https://api.xinlangapi.com/api.php/provide/vod/' },
    { name: '八戒资源', api: 'https://cj.bajiecaiji.com/api.php/provide/vod/' },
    { name: 'U酷资源', api: 'https://api.ukuapi.com/api.php/provide/vod/' },
    { name: '天空资源', api: 'https://api.tiankongapi.com/api.php/provide/vod/' },
    { name: '闪电资源', api: 'https://sdzyapi.com/api.php/provide/vod/' },
    { name: '老张资源', api: 'https://api.lzzyapi.com/api.php/provide/vod/' },
    { name: '华为吧资源', api: 'https://cjhwba.com/api.php/provide/vod/' },
    { name: '测试资源', api: 'https://www.example.com/api.php/provide/vod/' }
];

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal,
            headers: {
                ...options.headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function testSite(site) {
    let result = { ...site, accessible: false, requiresAuth: false, searchApi: null, error: null };
    
    let normalizeApi = site.api;
    const apiUrl = normalizeApi.includes('?') ? `${normalizeApi}&ac=videolist` : `${normalizeApi}?ac=videolist`;

    // 1. Accessibility & Auth check
    let text = '';
    try {
        const res = await fetchWithTimeout(apiUrl);
        if (!res.ok) {
            result.error = `HTTP ${res.status}`;
            return result;
        }
        text = await res.text();
        if (text.length < 50 || (!text.includes('<?xml') && !text.includes('{"code":'))) {
             result.error = `Invalid format`;
             return result;
        }
        result.accessible = true;
    } catch (e) {
        result.error = e.message;
        return result;
    }

    // Attempt to extract an M3U8 link
    const m3u8Match = text.match(/https?:\/\/[a-zA-Z0-9.\-\/_~%?#&=]+\.m3u8[a-zA-Z0-9.\-\/_~%?#&=]*/i);
    if (m3u8Match) {
        try {
            const m3u8Res = await fetchWithTimeout(m3u8Match[0], { timeout: 5000 });
            if (!m3u8Res.ok) {
               if (m3u8Res.status === 403 || m3u8Res.status === 401) {
                   result.requiresAuth = true;
               }
            } else {
                const m3u8text = await m3u8Res.text();
                // some return 403 in m3u8 file or html
                if (m3u8text.includes('<html') || m3u8text.includes('403 Forbidden')) {
                    result.requiresAuth = true;
                }
            }
        } catch (e) {
            // timeout or other net err doesn't strictly mean auth required
        }
    }

    // 2. Search check
    if (result.accessible && !result.requiresAuth) {
        const searchWord = '我';
        const stdSearchUrl = apiUrl + `&wd=${encodeURIComponent(searchWord)}`;
        try {
           const sRes = await fetchWithTimeout(stdSearchUrl, { timeout: 4000 });
           const sText = await sRes.text();
           if (sText.length > 50 && (sText.includes(`"list":[{`) || sText.includes(`<video>`))) {
               result.searchApi = 'standard';
           }
        } catch(e) {}

        if (result.searchApi !== 'standard') {
            try {
                const urlObj = new URL(site.api);
                const ajaxUrl = `${urlObj.protocol}//${urlObj.host}/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(searchWord)}`;
                const sRes = await fetchWithTimeout(ajaxUrl, { timeout: 4000 });
                const sText = await sRes.text();
                if (sRes.ok && (sText.startsWith('{') || sText.startsWith('[')) && sText.includes('name')) {
                    result.searchApi = `${urlObj.protocol}//${urlObj.host}/index.php/ajax/suggest?mid=1&wd=`;
                }
            } catch (e) {}
        }
    }
    
    return result;
}

async function run() {
    console.log("Starting script...");
    const results = [];
    for (const [idx, site] of Object.entries(sites)) {
        console.log(`[${parseInt(idx)+1}/${sites.length}] Testing ${site.name} : ${site.api}...`);
        const r = await testSite(site);
        results.push(r);
        console.log(`  -> Accessible: ${r.accessible}, RequiresAuth: ${r.requiresAuth}, SearchApi: ${r.searchApi}`);
    }
    fs.writeFileSync('api_results.json', JSON.stringify(results, null, 2));
    console.log('Finished testing.');
}

run();
