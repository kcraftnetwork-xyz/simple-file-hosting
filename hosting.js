const express = require("express");
const axios = require("axios");
const path = require("path");
const throttle = require('express-throttle-bandwidth');
const app = express();
const cookieParser = require('cookie-parser');
const fs = require("fs");
const validateDownloadRequest = require('./check-download');

app.use(cookieParser());

// 获取真实IP的函数
function getRealIP(req) {
  let ip = req.headers['x-forwarded-for'] || 
          req.headers['x-real-ip'] || 
          req.ip || 
          req.connection.remoteAddress;
          
  // 如果是 x-forwarded-for，取第一个 IP
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  
  // 处理 IPv6 格式
  if (ip && ip.substr(0, 7) == "::ffff:") {
    ip = ip.substr(7);
  }
  
  return ip || '未知IP';
}

const MAX_CACHE_SIZE = 100;
const ipInfoCache = new Map();
const ipAccessTimes = new Map(); // 按照获取时间排序的 Map

async function getIPInfo(ip) {
  if (ipInfoCache.has(ip)) {
    ipAccessTimes.set(ip, Date.now());
    return ipInfoCache.get(ip);
  }

  try {
    // 自动移除最老的
    if (ipInfoCache.size >= MAX_CACHE_SIZE) {
      let oldestIp = null;
      let oldestTime = Infinity;
      
      for (const [cachedIp, time] of ipAccessTimes) {
        if (time < oldestTime) {
          oldestTime = time;
          oldestIp = cachedIp;
        }
      }
      
      if (oldestIp) {
        ipInfoCache.delete(oldestIp);
        ipAccessTimes.delete(oldestIp);
      }
    }

    const response = await axios.get(`https://ipinfo.io/${ip}`);
    const { country, city, region } = response.data;
    const ipInfo = { country, city, region };
    ipInfoCache.set(ip, ipInfo);
    ipAccessTimes.set(ip, Date.now());
    return ipInfo;
  } catch (error) {
    console.error('获取IP信息失败:', error.message);
    ipInfoCache.set(ip, null);
    ipAccessTimes.set(ip, Date.now());
    return null;
  }
}

// 只获取一次IP信息，后续直接返回缓存
app.use(async (req, res, next) => {
  const timestamp = new Date().toLocaleString('zh-CN');
  const ip = getRealIP(req);
  const method = req.method;
  const url = req.url;
  const userAgent = req.get('User-Agent');

  if (ipInfoCache.has(ip)) {
    req.ipInfo = ipInfoCache.get(ip);
  } else {
    req.ipInfo = await getIPInfo(ip);
  }

  const ipInfoStr = req.ipInfo
    ? `${req.ipInfo.country || ''} ${req.ipInfo.region || ''} ${req.ipInfo.city || ''}`.trim()
    : '未知位置';

  res.on('finish', () => {
    console.log(`[${timestamp}] ${ip} ${ipInfoStr} ${method} ${url} "${userAgent}" Status: ${res.statusCode}`);
  });

  next();
});

// 读取配置文件
const config = require('./config.json');
const e = require("express");
const PORT = process.env.PORT || config.port;
const HOST = config.host;

// 设置下载速度限制（单位：Mbps）
const SPEED_LIMIT = config.speedLimit.speed;
const BYTES_PER_SECOND = config.speedLimit.enable ? (SPEED_LIMIT * 1024 * 1024) / 8 : 0;

// 文件名编码函数
function encodeFileName(fileName) {
  return encodeURIComponent(fileName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%20/g, ' ');
}


// 设置静态文件目录中间件
const staticMiddleware = express.static(path.join(__dirname, "files"), {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeFileName(fileName)}`);
  }
});

// 根据配置决定是否启用限速
if (config.speedLimit.enable) {
    app.use("/files", validateDownloadRequest, throttle(BYTES_PER_SECOND), staticMiddleware);
} else {
    app.use("/files", validateDownloadRequest, staticMiddleware);
}


// 递归获取目录结构的函数
async function getDirectoryStructure(dirPath) {
  const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const result = [];
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const relativePath = path.relative(path.join(__dirname, 'files'), fullPath);
    
    if (item.isDirectory()) {
      const children = await getDirectoryStructure(fullPath);
      result.push({
        name: item.name,
        path: relativePath,
        isDirectory: true,
        children
      });
    } else {
      result.push({
        name: item.name,
        path: relativePath,
        isDirectory: false
      });
    }
  }
  
  return result;
}

// 处理robots.txt
app.get("/robots.txt", (req, res) => {
  res.type('text/plain');
  res.send("User-agent: *\nDisallow: /");
});

// 修改 /files 路由处理
app.get("/files/*", async (req, res) => {
  try {
    const requestPath = req.path.replace('/files', '') || '/';
    const fullPath = path.join(__dirname, 'files', requestPath);
    
    // 安全检查：确保请求路径在 files 目录下
    if (!fullPath.startsWith(path.join(__dirname, 'files'))) {
      return res.status(403).send('Access denied');
    }

    const stat = await fs.promises.stat(fullPath);
    
    if (stat.isDirectory()) {
      const structure = await getDirectoryStructure(fullPath);
      
      // 生成面包屑导航
      const pathParts = requestPath.split('/').filter(Boolean);
      let breadcrumbs = '<a href="/files">根目录</a>';
      let currentPath = '';
      
      for (const part of pathParts) {
        currentPath += '/' + part;
        breadcrumbs += ` > <a href="/files${currentPath}">${part}</a>`;
      }

      // 生成目录和文件列表
      function generateList(items) {
        return items.map(item => {
          if (item.isDirectory) {
            return `<li>📁 <a href="/files/${item.path}">${item.name}/</a></li>`;
          } else {
            return `<li>📄 <a href="/files/${item.path}">${item.name}</a></li>`;
          }
        }).join('\n');
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Files List - ${requestPath}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              .breadcrumbs { margin-bottom: 20px; }
              ul { list-style-type: none; padding-left: 20px; }
              li { margin: 5px 0; }
              .download-speed { position: fixed; top: 10px; right: 10px; }
              .visitor-info { position: fixed; bottom: 10px; right: 10px; background: #f0f0f0; padding: 10px; border-radius: 5px; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="breadcrumbs">${breadcrumbs}</div>
            <div class="download-speed">
              ${config.speedLimit.enable 
                ? `当前下载速度限制: ${SPEED_LIMIT}Mbps` 
                : '未启用速度限制'}
            </div>
            <h2>当前目录: ${requestPath || '/'}</h2>
            <ul>
              ${generateList(structure)}
            </ul>
              <div class="visitor-info">
              <p>访问信息：</p>
              <p>IP地址：${getRealIP(req)}</p>
              <p>位置信息：${req.ipInfo ? `${req.ipInfo.country} ${req.ipInfo.city} ${req.ipInfo.region}` : '未知位置'}</p>
              <p>浏览器：${req.get('User-Agent')}</p>
              <p>访问时间：${new Date().toLocaleString('zh-CN')}</p>
            </div>
          </body>
        </html>
      `);
      return;
    } else if (stat.isFile()) {
      // 文件请求，进行下载检查
      validateDownloadRequest(req, res, () => {
        // 交给静态中间件处理文件下载
        staticMiddleware(req, res, next);
      });
      return;
    } else {
      res.status(404).send('File not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error reading directory');
  }
});

// 处理根目录的请求
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>File Hosting</title>
        <style>
          .visitor-info {
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: #f0f0f0;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <h1>私人文件托管服务</h1>
        <p>${config.speedLimit.enable 
          ? `当前下载速度限制: ${SPEED_LIMIT}Mbps`
          : '未启用速度限制'}</p>
        <p><a href="/files">浏览文件</a></p>
          <div class="visitor-info">
            <p>访问信息：</p>
            <p>IP地址：${getRealIP(req)}</p>
            <p>位置信息：${req.ipInfo ? `${req.ipInfo.country} ${req.ipInfo.city} ${req.ipInfo.region}` : '未知位置'}</p>
            <p>浏览器：${req.get('User-Agent')}</p>
            <p>访问时间：${new Date().toLocaleString('zh-CN')}</p>
          </div>
      </body>
    </html>
  `);
});

// 处理 404 错误
app.use((req, res) => {
  res.status(404).send("File not found");
});

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
  if (config.speedLimit.enable) {
    console.log(`Download speed limit: ${SPEED_LIMIT}Mbps`);
  } else {
    console.log('Speed limit is disabled');
  }
});
