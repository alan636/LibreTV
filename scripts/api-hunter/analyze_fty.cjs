// 分析饭太硬JPEG二进制结构
const fs = require('fs');

async function main() {
    const res = await fetch('http://fty.888484.xyz/tv', {
        headers: { 'User-Agent': 'okhttp/4.12.0' },
        redirect: 'follow'
    });
    const ab = await res.arrayBuffer();
    const b = Buffer.from(ab);
    
    console.log('Total size:', b.length);
    console.log('First 4 bytes (hex):', b.slice(0, 4).toString('hex'));
    console.log('Is JPEG:', b[0] === 0xFF && b[1] === 0xD8 ? 'YES' : 'NO');
    
    // 查找所有 FFD9 (EOI) 位置
    const eoiPositions = [];
    for (let i = 0; i < b.length - 1; i++) {
        if (b[i] === 0xFF && b[i + 1] === 0xD9) {
            eoiPositions.push(i);
        }
    }
    console.log('EOI (FFD9) positions:', eoiPositions);
    
    if (eoiPositions.length > 0) {
        const last = eoiPositions[eoiPositions.length - 1];
        const after = b.slice(last + 2);
        console.log('After last EOI, remaining bytes:', after.length);
        if (after.length > 0) {
            console.log('After EOI text preview:', after.toString('utf8').substring(0, 500));
        }
    }
    
    // 也看看最后 500 字节
    const tail = b.slice(-500);
    const tailText = tail.toString('utf8');
    console.log('\n--- Last 500 bytes as text ---');
    console.log(tailText.substring(0, 500));
    
    // 查找 JSON 起始标志 { 在二进制中的位置
    for (let i = 0; i < b.length; i++) {
        if (b[i] === 0x7B) { // '{'
            // 检查后面几个字符是否像 JSON
            const snippet = b.slice(i, i + 30).toString('utf8');
            if (snippet.includes('"') && (snippet.includes('spider') || snippet.includes('sites') || snippet.includes('api'))) {
                console.log(`\nFound JSON-like content at offset ${i}:`);
                console.log(b.slice(i, i + 300).toString('utf8'));
                break;
            }
        }
    }
    
    // 保存完整二进制供参考
    fs.writeFileSync(__dirname + '/fty_raw.bin', b);
    console.log('\nRaw binary saved to fty_raw.bin');
}

main().catch(console.error);
