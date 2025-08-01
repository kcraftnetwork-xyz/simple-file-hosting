const path = require('path');
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
const config = require('./config.json');

// 判断是否为文件下载请求
function isFileDownload(req) {
    // 通过拓展名判断
    const ext = path.extname(req.path).toLowerCase();
    // 常见文件类型
    const fileExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.exe', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mp3', '.apk', '.iso', '.txt'];
    if (fileExts.includes(ext)) return true;

    // 通过 accept 头判断
    const accept = req.headers['accept'] || '';
    if (accept.includes('application/octet-stream') || accept.includes('attachment')) return true;

    // 通过 content-disposition 判断（部分浏览器会带）
    const disposition = req.headers['content-disposition'] || '';
    if (disposition.includes('attachment')) return true;

    return false;
}

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
        /Chrome\/([0-9]+)/i,
        /Firefox\/([0-9]+)/i,
        /Safari\/([0-9]+)/i,
        /Edg\/([0-9]+)/i,
        /OPR\/([0-9]+)/i
    ];

    return modernBrowsers.some(pattern => {
        const match = userAgent.match(pattern);
        if (!match) return false;
        const version = parseInt(match[1]);
        return version >= 70;
    });
}

/**
 * 验证下载请求
 */
function validateDownloadRequest(req, res, next) {
    // 只有真正下载文件时才进行检查
    if (!isFileDownload(req)) {
        return next();
    }

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

    // 优先判断referrer是否属于允许的来源
    if (
        config.downloadCheck?.enableReferrer &&
        referrer &&
        Array.isArray(config.downloadCheck.allowedRefDomains) &&
        config.downloadCheck.allowedRefDomains.some(domain => referrer.includes(domain))
    ) {
        return next(); // 直接放行
    }

    // 1. 检查 User-Agent
    if (config.downloadCheck?.enableUserAgent && !isValidBrowser(userAgent)) {
        const reason = 'User-Agent 非现代浏览器或疑似下载工具';
        console.log(`[${new Date().toLocaleString('zh-CN')}] 拒绝下载: ${reason}`);
        return res.status(403).send(`仅允许现代浏览器下载 <a href="/">返回首页</a><br>原因：${reason}`);
    }

    // 2. 检查现代浏览器特性
    if (config.downloadCheck?.enableBrowserFeature && !checkModernBrowserFeatures(req)) {
        const reason = '请求头缺少现代浏览器特性';
        console.log(`[${new Date().toLocaleString('zh-CN')}] 拒绝下载: ${reason}`);
        return res.status(403).send(`请使用现代浏览器访问 <a href="/">返回首页</a><br>原因：${reason}`);
    }

    // 3. 检查 Referrer（无referrer且不是index.html页面）
    if (config.downloadCheck?.enableReferrer && !referrer && !req.path.includes('index.html')) {
        const reason = '无有效来源页面 Referrer';
        console.log(`[${new Date().toLocaleString('zh-CN')}] 拒绝下载: ${reason}`);
        return res.status(403).send(`请通过正常页面访问下载链接 <a href="/">返回首页</a><br>原因：${reason}`);
    }

    // 4. 检查是否支持 JavaScript (通过cookie验证)
    const hasJsCheck = req.cookies && req.cookies.jsEnabled;
    if (config.downloadCheck?.enableJsCheck && !hasJsCheck) {
        const reason = '未检测到 JavaScript 支持';
        console.log(`[${new Date().toLocaleString('zh-CN')}] 拒绝下载: ${reason}`);
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
                    <p style="color:red;">原因：${reason}</p>
                </body>
            </html>
        `);
    }

    next();
}

module.exports = validateDownloadRequest;
