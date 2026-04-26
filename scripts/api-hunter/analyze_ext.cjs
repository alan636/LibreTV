const fs = require('fs');

async function main() {
    const url = "http://肥猫.com/";
    console.log(`Fetching ${url}...`);
    
    const res = await fetch(url, { headers: { 'User-Agent': 'okhttp/4.12.0' }});
    const text = await res.text();
    
    let json = null;
    try {
        json = JSON.parse(text);
    } catch(e) {
        console.log("Not raw JSON. Attempting Base64 decode...");
        const base64Pattern = /^[A-Za-z0-9+/=_-]+$/;
        let cleaned = text.trim().replace(/[\r\n\s]/g, '');
        if (base64Pattern.test(cleaned)) {
            cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');
            const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
            json = JSON.parse(decoded);
        } else {
             // maybe it's just raw but with comments?
             // very simple comment removal
             let stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
             json = JSON.parse(stripped);
        }
    }
    
    if (json && json.sites) {
        console.log(`Total sites: ${json.sites.length}`);
        let cspCount = 0;
        let extUrls = [];
        
        for (let s of json.sites) {
            if (s.api && s.api.startsWith('csp_')) {
                cspCount++;
                if (typeof s.ext === 'string' && s.ext.startsWith('http')) {
                    extUrls.push(`[${s.api}] ${s.name} -> ext: ${s.ext}`);
                } else if (typeof s.ext === 'object') {
                    // Sometimes ext is an object containing rules, let's see if it has url
                    extUrls.push(`[${s.api}] ${s.name} -> ext (object) keys: ${Object.keys(s.ext).join(', ')}`);
                }
            }
        }
        console.log(`CSP sites: ${cspCount}`);
        console.log(`CSP sites with HTTP ext: ${extUrls.length}`);
        extUrls.slice(0, 20).forEach(msg => console.log(msg));
    }
}

main().catch(console.error);
