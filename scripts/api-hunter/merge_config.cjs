const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', '..', 'js', 'config.js');
const importPath = path.join(__dirname, 'libre_tv_import.json');

let configContent = fs.readFileSync(configPath, 'utf8');
const newApis = JSON.parse(fs.readFileSync(importPath, 'utf8'));

// 提取已存在的 API 列表，防止重复
const existingUrls = new Set();
const urlRegex = /api:\s*['"](https?:\/\/[^'"]+)['"]/g;
let match;
while ((match = urlRegex.exec(configContent)) !== null) {
    existingUrls.add(match[1].replace(/\/+$/, '')); // normalize
}

// 找到 const API_SITES = { 的结束位置 }
const startStr = 'const API_SITES = {';
const startIndex = configContent.indexOf(startStr);
if (startIndex === -1) {
    console.error('Cannot find API_SITES block');
    process.exit(1);
}

// 找到块的结束位置
let braceCount = 0;
let endIndex = -1;
for (let i = startIndex + startStr.length - 1; i < configContent.length; i++) {
    if (configContent[i] === '{') braceCount++;
    else if (configContent[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
            endIndex = i;
            break;
        }
    }
}

if (endIndex === -1) {
    console.error('Cannot find end of API_SITES block');
    process.exit(1);
}

// 构造我们要追加的新 API 字符串
let appendStr = '';
let addedCount = 0;

for (let i = 0; i < newApis.length; i++) {
    const apiObj = newApis[i];
    const normalizedUrl = apiObj.url.replace(/\/+$/, '');
    
    if (existingUrls.has(normalizedUrl)) {
        continue; // 跳过已存在的
    }
    
    // 生成一个独特的 key
    const key = `auto_${Date.now()}_${i}`;
    let line = `    ${key}: { \n        api: '${apiObj.url}', \n`;
    if (apiObj.search_api) {
        line += `        searchApi: '${apiObj.search_api}', \n`;
    }
    line += `        name: '${apiObj.name.replace(/['\\]/g, '')}' \n    },\n`;
    
    appendStr += line;
    addedCount++;
    existingUrls.add(normalizedUrl);
}

if (addedCount > 0) {
    // 移除最后一个逗号（如果有的话，方便格式化），不过在对象末尾加逗号也是合法的
    // 插入到 endIndex 之前
    // 检查倒数第二行是否有逗号，如果没有，需要加上
    let beforeBlock = configContent.substring(0, endIndex);
    if (!beforeBlock.trim().endsWith(',')) {
        // Find the last property and add a comma
        const lastPropRegex = /}(\s*)$/;
        if (lastPropRegex.test(beforeBlock)) {
             beforeBlock = beforeBlock.replace(/}(\s*)$/, '},$1');
        } else {
             // Or maybe it's just a single line property
             beforeBlock = beforeBlock.replace(/([^,\s])(\s*)$/, '$1,$2');
        }
    }
    
    const newContent = beforeBlock + appendStr + configContent.substring(endIndex);
    fs.writeFileSync(configPath, newContent, 'utf8');
    console.log(`Successfully merged ${addedCount} new APIs into js/config.js`);
} else {
    console.log('All APIs in libre_tv_import.json are already present in config.js');
}
