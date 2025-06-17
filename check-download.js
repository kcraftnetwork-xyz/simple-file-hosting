const blockedUserAgents = [
    /wget/i,
    /curl/i,
    /IDM/i,
    /Downloader/i,
    /libwww-perl/i,
    /python/i,
    /node-fetch/i,
    /axios/i,
    /got/i,
    /superagent/i,
    /bot/i,
    /crawler/i,
    /spider/i
];

/**
 * 检查现代浏览器特性
 * @param {Object} req - Express 请求对象
 * @returns {boolean} - true 表示是现代浏览器
 */
function checkModernBrowserFeatures(req) {
    const headers = req.headers;
    let score = 0;
    const minScore = 5; // 最低需要5分才认为是现代浏览器

    // 1. 检查 Accept 头部 (现代浏览器通常支持多种格式)
    if (headers.accept && headers.accept.includes('text/html')) score++;
    if (headers.accept && headers.accept.includes('image/webp')) score++;

    // 2. 检查 Accept-Language (现代浏览器通常会发送语言偏好)
    if (headers['accept-language']) score++;

    // 3. 检查 Accept-Encoding (现代浏览器支持多种压缩方式)
    if (headers['accept-encoding'] && 
        headers['accept-encoding'].includes('gzip') && 
        headers['accept-encoding'].includes('deflate')) {
        score++;
    }

    // 4. 检查 Sec-* 头部 (现代浏览器的安全特性)
    if (headers['sec-fetch-dest']) score++;
    if (headers['sec-fetch-mode']) score++;
    if (headers['sec-fetch-site']) score++;
    if (headers['sec-ch-ua']) score++;

    // 5. 检查 Connection 和 Upgrade-Insecure-Requests
    if (headers.connection === 'keep-alive') score++;
    if (headers['upgrade-insecure-requests'] === '1') score++;

    // 6. 检查 Cache-Control
    if (headers['cache-control']) score++;

    return score >= minScore;
}

/**
 * 检查是否为正常浏览器访问
 * @param {string} userAgent - 浏览器 User-Agent 字符串
 * @returns {boolean} - true 表示是正常浏览器
 */
function isValidBrowser(userAgent) {
    if (!userAgent) return false;

    // 检查已知下载工具特征
    for (const pattern of blockedUserAgents) {
        if (pattern.test(userAgent)) return false;
    }

    // 检查现代浏览器特征
    const modernBrowsers = [
        // Chrome 和基于 Chromium 的浏览器
        /Chrome\/([0-9]+)/i,
        // Firefox
        /Firefox\/([0-9]+)/i,
        // Safari
        /Safari\/([0-9]+)/i,
        // Edge (Chromium)
        /Edg\/([0-9]+)/i,
        // Opera
        /OPR\/([0-9]+)/i
    ];

    return modernBrowsers.some(pattern => {
        const match = userAgent.match(pattern);
        if (!match) return false;
        // 检查版本号是否够新
        const version = parseInt(match[1]);
        return version >= 70; // 设置一个合理的最低版本号
    });
}

/**
 * 验证下载请求
 */
function validateDownloadRequest(req, res, next) {
    const userAgent = req.get('User-Agent');
    const referrer = req.get('Referrer') || req.get('Referer');
    const ip = req.ip || req.connection.remoteAddress;
    
    // 记录请求信息
    console.log(`[${new Date().toLocaleString('zh-CN')}] 下载请求:`, {
        ip,
        userAgent,
        referrer,
        path: req.path,
        headers: req.headers
    });

    // 1. 检查 User-Agent
    if (!isValidBrowser(userAgent)) {
        console.log(`[${new Date().toLocaleString('zh-CN')}] 非法User-Agent:`, userAgent);
        return res.status(403).send('仅允许现代浏览器下载');
    }

    // 2. 检查现代浏览器特性
    if (!checkModernBrowserFeatures(req)) {
        console.log(`[${new Date().toLocaleString('zh-CN')}] 缺少现代浏览器特性`);
        return res.status(403).send('请使用现代浏览器访问');
    }

    // 3. 检查 Referrer
    if (!referrer && !req.path.includes('index.html')) {
        return res.status(403).send('请通过正常页面访问下载链接 <a href="/">返回首页</a>');
    }

    // 4. 检查是否支持 JavaScript (通过cookie验证)
    const hasJsCheck = req.cookies && req.cookies.jsEnabled;
    if (!hasJsCheck) {
        // 首次访问，发送检查页面
        return res.send(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>浏览器验证</title>
                    <script>
                        document.cookie = "jsEnabled=true; path=/";
                        window.location.reload();
                    </script>
                </head>
                <body>
                    <noscript>请启用JavaScript以继续访问</noscript>
                    <p>正在验证浏览器...</p>
                </body>
            </html>
        `);
    }

    next();
}

module.exports = validateDownloadRequest;