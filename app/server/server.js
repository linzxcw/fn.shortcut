const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const querystring = require("querystring");
const crypto = require("crypto");

// 假设这些变量已定义或传入
const systemStatus = { ready: false };
const fn_www = "/usr/trim/www";
const fn_res = "/usr/trim/share/.restore";
const fndata = `/var/apps/fn.shortcut/target/server/filedata`;
const PORT = 15778;

// 日志存储
let logs = [];
// SSE连接存储
let logSSEConnections = [];

// 密码相关配置
const passwordFilePath = path.join(fndata, 'password.json');
const sessionTimeout = 24 * 60 * 60 * 1000; // 会话有效期1天
let activeSessions = new Map(); // 存储活跃会话

// 密码相关函数
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, storedHash, storedSalt) {
    const hash = crypto.pbkdf2Sync(password, storedSalt, 1000, 64, 'sha512').toString('hex');
    return hash === storedHash;
}

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function loadPassword() {
    try {
        if (fs.existsSync(passwordFilePath)) {
            const data = fs.readFileSync(passwordFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('加载密码文件失败:', error.message);
    }
    return null;
}

function savePassword(passwordHash) {
    try {
        ensureDirectoryExists(path.dirname(passwordFilePath));
        fs.writeFileSync(passwordFilePath, JSON.stringify(passwordHash, null, 2));
        return true;
    } catch (error) {
        console.error('保存密码文件失败:', error.message);
        return false;
    }
}

function checkSession(sessionId) {
    if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        const now = Date.now();
        if (now - session.timestamp < sessionTimeout) {
            // 更新会话时间戳
            session.timestamp = now;
            activeSessions.set(sessionId, session);
            return true;
        } else {
            // 会话过期，移除
            activeSessions.delete(sessionId);
        }
    }
    return false;
}

function createSession() {
    const sessionId = generateSessionId();
    activeSessions.set(sessionId, { timestamp: Date.now() });
    return sessionId;
}

// 辅助函数
function getBeijingTime() {
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date).replace(/\//g, "-") + " - ";
}

function ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        safeChmod(dir, 493);
    }
}

function safeChmod(file, mode) {
    try {
        if (fs.existsSync(file)) {
            fs.chmodSync(file, mode);
            return true;
        }
        console.log("文件不存在，跳过chmod: " + file);
        return false;
    } catch (e) {
        console.error("chmod操作失败: " + file, e.message);
        return false;
    }
}

function modifyHtmlFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, "utf8");
            
            // 检查是否已经添加了FileManagerEnhancer.js引用
            if (!content.includes('FileManagerEnhancer.js')) {
                // 在<body>标签后添加引用，保留原有的所有内容
                const regex = /<body>/;
                if (regex.test(content)) {
                    content = content.replace(regex, `<body>
    <script src="./filedata/FileManagerEnhancer.js?v=${Date.now()}"></script>`);
                    fs.writeFileSync(filePath, content, "utf8");
                    return true;
                }
                console.log('未找到<body>标签');
                return false;
            }
            console.log('FileManagerEnhancer.js引用已存在，跳过修改');
            return true;
        }
        console.log("目标HTML文件不存在");
        return false;
    } catch (e) {
        console.error("修改HTML文件失败:", e);
        return false;
    }
}

function setPermissionsRecursively(dir) {
    try {
        if (fs.existsSync(dir)) {
            fs.chmodSync(dir, 493);
            fs.readdirSync(dir).forEach(file => {
                const filePath = path.join(dir, file);
                try {
                    if (fs.lstatSync(filePath).isDirectory()) {
                        setPermissionsRecursively(filePath);
                    } else {
                        fs.chmodSync(filePath, 420);
                    }
                } catch (e) {}
            });
        } else {
            console.error("目录不存在，跳过权限设置:", dir);
        }
    } catch (e) {
        console.error("设置权限时出错:", e.message);
    }
}

// 添加日志
function addLog(message, showTime = true) {
    const logEntry = showTime ? getBeijingTime() + message : message;
    console.log(logEntry);
    logs.push(logEntry);
    // 限制日志数量，只保留最近100条
    if (logs.length > 100) {
        logs.shift();
    }
    
    // 向所有SSE连接推送日志
    logSSEConnections.forEach(connection => {
        try {
            connection.write(`data: ${logEntry}\n\n`);
        } catch (error) {
            // 连接已关闭，从数组中移除
            const index = logSSEConnections.indexOf(connection);
            if (index > -1) {
                logSSEConnections.splice(index, 1);
            }
        }
    });
    
    return logEntry;
}

// 主函数：应用配置
function applyConfig() {
    // 开始初始化配置日志
    addLog("开始初始化配置...");

    // 创建ZIP对象用于备份
    const admZip = require("adm-zip");
    const zip = new admZip();
    let wwwDir = path.join(fn_www);  // 飞牛www目录
    var filedataDir = path.join(wwwDir, "filedata"),  // filedata目录
        resDir = path.join(fn_res);  // 飞牛资源目录
    let towDir = path.join(resDir, "fncs-tow");  // fncs-tow目录
    var zipFile = path.join(resDir, "www.zip"),  // ZIP主文件
        bakFile = path.join(resDir, "www.bak");  // BAK备份文件

    try {
        // 检查并创建必要的目录
        addLog("检查目录结构...");
        ensureDirectoryExists(towDir);
        addLog(`创建目录: ${towDir}`);
        
        // 直接复制wwwDir里的所有文件到fncs-tow文件夹
        addLog("开始复制文件...");
        if (fs.existsSync(wwwDir)) {
            addLog(`源目录: ${wwwDir}`);
            addLog(`目标目录: ${towDir}`);
            
            // 使用fs.cpSync直接复制整个目录
            try {
                fs.cpSync(wwwDir, towDir, { recursive: true, force: true });
                addLog("文件复制完成");
            } catch (copyError) {
                addLog(`复制文件时出错: ${copyError.message}`);
            }
        } else {
            addLog(`警告: 源目录 ${wwwDir} 不存在`);
        }
        
        var filteredFiles = path.join(fndata);  // fndata目录

        // 备份逻辑
        addLog("开始备份逻辑...");
        if (!fs.existsSync(bakFile) && fs.existsSync(zipFile)) {
            fs.renameSync(zipFile, bakFile);
            addLog(`备份文件: ${zipFile} -> ${bakFile}`);
        } else if (fs.existsSync(bakFile)) {
            addLog(`备份文件已存在: ${bakFile}`);
        }

        // 处理HTML文件
        addLog("开始处理HTML文件...");
        var indexInTow = path.join(towDir, "index.html");
        if (fs.existsSync(indexInTow)) {
            addLog(`修改文件: ${indexInTow}`);
            if (modifyHtmlFile(indexInTow)) {
                safeChmod(indexInTow, 420);
                addLog(`修改成功: ${indexInTow}`);
            } else {
                addLog(`修改失败: ${indexInTow}`);
            }
        } else {
            addLog(`文件不存在: ${indexInTow}`);
        }
        

        
        // 复制filedata目录
        addLog("开始复制filedata目录...");
        if (fs.existsSync(filteredFiles)) {
            var copyPath = path.join(towDir, "filedata");
            addLog(`复制: ${filteredFiles} -> ${copyPath}`);
            fs.cpSync(filteredFiles, copyPath, { recursive: true });
            setPermissionsRecursively(copyPath);
            addLog(`复制完成: ${copyPath}`);
        } else {
            addLog(`目录不存在: ${filteredFiles}`);
        }
        
        // 创建ZIP主文件
        addLog("开始创建ZIP主文件...");
        if (fs.existsSync(towDir)) {
            zip.addLocalFolder(towDir, "");
            zip.writeZip(zipFile);
            safeChmod(zipFile, 420);
            addLog(`创建备份: ${zipFile}`);
            
            // 执行systemctl restart trim_nginx命令
            addLog("重启桌面服务...");
            const { execSync } = require('child_process');
            try {
                execSync('systemctl restart trim_nginx', { stdio: 'inherit' });
                addLog("桌面服务重启成功！");
            } catch (error) {
                addLog(`重启桌面服务失败: ${error.message}`);
            }
        } else {
            addLog(`目录不存在: ${towDir}`);
        }
        // 配置应用完成
        addLog("配置应用完成！");
    } catch (e) {
        addLog("应用配置时出错: " + e.message);
        addLog("错误已记录，程序将继续执行...");
    }

    // 设置系统状态为就绪
    systemStatus.ready = true;
}

// 安装服务函数
function installService() {
    addLog("开始安装服务...");
    // 执行applyConfig()函数
    applyConfig();
    addLog("服务安装完成！请刷新飞牛主页后使用");
}

// 系统还原函数
function systemRestore() {
    addLog("开始系统还原...");
    // 执行reconfig函数
    reconfig();
    addLog("系统还原完成！");
}

// 还原配置函数
function reconfig() {
    addLog("开始还原配置...");
    
    // 定义目录路径
    let wwwDir = path.join(fn_www);  // 飞牛www目录
    var resDir = path.join(fn_res);  // 飞牛资源目录
    let towDir = path.join(resDir, "fncs-tow");  // fncs-tow目录
    var zipFile = path.join(resDir, "www.zip"),  // ZIP主文件
        bakFile = path.join(resDir, "www.bak");  // BAK备份文件
    
    try {
        // 检查是否存在备份文件
        if (fs.existsSync(bakFile)) {
            addLog("发现备份文件，开始还原...");
            
            // 删除当前的zip文件
            if (fs.existsSync(zipFile)) {
                fs.unlinkSync(zipFile);
                addLog("删除当前备份文件");
            }
            
            // 将bak文件重命名回zip文件
            fs.renameSync(bakFile, zipFile);
            addLog("还原备份文件");
        } else if (fs.existsSync(zipFile)) {
            addLog("发现ZIP主文件，使用其进行还原...");
        } else {
            addLog("未找到备份文件，无法完全还原");
        }
        
        // 清理fncs-tow目录
        if (fs.existsSync(towDir)) {
            fs.rmSync(towDir, { recursive: true, force: true });
            addLog("清理fncs-tow目录");
        }
        
        // 清理添加的filedata目录
        var filedataDir = path.join(wwwDir, "filedata");
        if (fs.existsSync(filedataDir)) {
            fs.rmSync(filedataDir, { recursive: true, force: true });
            addLog("清理filedata目录");
        }
        
        // 恢复原始的index.html文件
        var indexHtmlPath = path.join(wwwDir, "index.html");
        if (fs.existsSync(indexHtmlPath)) {
            // 读取文件内容
            let content = fs.readFileSync(indexHtmlPath, "utf8");
            // 移除FileManagerEnhancer.js引用
            const regex = /<script src=".\/filedata\/FileManagerEnhancer\.js\?v=.*"><\/script>\s*/;
            if (regex.test(content)) {
                content = content.replace(regex, "");
                fs.writeFileSync(indexHtmlPath, content, "utf8");
                addLog("恢复原始index.html文件");
            }
        }
        
        // 重置系统状态
        systemStatus.ready = false;
        
        // 执行systemctl restart trim_nginx命令
        addLog("重启桌面服务...");
        const { execSync } = require('child_process');
        try {
            execSync('systemctl restart trim_nginx', { stdio: 'inherit' });
            addLog("桌面服务重启成功！");
        } catch (error) {
            addLog(`重启桌面服务失败: ${error.message}`);
        }
        
        addLog("配置还原完成！");
    } catch (e) {
        addLog("还原配置时出错: " + e.message);
        addLog("错误已记录，程序将继续执行...");
    }
}

// 解析Cookie
function parseCookies(req) {
    const cookieHeader = req.headers.cookie;
    const cookies = {};
    
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    
    return cookies;
}

// 读取HTML页面文件
function getHtmlPage() {
    try {
        return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    } catch (e) {
        addLog('读取HTML文件失败: ' + e.message);
        return '<html><body><h1>飞牛捷径</h1><p>HTML文件加载失败</p></body></html>';
    }
}

// 生成注册页面
function getRegisterPage() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>飞牛捷径 - 注册密码</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .container {
            background: rgba(26, 26, 46, 0.95);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 30px;
            width: 100%;
            max-width: 400px;
        }
        
        h1 {
            text-align: center;
            color: #ffffff;
            margin-bottom: 30px;
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(45deg, #4facfe 0%, #00f2fe 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 2px 8px rgba(79, 172, 254, 0.3);
        }
        
        p {
            color: #b0b0b0;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            color: #e0e0e0;
            margin-bottom: 8px;
            font-size: 14px;
        }
        
        input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        
        input[type="password"]:focus {
            outline: none;
            border-color: #4facfe;
            box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.2);
        }
        
        button {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            background: linear-gradient(45deg, #4CAF50, #45a049);
            color: white;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .error-message {
            color: #f44336;
            margin-top: 10px;
            font-size: 14px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>飞牛捷径</h1>
        <p>首次使用，请设置密码</p>
        
        <form id="register-form" method="post" action="/register">
            <div class="form-group">
                <label for="password">设置密码</label>
                <input type="password" id="password" name="password" required>
            </div>
            
            <div class="form-group">
                <label for="confirm-password">确认密码</label>
                <input type="password" id="confirm-password" name="confirm-password" required>
            </div>
            
            <button type="submit">注册</button>
            
            <div id="error-message" class="error-message"></div>
        </form>
    </div>
    
    <script>
        document.getElementById('register-form').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const errorMessage = document.getElementById('error-message');
            
            if (password !== confirmPassword) {
                errorMessage.textContent = '两次输入的密码不一致';
                return;
            }
            
            if (password.length < 6) {
                errorMessage.textContent = '密码长度至少为6位';
                return;
            }
            
            // 提交表单
            fetch('/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    password: password
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.location.href = '/';
                } else {
                    errorMessage.textContent = data.message || '注册失败';
                }
            })
            .catch(error => {
                errorMessage.textContent = '注册失败，请重试';
            });
        });
    </script>
</body>
</html>
    `;
}

// 生成登录页面
function getLoginPage() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>飞牛捷径 - 登录</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .container {
            background: rgba(26, 26, 46, 0.95);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 30px;
            width: 100%;
            max-width: 400px;
        }
        
        h1 {
            text-align: center;
            color: #ffffff;
            margin-bottom: 30px;
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(45deg, #4facfe 0%, #00f2fe 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 2px 8px rgba(79, 172, 254, 0.3);
        }
        
        p {
            color: #b0b0b0;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            color: #e0e0e0;
            margin-bottom: 8px;
            font-size: 14px;
        }
        
        input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        
        input[type="password"]:focus {
            outline: none;
            border-color: #4facfe;
            box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.2);
        }
        
        button {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            background: linear-gradient(45deg, #2196F3, #0b7dda);
            color: white;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .error-message {
            color: #f44336;
            margin-top: 10px;
            font-size: 14px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>飞牛捷径</h1>
        <p>请输入密码登录</p>
        
        <form id="login-form" method="post" action="/login">
            <div class="form-group">
                <label for="password">密码</label>
                <input type="password" id="password" name="password" required>
            </div>
            
            <button type="submit">登录</button>
            
            <div id="error-message" class="error-message"></div>
        </form>
    </div>
    
    <script>
        document.getElementById('login-form').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('error-message');
            
            // 提交表单
            fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    password: password
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.location.href = '/';
                } else {
                    errorMessage.textContent = data.message || '登录失败';
                }
            })
            .catch(error => {
                errorMessage.textContent = '登录失败，请重试';
            });
        });
    </script>
</body>
</html>
    `;
}

// 读取HTML页面文件
function getHtmlPage() {
    try {
        return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    } catch (e) {
        addLog('读取HTML文件失败: ' + e.message);
        return '<html><body><h1>飞牛捷径</h1><p>HTML文件加载失败</p></body></html>';
    }
}

// 创建HTTP服务器
function createServer() {
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        
        if (pathname === '/') {
            // 检查密码文件是否存在
            const passwordData = loadPassword();
            
            if (!passwordData) {
                // 密码文件不存在，显示注册页面
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getRegisterPage());
            } else {
                // 密码文件存在，检查会话
                const cookies = parseCookies(req);
                const sessionId = cookies.sessionId;
                
                if (checkSession(sessionId)) {
                    // 会话有效，显示主页面
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(getHtmlPage());
                } else {
                    // 会话无效，显示登录页面
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(getLoginPage());
                }
            }
        } else if (pathname === '/logs') {
            // 提供日志数据
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ logs }));
        } else if (pathname === '/logs/sse') {
            // 提供SSE日志流
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            
            // 发送当前所有日志
            logs.forEach(log => {
                res.write(`data: ${log}\n\n`);
            });
            
            // 保存响应对象，用于后续推送
            logSSEConnections.push(res);
            
            // 处理连接关闭
            req.on('close', () => {
                const index = logSSEConnections.indexOf(res);
                if (index > -1) {
                    logSSEConnections.splice(index, 1);
                }
            });
        } else if (pathname === '/register' && req.method === 'POST') {
            // 处理密码注册
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                const formData = querystring.parse(body);
                const password = formData.password;
                
                if (!password || password.length < 6) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '密码长度至少为6位' }));
                    return;
                }
                
                // 生成密码哈希
                const passwordHash = hashPassword(password);
                
                // 保存密码
                if (savePassword(passwordHash)) {
                    // 创建会话
                    const sessionId = createSession();
                    
                    // 设置会话Cookie
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `sessionId=${sessionId}; Path=/; Max-Age=86400; HttpOnly`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '保存密码失败' }));
                }
            });
        } else if (pathname === '/login' && req.method === 'POST') {
            // 处理密码登录
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                const formData = querystring.parse(body);
                const password = formData.password;
                
                // 加载密码
                const passwordData = loadPassword();
                
                if (!passwordData) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '密码未设置' }));
                    return;
                }
                
                // 验证密码
                const isValid = verifyPassword(password, passwordData.hash, passwordData.salt);
                
                if (isValid) {
                    // 创建会话
                    const sessionId = createSession();
                    
                    // 设置会话Cookie
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `sessionId=${sessionId}; Path=/; Max-Age=86400; HttpOnly`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '密码错误' }));
                }
            });
        } else if (pathname === '/install' && req.method === 'POST') {
            // 处理安装服务请求 - 异步执行
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            // 在后台执行安装服务
            setTimeout(() => {
                installService();
            }, 100);
        } else if (pathname === '/restore' && req.method === 'POST') {
            // 处理系统还原请求 - 异步执行
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            // 在后台执行系统还原
            setTimeout(() => {
                systemRestore();
            }, 100);
        } else if (pathname === '/status') {
            // 提供系统状态 - 动态检查文件和引用
            const filedataPath = path.join(fn_www, 'filedata', 'FileManagerEnhancer.js');
            const indexHtmlPath = path.join(fn_www, 'index.html');
            
            let isReady = false;
            try {
                // 检查FileManagerEnhancer.js文件是否存在
                if (fs.existsSync(filedataPath)) {
                    // 检查index.html中是否引用了FileManagerEnhancer.js
                    if (fs.existsSync(indexHtmlPath)) {
                        const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
                        if (indexContent.includes('FileManagerEnhancer.js')) {
                            isReady = true;
                        }
                    }
                }
            } catch (error) {
                console.error('检查系统状态时出错:', error.message);
            }
            
            // 更新系统状态
            systemStatus.ready = isReady;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ready: isReady }));
        } else {
            // 404错误
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });
    
    server.listen(PORT, () => {
        addLog(`飞牛捷径服务已启动，端口: ${PORT}`, false);
        addLog(`1.注意：本应用与Fndesk等修改飞牛主页的应用可能存在冲突，请导出配置后，再按”安装服务”。`, false);
        addLog(`2.如使用过程中发现任何问题，随时可以按”系统还原“还原配置！`, false);
    });
}

module.exports = { applyConfig };

// 如果直接运行此文件，则创建服务器
if (require.main === module) {
    createServer();
}