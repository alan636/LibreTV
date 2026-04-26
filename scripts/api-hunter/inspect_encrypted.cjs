/**
 * 调查被跳过的加密配置内容
 * 输出前 500 字符用于分析加密格式
 */
const fs = require('fs');

const URLS = [
    { name: '王二小', url: 'http://tvbox.王二小放牛娃.top' },
    { name: '肥猫线路', url: 'http://肥猫.com/' },
    { name: '摸鱼接口', url: 'http://我不是.摸鱼儿.com' },
    { name: '饭太硬', url: 'http://www.饭太硬.com/tv' },
    { name: '饭太硬备用', url: 'http://fty.888484.xyz/tv' },
    { name: '影视仓', url: 'http://影视仓.com/' },
    { name: '欧歌4K', url: 'http://tv.nxog.top/m' },
    { name: '菜妮丝', url: 'https://tv.xn--yhqu5zs87a.top' },
    { name: '王二小接口', url: 'http://tvbox.xn--4kq62z5rby2qupq9ub.top/' },
    { name: '王二小放牛娃', url: 'http://tv.999888987.xyz' },
];

async function inspect(entry) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(entry.url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'okhttp/4.12.0' }, // TVBox 常用 UA
            redirect: 'follow'
        });
        clearTimeout(timer);

        const finalUrl = res.url;
        const ct = res.headers.get('content-type') || '';
        const text = await res.text();
        const preview = text.substring(0, 600).replace(/\n/g, '\\n');

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`【${entry.name}】 ${entry.url}`);
        console.log(`  最终URL: ${finalUrl}`);
        console.log(`  Content-Type: ${ct}`);
        console.log(`  长度: ${text.length}`);
        console.log(`  前600字符:`);
        console.log(`  ${preview}`);
        console.log(`${'─'.repeat(60)}`);

        // 检测是否以常见前缀开头
        const trimmed = text.trim();
        if (trimmed.startsWith('{')) console.log('  → 格式: JSON');
        else if (trimmed.startsWith('[')) console.log('  → 格式: JSON Array');
        else if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) console.log('  → 格式: HTML');
        else if (trimmed.startsWith('<?xml')) console.log('  → 格式: XML');
        else if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed.substring(0, 200))) console.log('  → 格式: 可能是 Base64');
        else if (/^[0-9a-fA-F]+$/.test(trimmed.substring(0, 200))) console.log('  → 格式: 可能是 Hex 编码');
        else console.log('  → 格式: 未知/加密');

        return { name: entry.name, url: entry.url, text, length: text.length };
    } catch (e) {
        console.log(`\n【${entry.name}】 ${entry.url} → 失败: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('检查加密/跳过的 TVBox 配置内容...\n');
    const results = [];
    for (const u of URLS) {
        const r = await inspect(u);
        if (r) results.push(r);
    }

    // 保存完整原始内容供分析
    fs.writeFileSync(
        __dirname + '/encrypted_samples.json',
        JSON.stringify(results.map(r => ({
            name: r.name, url: r.url, length: r.length,
            content: r.text.substring(0, 2000)
        })), null, 2),
        'utf8'
    );
    console.log('\n完整样本已保存至 encrypted_samples.json');
}

main();
