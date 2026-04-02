// 改进的API请求处理函数
async function handleApiRequest(url) {
    const customApi = url.searchParams.get('customApi') || '';
    const customDetail = url.searchParams.get('customDetail') || '';
    const source = url.searchParams.get('source') || 'heimuer';
    
    try {
        if (url.pathname === '/api/search') {
            const searchQuery = url.searchParams.get('wd');
            if (!searchQuery) {
                throw new Error('缺少搜索参数');
            }
            
            // 验证API和source的有效性
            if (source === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }
            
            if (!API_SITES[source] && source !== 'custom') {
                throw new Error('无效的API来源');
            }
            
            const apiUrl = customApi
                ? `${customApi}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`
                : `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;
            
            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            try {
                // 添加鉴权参数到代理URL
                const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                    await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                    PROXY_URL + encodeURIComponent(apiUrl);
                    
                const response = await fetch(proxiedUrl, {
                    headers: API_CONFIG.search.headers,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`API请求失败: ${response.status}`);
                }
                
                const data = await response.json();
                
                // 检查JSON格式的有效性
                if (!data || !Array.isArray(data.list)) {
                    throw new Error('API返回的数据格式无效');
                }
                
                // 添加源信息到每个结果
                data.list.forEach(item => {
                    item.source_name = source === 'custom' ? '自定义源' : API_SITES[source].name;
                    item.source_code = source;
                    // 对于自定义源，添加API URL信息
                    if (source === 'custom') {
                        item.api_url = customApi;
                    }
                });
                
                return JSON.stringify({
                    code: 200,
                    list: data.list || [],
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        // 详情处理
        if (url.pathname === '/api/detail') {
            const id = url.searchParams.get('id');
            const sourceCode = url.searchParams.get('source') || 'heimuer'; // 获取源代码
            
            if (!id) {
                throw new Error('缺少视频ID参数');
            }
            
            // 验证ID格式 - 只允许数字和有限的特殊字符
            if (!/^[\w-]+$/.test(id)) {
                throw new Error('无效的视频ID格式');
            }

            // 验证API和source的有效性
            if (sourceCode === 'custom' && !customApi) {
                throw new Error('使用自定义API时必须提供API地址');
            }
            
            if (!API_SITES[sourceCode] && sourceCode !== 'custom') {
                throw new Error('无效的API来源');
            }

            // 对于有detail参数的源，都使用特殊处理方式
            if (sourceCode !== 'custom' && API_SITES[sourceCode].detail) {
                return await handleSpecialSourceDetail(id, sourceCode);
            }
            
            // 如果是自定义API，并且传递了detail参数，尝试特殊处理
            // 优先 customDetail
            if (sourceCode === 'custom' && customDetail) {
                return await handleCustomApiSpecialDetail(id, customDetail);
            }
            if (sourceCode === 'custom' && url.searchParams.get('useDetail') === 'true') {
                return await handleCustomApiSpecialDetail(id, customApi);
            }
            
            const detailUrl = customApi
                ? `${customApi}${API_CONFIG.detail.path}${id}`
                : `${API_SITES[sourceCode].api}${API_CONFIG.detail.path}${id}`;
            
            // 添加超时处理
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            try {
                // 添加鉴权参数到代理URL
                const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                    await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
                    PROXY_URL + encodeURIComponent(detailUrl);
                    
                const response = await fetch(proxiedUrl, {
                    headers: API_CONFIG.detail.headers,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`详情请求失败: ${response.status}`);
                }
                
                // 解析JSON
                const data = await response.json();
                
                // 检查返回的数据是否有效
                if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
                    throw new Error('获取到的详情内容无效');
                }
                
                // 获取第一个匹配的视频详情
                const videoDetail = data.list[0];
                
                // 提取播放地址
                let episodes = [];
                
                if (videoDetail.vod_play_url) {
                    // 分割不同播放源
                    const playSources = videoDetail.vod_play_url.split('$$$');
                    
                    // 提取第一个播放源的集数（通常为主要源）
                    if (playSources.length > 0) {
                        const mainSource = playSources[0];
                        const episodeList = mainSource.split('#');
                        
                        // 从每个集数中提取URL
                        episodes = episodeList.map(ep => {
                            const parts = ep.split('$');
                            // 返回URL部分(通常是第二部分，如果有的话)
                            return parts.length > 1 ? parts[1] : '';
                        }).filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
                    }
                }
                
                // 如果没有找到播放地址，尝试使用正则表达式查找m3u8链接
                if (episodes.length === 0 && videoDetail.vod_content) {
                    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
                    episodes = matches.map(link => link.replace(/^\$/, ''));
                }
                
                return JSON.stringify({
                    code: 200,
                    episodes: episodes,
                    detailUrl: detailUrl,
                    videoInfo: {
                        title: videoDetail.vod_name,
                        cover: videoDetail.vod_pic,
                        desc: videoDetail.vod_content,
                        type: videoDetail.type_name,
                        year: videoDetail.vod_year,
                        area: videoDetail.vod_area,
                        director: videoDetail.vod_director,
                        actor: videoDetail.vod_actor,
                        remarks: videoDetail.vod_remarks,
                        // 添加源信息
                        source_name: sourceCode === 'custom' ? '自定义源' : API_SITES[sourceCode].name,
                        source_code: sourceCode
                    }
                });
            } catch (fetchError) {
                clearTimeout(timeoutId);
                throw fetchError;
            }
        }

        throw new Error('未知的API路径');
    } catch (error) {
        console.error('API处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: error.message || '请求处理失败',
            list: [],
            episodes: [],
        });
    }
}

// 处理自定义API的特殊详情页
async function handleCustomApiSpecialDetail(id, customApi) {
    try {
        // 构建详情页URL
        const detailUrl = `${customApi}/index.php/vod/detail/id/${id}.html`;
        
        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);
            
        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`自定义API详情页请求失败: ${response.status}`);
        }
        
        // 获取HTML内容
        const html = await response.text();
        
        // 使用通用模式提取m3u8链接
        const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
        let matches = html.match(generalPattern) || [];
        
        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });
        
        // 提取基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';
        
        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';
        
        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: '自定义源',
                source_code: 'custom'
            }
        });
    } catch (error) {
        console.error(`自定义API详情获取失败:`, error);
        throw error;
    }
}

// 通用特殊源详情处理函数
async function handleSpecialSourceDetail(id, sourceCode) {
    try {
        // 构建详情页URL（使用配置中的detail URL而不是api URL）
        const detailUrl = `${API_SITES[sourceCode].detail}/index.php/vod/detail/id/${id}.html`;
        
        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(detailUrl)) :
            PROXY_URL + encodeURIComponent(detailUrl);
            
        // 获取详情页HTML
        const response = await fetch(proxiedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }
        
        // 获取HTML内容
        const html = await response.text();
        
        // 根据不同源类型使用不同的正则表达式
        let matches = [];
        
        if (sourceCode === 'ffzy') {
            // 非凡影视使用特定的正则表达式
            const ffzyPattern = /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
            matches = html.match(ffzyPattern) || [];
        }
        
        // 如果没有找到链接或者是其他源类型，尝试一个更通用的模式
        if (matches.length === 0) {
            const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
            matches = html.match(generalPattern) || [];
        }
        // 去重处理，避免一个播放源多集显示
        matches = [...new Set(matches)];
        // 处理链接
        matches = matches.map(link => {
            link = link.substring(1, link.length);
            const parenIndex = link.indexOf('(');
            return parenIndex > 0 ? link.substring(0, parenIndex) : link;
        });
        
        // 提取可能存在的标题、简介等基本信息
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const titleText = titleMatch ? titleMatch[1].trim() : '';
        
        const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
        const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';
        
        return JSON.stringify({
            code: 200,
            episodes: matches,
            detailUrl: detailUrl,
            videoInfo: {
                title: titleText,
                desc: descText,
                source_name: API_SITES[sourceCode].name,
                source_code: sourceCode
            }
        });
    } catch (error) {
        console.error(`${API_SITES[sourceCode].name}详情获取失败:`, error);
        throw error;
    }
}

// 处理聚合搜索
async function handleAggregatedSearch(searchQuery) {
    // 获取可用的API源列表（排除aggregated和custom）
    const availableSources = Object.keys(API_SITES).filter(key => 
        key !== 'aggregated' && key !== 'custom'
    );
    
    if (availableSources.length === 0) {
        throw new Error('没有可用的API源');
    }
    
    // 创建所有API源的搜索请求
    const searchPromises = availableSources.map(async (source) => {
        try {
            const apiUrl = `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;
            
            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`${source}源搜索超时`)), 8000)
            );
            
            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
                PROXY_URL + encodeURIComponent(apiUrl);
            
            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });
            
            const response = await Promise.race([fetchPromise, timeoutPromise]);
            
            if (!response.ok) {
                throw new Error(`${source}源请求失败: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !Array.isArray(data.list)) {
                throw new Error(`${source}源返回的数据格式无效`);
            }
            
            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: API_SITES[source].name,
                source_code: source
            }));
            
            return results;
        } catch (error) {
            console.warn(`${source}源搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });
    
    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);
        
        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });
        
        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有源均无搜索结果'
            });
        }
        
        // 去重（根据vod_id和source_code组合）
        const uniqueResults = [];
        const seen = new Set();
        
        allResults.forEach(item => {
            const key = `${item.source_code}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });
        
        // 按照视频名称和来源排序
        uniqueResults.sort((a, b) => {
            // 首先按照视频名称排序
            const nameCompare = (a.vod_name || '').localeCompare(b.vod_name || '');
            if (nameCompare !== 0) return nameCompare;
            
            // 如果名称相同，则按照来源排序
            return (a.source_name || '').localeCompare(b.source_name || '');
        });
        
        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 处理多个自定义API源的聚合搜索
async function handleMultipleCustomSearch(searchQuery, customApiUrls) {
    // 解析自定义API列表
    const apiUrls = customApiUrls.split(CUSTOM_API_CONFIG.separator)
        .map(url => url.trim())
        .filter(url => url.length > 0 && /^https?:\/\//.test(url))
        .slice(0, CUSTOM_API_CONFIG.maxSources);
    
    if (apiUrls.length === 0) {
        throw new Error('没有提供有效的自定义API地址');
    }
    
    // 为每个API创建搜索请求
    const searchPromises = apiUrls.map(async (apiUrl, index) => {
        try {
            const fullUrl = `${apiUrl}${API_CONFIG.search.path}${encodeURIComponent(searchQuery)}`;
            
            // 使用Promise.race添加超时处理
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`自定义API ${index+1} 搜索超时`)), 8000)
            );
            
            // 添加鉴权参数到代理URL
            const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
                await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(fullUrl)) :
                PROXY_URL + encodeURIComponent(fullUrl);
            
            const fetchPromise = fetch(proxiedUrl, {
                headers: API_CONFIG.search.headers
            });
            
            const response = await Promise.race([fetchPromise, timeoutPromise]);
            
            if (!response.ok) {
                throw new Error(`自定义API ${index+1} 请求失败: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !Array.isArray(data.list)) {
                throw new Error(`自定义API ${index+1} 返回的数据格式无效`);
            }
            
            // 为搜索结果添加源信息
            const results = data.list.map(item => ({
                ...item,
                source_name: `${CUSTOM_API_CONFIG.namePrefix}${index+1}`,
                source_code: 'custom',
                api_url: apiUrl // 保存API URL以便详情获取
            }));
            
            return results;
        } catch (error) {
            console.warn(`自定义API ${index+1} 搜索失败:`, error);
            return []; // 返回空数组表示该源搜索失败
        }
    });
    
    try {
        // 并行执行所有搜索请求
        const resultsArray = await Promise.all(searchPromises);
        
        // 合并所有结果
        let allResults = [];
        resultsArray.forEach(results => {
            if (Array.isArray(results) && results.length > 0) {
                allResults = allResults.concat(results);
            }
        });
        
        // 如果没有搜索结果，返回空结果
        if (allResults.length === 0) {
            return JSON.stringify({
                code: 200,
                list: [],
                msg: '所有自定义API源均无搜索结果'
            });
        }
        
        // 去重（根据vod_id和api_url组合）
        const uniqueResults = [];
        const seen = new Set();
        
        allResults.forEach(item => {
            const key = `${item.api_url || ''}_${item.vod_id}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(item);
            }
        });
        
        return JSON.stringify({
            code: 200,
            list: uniqueResults,
        });
    } catch (error) {
        console.error('自定义API聚合搜索处理错误:', error);
        return JSON.stringify({
            code: 400,
            msg: '自定义API聚合搜索处理失败: ' + error.message,
            list: []
        });
    }
}

// 拦截API请求
(function() {
    const originalFetch = window.fetch;
    // 暴露 originalFetch 供 testSiteAvailability 直接绕过拦截器使用
    window._originalFetch = originalFetch;
    
    window.fetch = async function(input, init) {
        const requestUrl = typeof input === 'string' ? new URL(input, window.location.origin) : input.url;
        
        if (requestUrl.pathname.startsWith('/api/')) {
            if (window.isPasswordProtected && window.isPasswordVerified) {
                if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                    return;
                }
            }
            try {
                const data = await handleApiRequest(requestUrl);
                return new Response(data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            } catch (error) {
                return new Response(JSON.stringify({
                    code: 500,
                    msg: '服务器内部错误',
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
        }
        
        // 非API请求使用原始fetch
        return originalFetch.apply(this, arguments);
    };
})();

async function testSiteAvailability(apiUrl, detailUrl = '') {
    const result = { accessible: false, searchable: false, playable: false };
    // 使用 _originalFetch 直接走 /proxy/ 路径，完全绕开 /api/* 拦截器
    const directFetch = window._originalFetch || window.fetch;
    
    // 辅助函数：根据 proxyAuth 构建带鉴权的 proxy URL
    async function buildProxyUrl(targetUrl) {
        const raw = PROXY_URL + encodeURIComponent(targetUrl);
        if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
            return await window.ProxyAuth.addAuthToProxyUrl(raw);
        }
        return raw;
    }
    
    try {
        // ===== 1. 访问性 & 搜索性测试 =====
        // 直接请求外部 API，不走 /api/search 拦截器
        const searchApiUrl = apiUrl + API_CONFIG.search.path + encodeURIComponent('流浪地球');
        const searchProxyUrl = await buildProxyUrl(searchApiUrl);
        
        const searchRes = await directFetch(searchProxyUrl, {
            headers: API_CONFIG.search.headers,
            signal: AbortSignal.timeout(10000)
        });
        
        if (!searchRes.ok) {
            console.warn('[API测试] 搜索请求失败:', searchRes.status, apiUrl);
            return result;
        }
        result.accessible = true;
        
        let searchData;
        try {
            searchData = await searchRes.json();
        } catch (e) {
            console.warn('[API测试] 搜索返回非JSON:', apiUrl);
            return result;
        }
        
        if (!searchData || !Array.isArray(searchData.list) || searchData.list.length === 0) {
            console.warn('[API测试] 搜索无结果:', apiUrl);
            return result;
        }
        result.searchable = true;
        
        // ===== 2. 播放性测试 =====
        // 获取第一个视频的详情
        const videoId = searchData.list[0].vod_id;
        if (!videoId) return result;
        
        const detailApiUrl = apiUrl + API_CONFIG.detail.path + videoId;
        const detailProxyUrl = await buildProxyUrl(detailApiUrl);
        
        const detailRes = await directFetch(detailProxyUrl, {
            headers: API_CONFIG.detail.headers,
            signal: AbortSignal.timeout(10000)
        });
        
        if (!detailRes.ok) {
            console.warn('[API测试] 详情请求失败:', detailRes.status);
            return result;
        }
        
        let detailData;
        try {
            detailData = await detailRes.json();
        } catch (e) {
            console.warn('[API测试] 详情返回非JSON');
            return result;
        }
        
        // 从详情中提取播放地址
        if (!detailData || !Array.isArray(detailData.list) || detailData.list.length === 0) {
            console.warn('[API测试] 详情数据为空');
            return result;
        }
        
        const videoDetail = detailData.list[0];
        let episodes = [];
        
        if (videoDetail.vod_play_url) {
            const playSources = videoDetail.vod_play_url.split('$$$');
            if (playSources.length > 0) {
                const mainSource = playSources[0];
                const episodeList = mainSource.split('#');
                episodes = episodeList.map(ep => {
                    const parts = ep.split('$');
                    return parts.length > 1 ? parts[1] : '';
                }).filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
            }
        }
        
        if (episodes.length === 0) {
            console.warn('[API测试] 未找到播放地址');
            return result;
        }
        
        // 找 m3u8 或 mp4 链接
        let m3u8Url = episodes.find(url => url.includes('.m3u8'));
        if (!m3u8Url) {
            const mp4Url = episodes.find(url => url.includes('.mp4'));
            if (mp4Url) {
                result.playable = true;
                console.log('[API测试] 发现MP4播放链接, 可播放:', apiUrl);
            }
            return result;
        }
        
        // ===== 3. M3U8 可用性验证 =====
        try {
            const m3u8ProxyUrl = await buildProxyUrl(m3u8Url);
            const m3u8Res = await directFetch(m3u8ProxyUrl, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!m3u8Res.ok) {
                console.warn('[API测试] M3U8 访问失败:', m3u8Res.status);
                return result;
            }
            
            const m3u8Text = await m3u8Res.text();
            
            if (!m3u8Text.includes('#EXTM3U')) {
                console.warn('[API测试] M3U8 内容无效');
                return result;
            }
            
            // 检查嵌套 m3u8
            const lines = m3u8Text.split('\n');
            let nestedUrl = '';
            for (let line of lines) {
                line = line.trim();
                if (line && !line.startsWith('#') && line.includes('.m3u8')) {
                    nestedUrl = line.startsWith('http') ? line : new URL(line, m3u8Url).href;
                    break;
                }
            }
            
            if (nestedUrl) {
                // 有嵌套，请求子 m3u8
                const nestedProxyUrl = await buildProxyUrl(nestedUrl);
                const subRes = await directFetch(nestedProxyUrl, {
                    signal: AbortSignal.timeout(10000)
                });
                if (subRes.ok) {
                    const subText = await subRes.text();
                    if (subText.includes('.ts') || subText.includes('.mp4') || subText.includes('.m3u8')) {
                        result.playable = true;
                        console.log('[API测试] 嵌套M3U8验证通过, 可播放:', apiUrl);
                    }
                }
            } else {
                // 非嵌套，直接检查
                if (m3u8Text.includes('.ts') || m3u8Text.includes('.mp4') || m3u8Text.includes('URI=')) {
                    result.playable = true;
                    console.log('[API测试] M3U8直接包含切片, 可播放:', apiUrl);
                }
            }
        } catch (m3u8Error) {
            console.warn('[API测试] M3U8验证异常(可能跨域/防盗链):', m3u8Error.message);
            // 搜索和详情都成功且有链接，但 m3u8 无法直接验证
            // 大部分情况下播放器能播放（播放器有自己的代理机制）
            // 所以标记为 playable，以宽松策略对待
            result.playable = true;
        }
        
        return result;
    } catch (error) {
        console.error('[API测试] 综合测试失败:', error.message, apiUrl);
        return result;
    }
}
