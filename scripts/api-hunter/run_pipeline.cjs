const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 开始自动化提取与清洗全流程 (API-Hunter Pipeline)...\n');

try {
    console.log('▶️ [步骤 1/2] 正在抓取各大站点的 TVBox 配置并提取底层视频 API...');
    execSync(`node "${path.join(__dirname, '1_scrape_configs.cjs')}"`, { stdio: 'inherit' });
    
    console.log('\n▶️ [步骤 2/2] 正在合并现存 API，并进行可用性清洗测试...');
    execSync(`node "${path.join(__dirname, '2_test_apis.cjs')}"`, { stdio: 'inherit' });
    
    console.log('\n✅ 全流程执行完毕！');
    console.log('🎉 最终清洗结果已存放在: scripts/api-hunter/libre_tv_import.json');
    console.log('您可以直接复制该文件内容到前端项目中进行批量导入。');
} catch (error) {
    console.error('\n❌ 脚本执行失败，请检查上方日志。');
    process.exit(1);
}
