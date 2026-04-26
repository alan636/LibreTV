// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表 - 修改为默认标签
let defaultMovieTags = ['热门', '最新', '经典', '可播放', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈', '日综', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];
let defaultTvTags = ['国产剧', '港剧', '美剧', '英剧', '韩剧', '日剧', '热门', '日本动画', '综艺', '纪录片', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];

// 用户标签列表 - 存储用户实际使用的标签（包含保留的系统标签和用户添加的自定义标签）
let movieTags = [];
let tvTags = [];

// 加载用户标签
function loadUserTags() {
    try {
        // 尝试从本地存储加载用户保存的标签
        const savedMovieTags = localStorage.getItem('userMovieTags');
        const savedTvTags = localStorage.getItem('userTvTags');

        // 如果本地存储中有标签数据，则使用它
        if (savedMovieTags) {
            movieTags = JSON.parse(savedMovieTags);
        } else {
            // 否则使用默认标签
            movieTags = [...defaultMovieTags];
        }

        if (savedTvTags) {
            tvTags = JSON.parse(savedTvTags);
        } else {
            // 否则使用默认标签
            tvTags = [...defaultTvTags];
        }
    } catch (e) {
        console.error('加载标签失败：', e);
        // 初始化为默认值，防止错误
        movieTags = [...defaultMovieTags];
        tvTags = [...defaultTvTags];
    }
}

// 保存用户标签
function saveUserTags() {
    try {
        localStorage.setItem('userMovieTags', JSON.stringify(movieTags));
        localStorage.setItem('userTvTags', JSON.stringify(tvTags));
    } catch (e) {
        console.error('保存标签失败：', e);
        showToast('保存标签失败', 'error');
    }
}

let doubanMovieTvCurrentSwitch = 'movie';
let doubanCurrentTag = '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量
let doubanCurrentSort = 'recommend'; // 当前排序方式: recommend, rank, time
let loadedDoubanIds = new Set(); // 已加载的豆瓣ID，用于去重
let isLoadingDouban = false; // 是否正在加载中
let doubanObserver = null; // 无限滚动观察器
let doubanHasMore = true; // 是否还有更多内容
let doubanRequestGeneration = 0; // 请求代次，用于丢弃过时的响应

function collapseExpandedDoubanCards(exceptCard = null) {
    document.querySelectorAll('#douban-results .movie-card.is-expanded').forEach(card => {
        if (card !== exceptCard) {
            card.classList.remove('is-expanded');
            card.setAttribute('aria-expanded', 'false');
        }
    });
}

function expandDoubanCard(card) {
    if (!card) return;
    collapseExpandedDoubanCards(card);
    card.classList.add('is-expanded');
    card.setAttribute('aria-expanded', 'true');
}

function supportsDoubanHoverPreview() {
    try {
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (error) {
        return false;
    }
}

function shouldUseTwoStepDoubanPlayback(event, card) {
    const pointerType = event?.pointerType || card?.dataset.lastPointerType || '';

    if (pointerType === 'touch' || pointerType === 'pen') {
        return true;
    }

    if (pointerType === 'mouse') {
        return false;
    }

    return !supportsDoubanHoverPreview();
}

function getDoubanCardAriaLabel(title) {
    if (supportsDoubanHoverPreview()) {
        return `查看 ${title} 的信息，单击开始搜索播放`;
    }

    return `查看 ${title} 的信息，第二次点击开始搜索播放`;
}

function rememberDoubanPointerType(event, card) {
    if (!card || !event?.pointerType) return;
    card.dataset.lastPointerType = event.pointerType;
}

function handleDoubanCardPlayback(card, title, useTwoStepPreview = false) {
    if (!card || !title) return;

    if (!useTwoStepPreview) {
        fillAndSearchWithDouban(title);
        return;
    }

    if (card.classList.contains('is-expanded')) {
        fillAndSearchWithDouban(title);
        return;
    }

    expandDoubanCard(card);
}

function handleDoubanCardClick(event, card, title) {
    if (!card || event.target.closest('.douban-btn-style')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleDoubanCardPlayback(card, title, shouldUseTwoStepDoubanPlayback(event, card));
}

function handleDoubanCardKeydown(event, card, title) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleDoubanCardPlayback(card, title, shouldUseTwoStepDoubanPlayback(event, card));
        return;
    }

    if (event.key === 'Escape') {
        card.classList.remove('is-expanded');
        card.setAttribute('aria-expanded', 'false');
    }
}

// 初始化豆瓣功能
function initDouban() {
    // 设置豆瓣开关的初始状态
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
        doubanToggle.checked = isEnabled;

        // 设置开关外观
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg.nextElementSibling;
        if (isEnabled) {
            toggleBg.classList.add('bg-pink-600');
            toggleDot.classList.add('translate-x-6');
        }

        // 添加事件监听
        doubanToggle.addEventListener('change', function (e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);

            // 更新开关外观
            if (isChecked) {
                toggleBg.classList.add('bg-pink-600');
                toggleDot.classList.add('translate-x-6');
            } else {
                toggleBg.classList.remove('bg-pink-600');
                toggleDot.classList.remove('translate-x-6');
            }

            // 更新显示状态
            updateDoubanVisibility();
        });

        // 初始更新显示状态
        updateDoubanVisibility();

        // 滚动到页面顶部
        window.scrollTo(0, 0);
    }

    // 加载用户标签
    loadUserTags();

    // 渲染电影/电视剧切换
    renderDoubanMovieTvSwitch();

    // 渲染豆瓣标签
    renderDoubanTags();

    // 换一批按钮事件监听
    setupDoubanRefreshBtn();

    // 排序按钮事件监听
    setupSortButtons();

    // 无限滚动
    setupInfiniteScroll();

    // 返回顶部按钮
    setupBackToTop();

    // 初始加载热门内容
    if (localStorage.getItem('doubanEnabled') === 'true') {
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    }
}

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;

    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    const isSearching = document.getElementById('resultsArea') &&
        !document.getElementById('resultsArea').classList.contains('hidden');

    // 只有在启用且没有搜索结果显示时才显示豆瓣区域
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        // 豆瓣区域变为可见后，重新挂载无限滚动观察器（解决 hidden 状态下观察器不触发的问题）
        setupInfiniteScroll();
        // 如果豆瓣结果为空，重新加载
        if (document.getElementById('douban-results').children.length === 0) {
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
    } else {
        doubanArea.classList.add('hidden');
    }
}

// 只填充搜索框，不执行搜索，让用户自主决定搜索时机
function fillSearchInput(title) {
    if (!title) return;

    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;

        // 聚焦搜索框，便于用户立即使用键盘操作
        input.focus();

        // 显示一个提示，告知用户点击搜索按钮进行搜索
        showToast('已填充搜索内容，点击搜索按钮开始搜索', 'info');
    }
}

// 填充搜索框并执行搜索
function fillAndSearch(title) {
    if (!title) return;

    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        search(); // 使用已有的search函数执行搜索

        // 同时更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle },
                `搜索: ${safeTitle} - LibreTV`,
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - LibreTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }
    }
}

// 填充搜索框，确保豆瓣资源API被选中，然后执行搜索
async function fillAndSearchWithDouban(title) {
    if (!title) return;

    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // 确保豆瓣资源API被选中
    if (typeof selectedAPIs !== 'undefined' && !selectedAPIs.includes('dbzy')) {
        // 在设置中勾选豆瓣资源API复选框
        const doubanCheckbox = document.querySelector('input[id="api_dbzy"]');
        if (doubanCheckbox) {
            doubanCheckbox.checked = true;

            // 触发updateSelectedAPIs函数以更新状态
            if (typeof updateSelectedAPIs === 'function') {
                updateSelectedAPIs();
            } else {
                // 如果函数不可用，则手动添加到selectedAPIs
                selectedAPIs.push('dbzy');
                localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

                // 更新选中API计数（如果有这个元素）
                const countEl = document.getElementById('selectedAPICount');
                if (countEl) {
                    countEl.textContent = selectedAPIs.length;
                }
            }

            showToast('已自动选择豆瓣资源API', 'info');
        }
    }

    // 填充搜索框并执行搜索
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        await search(); // 使用已有的search函数执行搜索

        // 更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle },
                `搜索: ${safeTitle} - LibreTV`,
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - LibreTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        if (window.innerWidth <= 768) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
    }
}

// 渲染电影/电视剧切换器
function renderDoubanMovieTvSwitch() {
    // 获取切换按钮元素
    const movieToggle = document.getElementById('douban-movie-toggle');
    const tvToggle = document.getElementById('douban-tv-toggle');

    if (!movieToggle || !tvToggle) return;

    movieToggle.addEventListener('click', function () {
        if (doubanMovieTvCurrentSwitch !== 'movie') {
            // 更新按钮样式
            movieToggle.classList.add('bg-pink-600', 'text-white');
            movieToggle.classList.remove('text-gray-300');

            tvToggle.classList.remove('bg-pink-600', 'text-white');
            tvToggle.classList.add('text-gray-300');

            doubanMovieTvCurrentSwitch = 'movie';
            doubanCurrentTag = '热门';
            doubanPageStart = 0;
            doubanCurrentSort = 'recommend';
            resetSortButtons();

            // 重新加载豆瓣内容
            renderDoubanTags(movieTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();

            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });

    // 电视剧按钮点击事件
    tvToggle.addEventListener('click', function () {
        if (doubanMovieTvCurrentSwitch !== 'tv') {
            // 更新按钮样式
            tvToggle.classList.add('bg-pink-600', 'text-white');
            tvToggle.classList.remove('text-gray-300');

            movieToggle.classList.remove('bg-pink-600', 'text-white');
            movieToggle.classList.add('text-gray-300');

            doubanMovieTvCurrentSwitch = 'tv';
            doubanCurrentTag = '热门';
            doubanPageStart = 0;
            doubanCurrentSort = 'recommend';
            resetSortButtons();

            // 重新加载豆瓣内容
            renderDoubanTags(tvTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();

            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });
}

// 渲染豆瓣标签选择器
function renderDoubanTags() {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;

    // 确定当前应该使用的标签列表
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;

    // 定义分类数据
    const movieTagGroups = [
        { name: '综合', tags: ['热门', '最新', '经典', '可播放', '豆瓣高分', '冷门佳片'] },
        { name: '地区', tags: ['华语', '欧美', '韩国', '日本'] },
        { name: '风格', tags: ['动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈', '日综'] },
        { name: '年份', tags: ['2026', '2025', '2024', '2023', '2022', '2021', '2020'] }
    ];

    const tvTagGroups = [
        { name: '地区', tags: ['国产剧', '港剧', '美剧', '英剧', '韩剧', '日剧'] },
        { name: '形式', tags: ['热门', '日本动画', '综艺', '纪录片'] },
        { name: '年份', tags: ['2026', '2025', '2024', '2023', '2022', '2021', '2020'] }
    ];

    const groups = isMovie ? movieTagGroups : tvTagGroups;

    // 清空标签容器
    tagContainer.innerHTML = '';

    // 渲染每一组
    const usedTags = new Set();
    groups.forEach(group => {
        const tagsInGroup = currentTags.filter(tag => group.tags.includes(tag));
        if (tagsInGroup.length === 0) return;

        // 添加组容器
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'flex flex-wrap items-center gap-2 mb-1 w-full';
        
        const groupLabel = document.createElement('span');
        groupLabel.className = 'text-xs font-bold text-pink-500/80 mr-1 min-w-[3.5rem]';
        groupLabel.textContent = group.name + '：';
        groupWrapper.appendChild(groupLabel);

        tagsInGroup.forEach(tag => {
            const btn = createTagButton(tag);
            groupWrapper.appendChild(btn);
            usedTags.add(tag);
        });

        tagContainer.appendChild(groupWrapper);
    });

    // 处理自定义标签 & 管理按钮
    const otherTags = currentTags.filter(tag => !usedTags.has(tag));
    
    // 底部操作栏
    const actionWrapper = document.createElement('div');
    actionWrapper.className = 'flex flex-wrap items-center gap-2 w-full pt-2 border-t border-[#222] mt-1';
    
    // 管理标签按钮
    const manageBtn = document.createElement('button');
    manageBtn.className = 'py-1 px-3 rounded text-sm font-medium transition-all duration-300 bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border border-[#333] hover:border-white flex items-center';
    manageBtn.innerHTML = '<svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>管理标签';
    manageBtn.onclick = showTagManageModal;
    actionWrapper.appendChild(manageBtn);

    if (otherTags.length > 0) {
        const otherLabel = document.createElement('span');
        otherLabel.className = 'text-xs font-bold text-gray-500 mx-1';
        otherLabel.textContent = '自定义：';
        actionWrapper.appendChild(otherLabel);

        otherTags.forEach(tag => {
            const btn = createTagButton(tag);
            actionWrapper.appendChild(btn);
        });
    }
    
    tagContainer.appendChild(actionWrapper);

    // 内部创建按钮的辅助函数
    function createTagButton(tag) {
        const btn = document.createElement('button');
        
        // 设置样式
        let btnClass = 'py-1 px-3 rounded text-sm font-medium transition-all duration-300 border ';

        // 当前选中的标签使用高亮样式
        if (tag === doubanCurrentTag) {
            btnClass += 'bg-pink-600 text-white shadow-md border-white';
        } else {
            btnClass += 'bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border-[#333] hover:border-white';
        }

        btn.className = btnClass;
        btn.textContent = tag;

        btn.onclick = function () {
            if (doubanCurrentTag !== tag) {
                doubanCurrentTag = tag;
                doubanPageStart = 0;
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
                renderDoubanTags();
            }
        };

        return btn;
    }
}

// 设置换一批按钮事件 - 清空瀑布流并重新加载
function setupDoubanRefreshBtn() {
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;

    btn.onclick = function () {
        // 随机跳转到一个新的起始位置，给用户不同的内容
        const maxBatch = 7;
        const randomMultiplier = Math.floor(Math.random() * (maxBatch + 1));
        doubanPageStart = randomMultiplier * doubanPageSize;
        
        // 清空并重新加载
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart, false);
        
        // 滚动到瀑布流顶部
        const doubanArea = document.getElementById('doubanArea');
        if (doubanArea) {
            doubanArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };
}

function fetchDoubanTags() {
    const movieTagsTarget = `https://movie.douban.com/j/search_tags?type=movie`
    fetchDoubanData(movieTagsTarget)
        .then(data => {
            movieTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'movie') {
                renderDoubanTags(movieTags);
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电影标签失败：", error);
        });
    const tvTagsTarget = `https://movie.douban.com/j/search_tags?type=tv`
    fetchDoubanData(tvTagsTarget)
        .then(data => {
            tvTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'tv') {
                renderDoubanTags(tvTags);
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电视剧标签失败：", error);
        });
}

// 渲染热门推荐内容 - 支持追加模式
function renderRecommend(tag, pageLimit, pageStart, appendMode = false) {
    const container = document.getElementById("douban-results");
    if (!container) return;

    // 非追加模式：清空全部状态并重置加载锁，允许新请求立即开始
    if (!appendMode) {
        loadedDoubanIds.clear();
        container.innerHTML = '';
        doubanHasMore = true;
        isLoadingDouban = false;
        doubanRequestGeneration++; // 递增代次，使进行中的旧请求回调失效
    }

    // 防止重复加载（仅在追加模式下有效，非追加模式已在上方重置）
    if (isLoadingDouban) {
        return;
    }
    isLoadingDouban = true;

    const currentGeneration = doubanRequestGeneration; // 捕获当前代次

    // 显示加载指示器
    const loadingEl = document.createElement('div');
    loadingEl.className = 'douban-loading-indicator';
    loadingEl.innerHTML = `
        <div class="flex items-center justify-center">
            <div class="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin inline-block"></div>
            <span class="text-pink-500 ml-4">加载中...</span>
        </div>
    `;
    container.appendChild(loadingEl);

    const target = `https://movie.douban.com/j/search_subjects?type=${doubanMovieTvCurrentSwitch}&tag=${tag}&sort=${doubanCurrentSort}&page_limit=${pageLimit}&page_start=${pageStart}`;

    fetchDoubanData(target)
        .then(data => {
            // 丢弃过时的响应：如果代次已变，说明用户已切换排序/标签
            if (currentGeneration !== doubanRequestGeneration) return;

            container.querySelectorAll('.douban-loading-indicator').forEach(l => l.remove());
            renderDoubanCards(data, container, appendMode);
            isLoadingDouban = false;
            
            // 重新挂载观察器，触发一次检查
            if (doubanHasMore) {
                setTimeout(() => {
                    setupInfiniteScroll();
                }, 200);
            }
        })
        .catch(error => {
            // 丢弃过时的错误
            if (currentGeneration !== doubanRequestGeneration) return;

            console.error("获取豆瓣数据失败：", error);
            container.querySelectorAll('.douban-loading-indicator').forEach(l => l.remove());
            if (!appendMode) {
                container.innerHTML = `
                    <div class="douban-loading-indicator">
                        <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                        <div class="text-gray-500 text-sm mt-2">提示：使用VPN可能有助于解决此问题</div>
                    </div>
                `;
            }
            isLoadingDouban = false;
        });
}

async function fetchDoubanData(url) {
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    // 设置请求选项，包括信号和头部
    const fetchOptions = {
        signal: controller.signal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Referer': 'https://movie.douban.com/',
            'Accept': 'application/json, text/plain, */*',
        }
    };

    try {
        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url)) :
            PROXY_URL + encodeURIComponent(url);

        // 尝试直接访问（豆瓣API可能允许部分CORS请求）
        const response = await fetch(proxiedUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        console.error("豆瓣 API 请求失败（直接代理）：", err);

        // 失败后尝试备用方法：作为备选
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

        try {
            const fallbackResponse = await fetch(fallbackUrl);

            if (!fallbackResponse.ok) {
                throw new Error(`备用API请求失败! 状态: ${fallbackResponse.status}`);
            }

            const data = await fallbackResponse.json();

            // 解析原始内容
            if (data && data.contents) {
                return JSON.parse(data.contents);
            } else {
                throw new Error("无法获取有效数据");
            }
        } catch (fallbackErr) {
            console.error("豆瓣 API 备用请求也失败：", fallbackErr);
            throw fallbackErr; // 向上抛出错误，让调用者处理
        }
    }
}

// 渲染豆瓣卡片 - 支持追加模式和去重
function renderDoubanCards(data, container, appendMode = false) {
    const fragment = document.createDocumentFragment();

    if (!data.subjects || data.subjects.length === 0) {
        doubanHasMore = false;
        if (!appendMode || container.children.length === 0) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "douban-end-indicator";
            emptyEl.innerHTML = `<div class="text-pink-500">❌ 暂无数据，请尝试其他分类或刷新</div>`;
            fragment.appendChild(emptyEl);
        } else {
            const endEl = document.createElement("div");
            endEl.className = "douban-end-indicator";
            endEl.textContent = '—— 已经到底了 ——';
            fragment.appendChild(endEl);
        }
    } else {
        let newItemCount = 0;

        data.subjects.forEach(item => {
            // 去重检查
            if (loadedDoubanIds.has(item.id)) return;
            loadedDoubanIds.add(item.id);
            newItemCount++;

            const safeTitle = item.title
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');

            const card = document.createElement("div");
            card.className = "movie-card group";
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-expanded', 'false');
            card.setAttribute('aria-label', getDoubanCardAriaLabel(item.title));

            const safeRate = (item.rate || "暂无")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            const originalCoverUrl = item.cover;

            card.innerHTML = `
                <div class="poster-container">
                    <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300'><rect fill='%231a1a1a' x='0' y='0' width='300' height='400'/><text fill='%23555' font-family='sans-serif' font-size='14' x='50%' y='50%' text-anchor='middle'>加载中...</text></svg>" alt="${safeTitle}" 
                        class="poster-img"
                        loading="lazy">
                </div>
                
                <!-- 悬浮层 (V7 Pro) -->
                <div class="center-desc cursor-pointer">
                    <!-- 类别 - 固定在 1/5 处 -->
                    <div class="meta-tags-real category-bubble">加载中...</div>
                    
                    <!-- 简介 - 居中显示 -->
                    <p class="desc-text-real summary-text">
                         正在同步影视档案库...
                    </p>

                    <!-- 豆瓣链接 - 跳转按钮样式 -->
                    <div class="douban-link-container">
                        <a class="douban-btn-style" href="${item.url}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();">
                            豆瓣详情 ↗
                        </a>
                    </div>
                </div>

                <!-- 底部常驻信息 - 基座 -->
                <div class="bottom-info-bar pointer-events-none">
                    <div class="rating-star">★ ${safeRate}</div>
                    <div class="bottom-main-row">
                        <h3 class="movie-title">${safeTitle}</h3>
                        <div class="movie-year-real">----</div>
                    </div>
                </div>
            `;

            card.addEventListener('pointerdown', event => rememberDoubanPointerType(event, card));
            card.addEventListener('click', event => handleDoubanCardClick(event, card, item.title));
            card.addEventListener('keydown', event => handleDoubanCardKeydown(event, card, item.title));

            // 存入ID用于后续懒加载详情
            card.setAttribute('data-douban-id', item.id);
            
            // 【异步并发】渲染后立即自动开始获取真实年份、标签和影评
            // 稍作 50-300ms 随机延迟，防止瞬间突发并发冲击代理
            const jitterDelay = Math.floor(Math.random() * 250) + 50;
            setTimeout(() => {
                loadDoubanDetail(card, item.id);
            }, jitterDelay);

            fragment.appendChild(card);
            
            const imgEl = card.querySelector('img');
            if (imgEl) {
                window.loadIntelligentCover(imgEl, safeTitle, originalCoverUrl);
            }
        });

        // 如果所有项目都是重复的，说明已经没有更多新内容
        if (newItemCount === 0) {
            doubanHasMore = false;
            const endEl = document.createElement("div");
            endEl.className = "douban-end-indicator";
            endEl.textContent = '—— 已经到底了 ——';
            fragment.appendChild(endEl);
        }
    }

    if (!appendMode) {
        container.innerHTML = '';
    }
    container.appendChild(fragment);
}

document.addEventListener('click', function(event) {
    if (!event.target.closest('#douban-results .movie-card')) {
        collapseExpandedDoubanCards();
    }
});

// 懒加载豆瓣详情：类型、年份、热评
async function loadDoubanDetail(cardElement, subjectId) {
    if (cardElement.dataset.isLoading === 'true') return;
    cardElement.dataset.isLoading = 'true';

    const abstractTarget = `https://movie.douban.com/j/subject_abstract?subject_id=${subjectId}`;
    
    try {
        const data = await fetchDoubanData(abstractTarget);
        if (data && data.subject) {
            const sub = data.subject;
            
            // 1. 更新真实年份
            const yearEl = cardElement.querySelector('.movie-year-real');
            if (yearEl && sub.release_year) yearEl.textContent = sub.release_year;

            // 2. 更新真实标签
            const tagEl = cardElement.querySelector('.meta-tags-real');
            if (tagEl && sub.types && sub.types.length > 0) {
                tagEl.textContent = sub.types.join(' / ');
                tagEl.classList.remove('text-white/40');
                tagEl.classList.add('text-pink-400');
            }

            // 3. 更新真实简介 (由评分和核心演员组合成事实简介)
            const descEl = cardElement.querySelector('.desc-text-real');
            if (descEl) {
                let infoParts = [];
                if (sub.region) infoParts.push(sub.region);
                if (sub.duration) infoParts.push(sub.duration);
                if (sub.directors && sub.directors.length > 0) infoParts.push(`导演：${sub.directors[0]}`);
                
                let introStr = infoParts.join(' · ') + '<br>';
                if (sub.actors && sub.actors.length > 0) {
                    introStr += `主演：${sub.actors.slice(0, 3).join(' / ')}`;
                } else {
                    introStr += '豆瓣暂无详细演员信息。';
                }
                descEl.innerHTML = introStr;
            }

            cardElement.dataset.loaded = 'true';
        }
    } catch (err) {
        console.error(`加载电影详情失败 (ID: ${subjectId}):`, err);
    } finally {
        cardElement.dataset.isLoading = 'false';
    }
}

// 记录最快且可用的 API 资源站，降低后续每次渲染 16 张图的并发请求量
// 完全智能化的封面加载：针对单张卡片依次进行高可用性 API 查找。
window.loadIntelligentCover = async function(imgElement, title, originalCover) {
    // 立即输出启动日志，确保函数被调用
    console.log(`[CoverLoader] 🚀 收到加载请求: "${title}"`);
    
    try {
        // 安全获取全局变量或从本地存储兜底
        const getGlobalSafely = (name) => {
            try { return window[name] || null; } catch(_) { return null; }
        };

        let gApiStatusCache = getGlobalSafely('apiStatusCache') || {};
        let gApiSites = getGlobalSafely('API_SITES') || {};
        let gCustomAPIs = getGlobalSafely('customAPIs');
        
        // 如果 app.js 还没加载完，尝试从 localStorage 直接读取
        if (!gCustomAPIs) {
            try {
                gCustomAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
                console.log(`[CoverLoader] 从 localStorage 读取到 ${gCustomAPIs.length} 个自定义 API`);
            } catch(e) { gCustomAPIs = []; }
        }

        // 整理后备列表，赋予高优排序
        let priorityUrls = [];
        let backupUrls = [];

        // 1. 最高优先：已有测试记录的自定义 API
        if (Array.isArray(gCustomAPIs)) {
            gCustomAPIs.forEach(api => {
                const s = gApiStatusCache[api.url];
                if (s && (s.playable || s.searchable)) {
                    priorityUrls.push(api.url);
                } else {
                    backupUrls.push(api.url);
                }
            });
        }

        // 2. 其次：内置 API (即使没有缓存，我们也认为它们是可信的)
        Object.values(gApiSites).forEach(api => {
            if (api && api.api) {
                const s = gApiStatusCache[api.api];
                // 如果是健康的，或者还没来得及测试的，都加入优先序列
                if (!s || s.accessible || s.searchable) {
                    priorityUrls.push(api.api);
                }
            }
        });

        // 3. 将未测试的自定义 API 加入队列
        if (backupUrls.length > 0) {
            priorityUrls.push(...backupUrls);
        }

        // 4. 作为兜底的内置大站
        const builtInBackups = ['bfzy', 'ruyi', 'tyyszy'];
        builtInBackups.forEach(key => {
            if (gApiSites[key] && gApiSites[key].api) {
                priorityUrls.push(gApiSites[key].api);
            }
        });

        // 去重并限制尝试数量
        let finalCandidates = [...new Set(priorityUrls)].filter(u => u && u.startsWith('http')).slice(0, 5);
        
        if (finalCandidates.length === 0) {
            console.warn(`[CoverLoader] ⚠️ "${title}" 没有可用的候选 API 列表！`);
        } else {
            console.log(`[CoverLoader] 🔍 "${title}" 备选清单:`, finalCandidates);
        }

        const directFetch = window._originalFetch || window.fetch;
        const searchPath = (window.API_CONFIG && window.API_CONFIG.search) ? window.API_CONFIG.search.path : '?ac=videolist&wd=';

        for (const apiUrl of finalCandidates) {
            try {
                let proxyUrl = (window.PROXY_URL || '/proxy/') + encodeURIComponent(apiUrl + searchPath + encodeURIComponent(title));

                if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
                    proxyUrl = await window.ProxyAuth.addAuthToProxyUrl(proxyUrl);
                }

                console.log(`[CoverLoader] 📡 正在尝试: ${apiUrl}`);
                const res = await directFetch(proxyUrl, { signal: AbortSignal.timeout(3000) });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data && Array.isArray(data.list) && data.list.length > 0) {
                        const validItem = data.list.find(item => item && item.vod_pic && item.vod_pic.startsWith('http'));
                        if (validItem) {
                            console.log(`[CoverLoader] ✅ 成功获取封面: ${validItem.vod_pic}`);
                            imgElement.src = validItem.vod_pic; 
                            imgElement.classList.remove('object-contain');
                            return; 
                        }
                    }
                    console.log(`[CoverLoader] ℹ️ API ${apiUrl} 未搜到该片`);
                } else {
                    console.warn(`[CoverLoader] ❌ API ${apiUrl} 返回错误: ${res.status}`);
                }
            } catch (err) {
                console.warn(`[CoverLoader] ⚠️ 访问 ${apiUrl} 异常:`, err.message || '超时');
            }
        }
    } catch (innerError) {
        console.error(`[CoverLoader] ‼️ 严重崩溃:`, innerError);
    }

    console.warn(`[CoverLoader] ↩️ "${title}" 智能寻找失败，正在通过安全代理回退到豆瓣图...`);
    
    // 终极武器：将豆瓣原图 URL 直接通过本地代理中转，绕过 418
    let finalFallbackUrl = originalCover;
    try {
        const proxyPrefix = window.PROXY_URL || '/proxy/';
        finalFallbackUrl = proxyPrefix + encodeURIComponent(originalCover);
        
        // 如果有鉴权，加上鉴权
        if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
            finalFallbackUrl = await window.ProxyAuth.addAuthToProxyUrl(finalFallbackUrl);
        }
    } catch(e) { /* fallback to original if proxy failed to format */ }

    imgElement.src = finalFallbackUrl;
    imgElement.referrerPolicy = "no-referrer";
    imgElement.classList.add('object-contain');
};

// 重置到首页
function resetToHome() {
    resetSearchArea();
    updateDoubanVisibility();
}

// 更新排序按钮的样式
function updateSortButtonStyles(activeId) {
    const sortIds = ['sort-recommend', 'sort-rank', 'sort-time'];
    sortIds.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (id === activeId) {
            btn.classList.add('bg-pink-600', 'text-white');
            btn.classList.remove('text-gray-300');
        } else {
            btn.classList.remove('bg-pink-600', 'text-white');
            btn.classList.add('text-gray-300');
        }
    });
}

// 设置排序按钮事件
function setupSortButtons() {
    const sortMap = {
        'sort-recommend': 'recommend',
        'sort-rank': 'rank',
        'sort-time': 'time'
    };

    Object.entries(sortMap).forEach(([btnId, sortValue]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        btn.addEventListener('click', () => {
            if (doubanCurrentSort === sortValue) return;

            doubanCurrentSort = sortValue;
            doubanPageStart = 0;

            updateSortButtonStyles(btnId);

            // 清空并重新加载
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart, false);
        });
    });
}

// 重置排序按钮样式到默认状态
function resetSortButtons() {
    updateSortButtonStyles('sort-recommend');
}

// 设置无限滚动
function setupInfiniteScroll() {
    const sentinel = document.getElementById('douban-sentinel');
    if (!sentinel) return;

    // 检查豆瓣区域是否可见
    const doubanArea = document.getElementById('doubanArea');
    if (doubanArea && doubanArea.classList.contains('hidden')) {
        return;
    }

    if (doubanObserver) {
        doubanObserver.disconnect();
    }

    doubanObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoadingDouban && doubanHasMore) {
                const dArea = document.getElementById('doubanArea');
                if (dArea && !dArea.classList.contains('hidden')) {
                    loadMoreDouban();
                }
            }
        });
    }, {
        rootMargin: '0px 0px 800px 0px'
    });

    doubanObserver.observe(sentinel);
}

// 加载更多豆瓣内容
function loadMoreDouban() {
    if (isLoadingDouban || !doubanHasMore) {
        return;
    }
    doubanPageStart += doubanPageSize;
    renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart, true);
}

// 设置返回顶部按钮
function setupBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            btn.classList.remove('opacity-0', 'pointer-events-none');
            btn.classList.add('opacity-100');
        } else {
            btn.classList.add('opacity-0', 'pointer-events-none');
            btn.classList.remove('opacity-100');
        }
    });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// 加载豆瓣首页内容
document.addEventListener('DOMContentLoaded', initDouban);

// 显示标签管理模态框
function showTagManageModal() {
    // 确保模态框在页面上只有一个实例
    let modal = document.getElementById('tagManageModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    // 创建模态框元素
    modal = document.createElement('div');
    modal.id = 'tagManageModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    // 当前使用的标签类型和默认标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    const defaultTags = isMovie ? defaultMovieTags : defaultTvTags;

    // 模态框内容
    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeTagModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold text-white mb-4">标签管理 (${isMovie ? '电影' : '电视剧'})</h3>
            
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-lg font-medium text-gray-300">标签列表</h4>
                    <button id="resetTagsBtn" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">
                        恢复默认标签
                    </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4" id="tagsGrid">
                    ${currentTags.length ? currentTags.map(tag => {
        // "热门"标签不能删除
        const canDelete = tag !== '热门';
        return `
                            <div class="bg-[#1a1a1a] text-gray-300 py-1.5 px-3 rounded text-sm font-medium flex justify-between items-center group">
                                <span>${tag}</span>
                                ${canDelete ?
                `<button class="delete-tag-btn text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" 
                                        data-tag="${tag}">✕</button>` :
                `<span class="text-gray-500 text-xs italic opacity-0 group-hover:opacity-100">必需</span>`
            }
                            </div>
                        `;
    }).join('') :
            `<div class="col-span-full text-center py-4 text-gray-500">无标签，请添加或恢复默认</div>`}
                </div>
            </div>
            
            <div class="border-t border-gray-700 pt-4">
                <h4 class="text-lg font-medium text-gray-300 mb-3">添加新标签</h4>
                <form id="addTagForm" class="flex items-center">
                    <input type="text" id="newTagInput" placeholder="输入标签名称..." 
                           class="flex-1 bg-[#222] text-white border border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-pink-500">
                    <button type="submit" class="ml-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded">添加</button>
                </form>
                <p class="text-xs text-gray-500 mt-2">提示：标签名称不能为空，不能重复，不能包含特殊字符</p>
            </div>
        </div>
    `;

    // 添加模态框到页面
    document.body.appendChild(modal);

    // 焦点放在输入框上
    setTimeout(() => {
        document.getElementById('newTagInput').focus();
    }, 100);

    // 添加事件监听器 - 关闭按钮
    document.getElementById('closeTagModal').addEventListener('click', function () {
        document.body.removeChild(modal);
    });

    // 添加事件监听器 - 点击模态框外部关闭
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // 添加事件监听器 - 恢复默认标签按钮
    document.getElementById('resetTagsBtn').addEventListener('click', function () {
        resetTagsToDefault();
        showTagManageModal(); // 重新加载模态框
    });

    // 添加事件监听器 - 删除标签按钮
    const deleteButtons = document.querySelectorAll('.delete-tag-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const tagToDelete = this.getAttribute('data-tag');
            deleteTag(tagToDelete);
            showTagManageModal(); // 重新加载模态框
        });
    });

    // 添加事件监听器 - 表单提交
    document.getElementById('addTagForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const input = document.getElementById('newTagInput');
        const newTag = input.value.trim();

        if (newTag) {
            addTag(newTag);
            input.value = '';
            showTagManageModal(); // 重新加载模态框
        }
    });
}

// 添加标签
function addTag(tag) {
    // 安全处理标签名，防止XSS
    const safeTag = tag
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;

    // 检查是否已存在（忽略大小写）
    const exists = currentTags.some(
        existingTag => existingTag.toLowerCase() === safeTag.toLowerCase()
    );

    if (exists) {
        showToast('标签已存在', 'warning');
        return;
    }

    // 添加到对应的标签数组
    if (isMovie) {
        movieTags.push(safeTag);
    } else {
        tvTags.push(safeTag);
    }

    // 保存到本地存储
    saveUserTags();

    // 重新渲染标签
    renderDoubanTags();

    showToast('标签添加成功', 'success');
}

// 删除标签
function deleteTag(tag) {
    // 热门标签不能删除
    if (tag === '热门') {
        showToast('热门标签不能删除', 'warning');
        return;
    }

    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;

    // 寻找标签索引
    const index = currentTags.indexOf(tag);

    // 如果找到标签，则删除
    if (index !== -1) {
        currentTags.splice(index, 1);

        // 保存到本地存储
        saveUserTags();

        // 如果当前选中的是被删除的标签，则重置为"热门"
        if (doubanCurrentTag === tag) {
            doubanCurrentTag = '热门';
            doubanPageStart = 0;
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }

        // 重新渲染标签
        renderDoubanTags();

        showToast('标签删除成功', 'success');
    }
}

// 重置为默认标签
function resetTagsToDefault() {
    // 确定当前使用的是电影还是电视剧
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';

    // 重置为默认标签
    if (isMovie) {
        movieTags = [...defaultMovieTags];
    } else {
        tvTags = [...defaultTvTags];
    }

    // 设置当前标签为热门
    doubanCurrentTag = '热门';
    doubanPageStart = 0;

    // 保存到本地存储
    saveUserTags();

    // 重新渲染标签和内容
    renderDoubanTags();
    renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);

    showToast('已恢复默认标签', 'success');
}
