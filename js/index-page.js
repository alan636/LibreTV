const BING_WALLPAPER_CACHE_KEY = 'bingWallpaperSelection';
const BING_WALLPAPER_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';

function getLocalDateKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function buildProxyRequestUrl(targetUrl) {
    const proxyUrl = `/proxy/${encodeURIComponent(targetUrl)}`;
    if (window.ProxyAuth && typeof window.ProxyAuth.addAuthToProxyUrl === 'function') {
        return window.ProxyAuth.addAuthToProxyUrl(proxyUrl);
    }
    return proxyUrl;
}

function applyHomeBackdrop(imageUrl) {
    if (!imageUrl) return;

    const safeUrl = imageUrl.replace(/"/g, '%22');
    document.documentElement.style.setProperty('--home-backdrop-image', `url("${safeUrl}")`);
    console.info('[Homepage] Bing 壁纸已应用:', imageUrl);
}

function getCachedWallpaperSelection() {
    try {
        const cached = JSON.parse(localStorage.getItem(BING_WALLPAPER_CACHE_KEY) || 'null');
        if (cached && cached.date === getLocalDateKey() && cached.imageUrl) {
            return cached.imageUrl;
        }
    } catch (error) {
        console.warn('读取 Bing 壁纸缓存失败:', error);
    }
    return '';
}

function cacheWallpaperSelection(imageUrl) {
    try {
        localStorage.setItem(BING_WALLPAPER_CACHE_KEY, JSON.stringify({
            date: getLocalDateKey(),
            imageUrl
        }));
    } catch (error) {
        console.warn('缓存 Bing 壁纸失败:', error);
    }
}

function normalizeBingImageUrl(image) {
    if (!image) return '';
    if (image.url) {
        return new URL(image.url, 'https://www.bing.com').toString();
    }
    if (image.urlbase) {
        return `https://www.bing.com${image.urlbase}_1920x1080.jpg`;
    }
    return '';
}

function preloadImage(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(imageUrl);
        img.onerror = reject;
        img.src = imageUrl;
    });
}

async function initBingWallpaperBackground() {
    const cachedImageUrl = getCachedWallpaperSelection();
    if (cachedImageUrl) {
        console.info('[Homepage] 使用缓存 Bing 壁纸:', cachedImageUrl);
        const cachedProxyUrl = await buildProxyRequestUrl(cachedImageUrl);
        applyHomeBackdrop(cachedProxyUrl);
        return;
    }

    try {
        console.info('[Homepage] 正在加载 Bing 壁纸');
        const requestUrl = await buildProxyRequestUrl(BING_WALLPAPER_API);
        const response = await fetch(requestUrl, {
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Bing wallpaper request failed: ${response.status}`);
        }

        const data = await response.json();
        const images = Array.isArray(data.images) ? data.images : [];
        if (images.length === 0) {
            throw new Error('No Bing wallpapers returned');
        }

        const randomImage = images[Math.floor(Math.random() * images.length)];
        const imageUrl = normalizeBingImageUrl(randomImage);
        if (!imageUrl) {
            throw new Error('Invalid Bing wallpaper URL');
        }

        const proxiedImageUrl = await buildProxyRequestUrl(imageUrl);
        await preloadImage(proxiedImageUrl);
        cacheWallpaperSelection(imageUrl);
        applyHomeBackdrop(proxiedImageUrl);
    } catch (error) {
        console.error('[Homepage] 初始化 Bing 背景失败，回退到默认背景:', error);
    }
}

// 页面加载后显示弹窗脚本
document.addEventListener('DOMContentLoaded', function() {
    void initBingWallpaperBackground();

    // 弹窗显示脚本
    // 检查用户是否已经看过声明
    const hasSeenDisclaimer = localStorage.getItem('hasSeenDisclaimer');
    
    if (!hasSeenDisclaimer) {
        // 显示弹窗
        const disclaimerModal = document.getElementById('disclaimerModal');
        disclaimerModal.style.display = 'flex';
        
        // 添加接受按钮事件
        document.getElementById('acceptDisclaimerBtn').addEventListener('click', function() {
            // 保存用户已看过声明的状态
            localStorage.setItem('hasSeenDisclaimer', 'true');
            // 隐藏弹窗
            disclaimerModal.style.display = 'none';
        });
    }

    // URL搜索参数处理脚本
    // 首先检查是否是播放URL格式 (/watch 开头的路径)
    if (window.location.pathname.startsWith('/watch')) {
        // 播放URL，不做额外处理，watch.html会处理重定向
        return;
    }
    
    // 检查页面路径中的搜索参数 (格式: /s=keyword)
    const path = window.location.pathname;
    const searchPrefix = '/s=';
    
    if (path.startsWith(searchPrefix)) {
        // 提取搜索关键词
        const keyword = decodeURIComponent(path.substring(searchPrefix.length));
        if (keyword) {
            // 设置搜索框的值
            document.getElementById('searchInput').value = keyword;
            // 显示清空按钮
            toggleClearButton();
            // 执行搜索
            setTimeout(() => {
                // 使用setTimeout确保其他DOM加载和初始化完成
                search();
                // 更新浏览器历史，不改变URL (保持搜索参数在地址栏)
                try {
                    window.history.replaceState(
                        { search: keyword }, 
                        `搜索: ${keyword} - LibreTV`, 
                        window.location.href
                    );
                } catch (e) {
                    console.error('更新浏览器历史失败:', e);
                }
            }, 300);
        }
    }
    
    // 也检查查询字符串中的搜索参数 (格式: ?s=keyword)
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('s');
    
    if (searchQuery) {
        // 设置搜索框的值
        document.getElementById('searchInput').value = searchQuery;
        // 执行搜索
        setTimeout(() => {
            search();
            // 更新URL为规范格式
            try {
                window.history.replaceState(
                    { search: searchQuery }, 
                    `搜索: ${searchQuery} - LibreTV`, 
                    `/s=${encodeURIComponent(searchQuery)}`
                );
            } catch (e) {
                console.error('更新浏览器历史失败:', e);
            }
        }, 300);
    }
});
