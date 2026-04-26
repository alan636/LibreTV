// 获取当前URL的参数，并立即传递给player.html
window.onload = function() {
    const currentParams = new URLSearchParams(window.location.search);
    const playerUrlObj = new URL('player.html', window.location.origin);
    const statusElement = document.getElementById('redirect-status');
    const manualRedirect = document.getElementById('manual-redirect');

    currentParams.forEach((value, key) => {
        playerUrlObj.searchParams.set(key, value);
    });

    playerUrlObj.searchParams.set('_v', window.APP_ASSET_VERSION || '2.3');

    const referrer = document.referrer;
    const backUrl = currentParams.get('back');

    let returnUrl = '';
    if (backUrl) {
        returnUrl = decodeURIComponent(backUrl);
    } else if (referrer && referrer.trim() !== '') {
        returnUrl = referrer;
    } else {
        returnUrl = '/';
    }

    if (!playerUrlObj.searchParams.has('returnUrl')) {
        playerUrlObj.searchParams.set('returnUrl', encodeURIComponent(returnUrl));
    }

    localStorage.setItem('lastPageUrl', returnUrl);
    if (returnUrl.includes('/s=') || returnUrl.includes('?s=')) {
        localStorage.setItem('cameFromSearch', 'true');
        localStorage.setItem('searchPageUrl', returnUrl);
    }

    const finalPlayerUrl = playerUrlObj.toString();
    if (manualRedirect) {
        manualRedirect.href = finalPlayerUrl;
    }

    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
        metaRefresh.content = `0; url=${finalPlayerUrl}`;
    }

    if (statusElement) {
        statusElement.textContent = '正在进入播放器...';
    }

    window.location.replace(finalPlayerUrl);
};
