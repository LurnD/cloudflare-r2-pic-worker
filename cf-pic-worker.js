// 认证配置
const AUTH_CONFIG = {
  username: "admin", // 修改为您想要的用户名
  password: "your-strong-password-here", // 修改为您的强密码
  enabled: true // 设置为false可临时禁用认证
};

// 速率限制配置
const RATE_LIMIT = {
  enabled: true,
  window: 60 * 1000, // 1分钟窗口期
  max: {
    upload: 5,  // 每分钟最多上传5张图片
    delete: 10, // 每分钟最多删除10张图片
    browse: 30  // 每分钟最多浏览30次目录
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // 去掉开头的斜杠
    
    // 检查是否为图片直接访问请求
    const isDirectImageRequest = path && path !== 'manage' && path !== 'browser' && 
                               !path.startsWith('api/') && !path.startsWith('delete/') && 
                               !path.endsWith('.html') && path !== '';
    
    // 允许直接访问图片无需认证
    if (!isDirectImageRequest) {
      // 如果启用了认证，检查是否已登录(除了登录页面和登录API)
      if (AUTH_CONFIG.enabled && 
          path !== '' && // 允许访问首页
          path !== 'login' && 
          path !== 'login.html' && 
          path !== 'api/auth') {
        
        // 检查Cookie中的认证状态
        const authCookie = getCookie(request.headers.get('Cookie'), 'r2auth');
        if (!authCookie || authCookie !== generateAuthToken(AUTH_CONFIG.username, AUTH_CONFIG.password)) {
          // 重定向到登录页面
          return Response.redirect(`${url.origin}/login`, 302);
        }
      }
    }
    
    // 处理登录请求
    if (request.method === 'POST' && path === 'api/auth') {
      return handleAuth(request, url.origin);
    }
    
    // 登录页面
    if (path === 'login' || path === 'login.html') {
      return serveLoginPage(url.origin);
    }
    
    // 登出功能
    if (path === 'logout') {
      return new Response('Logged out', {
        status: 302,
        headers: {
          'Location': `${url.origin}/login`,
          'Set-Cookie': 'r2auth=deleted; HttpOnly; Path=/; Max-Age=0'
        }
      });
    }
    
    // API请求速率限制
    if (RATE_LIMIT.enabled) {
      // 上传限制
      if (request.method === 'POST' && path === 'upload') {
        const limited = await checkRateLimit(request, env, 'upload');
        if (limited) {
          return new Response(JSON.stringify({
            success: false,
            message: '请求过于频繁，请稍后再试'
          }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // 删除限制
      if (request.method === 'DELETE' && path.startsWith('delete/')) {
        const limited = await checkRateLimit(request, env, 'delete');
        if (limited) {
          return new Response(JSON.stringify({
            success: false,
            message: '请求过于频繁，请稍后再试'
          }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // 浏览目录限制
      if (request.method === 'GET' && path.startsWith('api/browse/')) {
        const limited = await checkRateLimit(request, env, 'browse');
        if (limited) {
          return new Response(JSON.stringify({
            error: '请求过于频繁，请稍后再试'
          }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }
    
    // 处理图片请求 - 支持路径嵌套的版本
    if (request.method === 'GET' && isDirectImageRequest) {
      try {
        console.log("尝试获取图片:", path);
        const object = await env.MY_BUCKET.get(path);
        
        if (!object) {
          console.log("图片不存在:", path);
          return new Response('图片不存在', { status: 404 });
        }
        
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000'); // 缓存一年
        // 添加CORS头
        headers.set('Access-Control-Allow-Origin', '*');
        
        return new Response(object.body, {
          headers
        });
      } catch (err) {
        console.error("获取图片错误:", err);
        return new Response('获取图片失败: ' + err.message, { status: 500 });
      }
    }
    
    // 处理上传请求
    if (request.method === 'POST') {
      if (path === 'upload') {
        try {
          const formData = await request.formData();
          const file = formData.get('image');
          
          if (!file) {
            return new Response('没有找到图片', { status: 400 });
          }
          
          // 支持保留原始文件路径或使用新路径
          const useCustomPath = formData.get('useCustomPath') === 'true';
          const customPath = formData.get('customPath') || '';
          
          let fileName;
          const originalName = file.name;
          const fileExt = originalName.split('.').pop();
          
          if (useCustomPath && customPath.trim() !== '') {
            // 使用自定义路径
            const cleanPath = customPath.trim().replace(/^\/+|\/+$/g, '');
            const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2);
            fileName = `${cleanPath}/${uniqueId}.${fileExt}`;
          } else {
            // 使用默认文件名（不带路径）
            const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2);
            fileName = `${uniqueId}.${fileExt}`;
          }
          
          // 将文件保存到R2
          await env.MY_BUCKET.put(fileName, file.stream(), {
            httpMetadata: {
              contentType: file.type,
            }
          });
          
          // 提取纯文件名（不含路径）
          const pureFileName = fileName.split('/').pop();
          
          // 返回图片URL
          return new Response(JSON.stringify({
            success: true,
            url: `${url.origin}/${fileName}`,
            fileName: fileName,
            pureFileName: pureFileName
          }), {
            headers: {
              'Content-Type': 'application/json'
            }
          });
        } catch (err) {
          console.error("上传错误:", err);
          return new Response('上传失败: ' + err.message, { status: 500 });
        }
      }
    }
    
    // 获取指定目录的内容
    if (request.method === 'GET' && path.startsWith('api/browse/')) {
      try {
        let prefix = path.replace('api/browse/', '');
        if (prefix && !prefix.endsWith('/')) {
          prefix += '/';
        }
        
        console.log("列出目录:", prefix);
        
        const options = {
          prefix: prefix,
          delimiter: '/' // 使用分隔符获取目录式的列表
        };
        
        const listed = await env.MY_BUCKET.list(options);
        
        // 处理目录
        const directories = listed.delimitedPrefixes.map(dirPrefix => {
          // 从前缀中提取目录名称
          const dirName = dirPrefix.replace(prefix, '').replace('/', '');
          return {
            name: dirName,
            path: dirPrefix,
            type: 'directory'
          };
        });
        
        // 处理文件
        const files = listed.objects.map(obj => {
          // 跳过目录占位符对象
          if (obj.key.endsWith('/')) return null;
          
          // 从键中提取文件名
          const fileName = obj.key.split('/').pop();
          
          return {
            name: fileName,
            key: obj.key,
            size: obj.size,
            url: `${url.origin}/${obj.key}`,
            markdown: `![${fileName}](${url.origin}/${obj.key})`, // 更新这里，只使用纯文件名
            uploaded: obj.uploaded,
            type: 'file'
          };
        }).filter(f => f !== null);
        
        return new Response(JSON.stringify({
          prefix: prefix,
          directories: directories,
          files: files
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error("列目录错误:", err);
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 管理页面 - 支持按路径分级展示
    if (request.method === 'GET' && path === 'manage') {
      try {
        // 获取根目录的文件列表
        const listed = await env.MY_BUCKET.list({
          delimiter: '/' // 使用分隔符只获取顶级目录
        });
        
        // 处理目录
        const directories = listed.delimitedPrefixes.map(prefix => {
          // 从前缀中提取目录名称
          const dirName = prefix.replace('/', '');
          return {
            name: dirName,
            path: prefix
          };
        });
        
        // 处理文件
        const files = listed.objects.map(obj => {
          // 跳过目录占位符对象
          if (obj.key.endsWith('/')) return null;
          
          // 提取纯文件名
          const fileName = obj.key.split('/').pop();
          
          return {
            name: fileName,
            key: obj.key,
            size: obj.size,
            url: `${url.origin}/${obj.key}`,
            markdown: `![${fileName}](${url.origin}/${obj.key})`, // 更新这里，只使用纯文件名
            uploaded: obj.uploaded
          };
        }).filter(f => f !== null);
        
        // 返回管理界面HTML
        return new Response(`
          <!DOCTYPE html>
          <html lang="zh-CN">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>R2图床管理</title>
              <style>
                body {
                  font-family: system-ui, sans-serif;
                  max-width: 1200px;
                  margin: 0 auto;
                  padding: 20px;
                  color: #333;
                  line-height: 1.5;
                }
                header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 30px;
                }
                .nav-links a {
                  margin-left: 15px;
                  text-decoration: none;
                  color: #4a89dc;
                }
                .user-section {
                  display: flex;
                  align-items: center;
                }
                .username {
                  margin-right: 15px;
                  font-size: 14px;
                  color: #666;
                }
                .upload-section {
                  margin-bottom: 30px;
                  padding: 20px;
                  background: #f9f9f9;
                  border-radius: 8px;
                }
                .custom-path-section {
                  margin-top: 10px;
                  padding: 10px;
                  background: #f1f1f1;
                  border-radius: 4px;
                  display: none;
                }
                .file-browser {
                  border: 1px solid #eee;
                  border-radius: 8px;
                  min-height: 400px;
                  padding: 20px;
                }
                .breadcrumb {
                  margin-bottom: 15px;
                  padding: 10px 15px;
                  background: #f5f5f5;
                  border-radius: 4px;
                  font-size: 14px;
                }
                .breadcrumb a {
                  text-decoration: none;
                  color: #4a89dc;
                  margin: 0 5px;
                }
                .breadcrumb span {
                  margin: 0 5px;
                  color: #777;
                }
                .directory-list {
                  display: grid;
                  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                  gap: 15px;
                  margin-bottom: 30px;
                }
                .directory {
                  background: #f5f5f5;
                  border-radius: 6px;
                  padding: 15px;
                  cursor: pointer;
                  transition: background 0.2s;
                  display: flex;
                  align-items: center;
                }
                .directory:hover {
                  background: #e5e5e5;
                }
                .directory-icon {
                  margin-right: 10px;
                  font-size: 24px;
                }
                .directory-name {
                  font-weight: 500;
                  word-break: break-all;
                }
                .file-grid {
                  display: grid;
                  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                  gap: 20px;
                  margin-top: 20px;
                }
                .file {
                  border: 1px solid #eee;
                  border-radius: 8px;
                  padding: 15px;
                  transition: transform 0.2s, box-shadow 0.2s;
                }
                .file:hover {
                  transform: translateY(-3px);
                  box-shadow: 0 5px 15px rgba(0,0,0,0.1);
                }
                .file-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  margin-bottom: 10px;
                }
                .file-title {
                  display: flex;
                  align-items: center;
                  word-break: break-all;
                }
                .file-icon {
                  margin-right: 8px;
                  font-size: 18px;
                }
                .file-name {
                  font-weight: 500;
                }
                .file-size {
                  font-size: 12px;
                  color: #777;
                  margin-top: 5px;
                }
                .file-actions {
                  display: flex;
                  gap: 5px;
                  flex-wrap: wrap;
                }
                .file-preview {
                  text-align: center;
                  margin: 15px 0;
                  height: 180px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: #f9f9f9;
                  border-radius: 4px;
                  overflow: hidden;
                }
                .file-preview img {
                  max-width: 100%;
                  max-height: 180px;
                  border-radius: 4px;
                }
                .file-details {
                  margin-top: 15px;
                  font-size: 0.9em;
                }
                .file-path {
                  margin-bottom: 5px;
                  color: #666;
                  word-break: break-all;
                }
                .file-date {
                  margin-bottom: 10px;
                  color: #666;
                }
                .btn {
                  padding: 6px 12px;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 13px;
                  transition: background 0.2s;
                }
                .btn-primary {
                  background: #4a89dc;
                  color: white;
                }
                .btn-success {
                  background: #5cb85c;
                  color: white;
                }
                .btn-danger {
                  background: #d9534f;
                  color: white;
                }
                .btn-primary:hover { background: #3a70c0; }
                .btn-success:hover { background: #4a9d4a; }
                .btn-danger:hover { background: #c43c38; }
                .loading {
                  text-align: center;
                  padding: 50px;
                  color: #777;
                }
                .empty-message {
                  text-align: center;
                  padding: 40px;
                  color: #666;
                  background: #f9f9f9;
                  border-radius: 8px;
                }
                textarea {
                  width: 100%;
                  padding: 8px;
                  font-family: monospace;
                  border: 1px solid #ddd;
                  border-radius: 4px;
                  resize: none;
                  margin-bottom: 8px;
                  font-size: 12px;
                }
                .section-title {
                  border-bottom: 1px solid #eee;
                  padding-bottom: 10px;
                  margin-bottom: 15px;
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                }
                .stats {
                  font-size: 14px;
                  color: #666;
                  margin-bottom: 20px;
                }
                .rate-limit-warning {
                  display: none;
                  color: #d9534f;
                  margin-bottom: 10px;
                  padding: 8px;
                  background: #f9f2f4;
                  border-radius: 4px;
                  font-size: 14px;
                }
                @media (max-width: 768px) {
                  .directory-list, .file-grid {
                    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                  }
                  .file-actions {
                    flex-direction: column;
                  }
                  .btn {
                    width: 100%;
                    margin-bottom: 5px;
                  }
                }
              </style>
            </head>
            <body>
              <header>
                <h1>R2图床管理</h1>
                <div class="user-section">
                  <span class="username">当前用户: ${AUTH_CONFIG.username}</span>
                  <div class="nav-links">
                    <a href="/">首页</a>
                    <a href="/logout">退出登录</a>
                  </div>
                </div>
              </header>
              
              <div class="upload-section">
                <h2>上传新图片</h2>
                <div id="rateLimitWarning" class="rate-limit-warning">
                  注意: 上传限制为每分钟${RATE_LIMIT.max.upload}张图片
                </div>
                <form id="uploadForm">
                  <div>
                    <input type="file" name="image" id="fileInput" accept="image/*" required>
                    <button type="submit" id="uploadButton" class="btn btn-primary">上传图片</button>
                  </div>
                  
                  <div style="margin-top: 10px;">
                    <input type="checkbox" id="useCustomPath" name="useCustomPath" value="true">
                    <label for="useCustomPath">使用自定义路径</label>
                  </div>
                  
                  <div id="customPathSection" class="custom-path-section">
                    <label for="customPath">自定义路径:</label>
                    <input type="text" id="customPath" name="customPath" placeholder="例如: US/Cards/Visa" style="width: 300px;">
                    <div><small>注意：无需添加开头和结尾的斜杠</small></div>
                  </div>
                </form>
                <div id="uploadResult"></div>
              </div>
              
              <div class="stats">
                总计: <span id="totalItems">正在加载...</span>
              </div>
              
              <div class="breadcrumb">
                <a href="#" data-path="" class="breadcrumb-item">根目录</a>
                <span id="breadcrumb-additional"></span>
              </div>
              
              <div class="file-browser">
                <div id="browserContent" class="content">
                  <div class="loading">加载中...</div>
                </div>
              </div>
              
              <script>
                // 当前目录路径
                let currentPath = '';
                
                // 加载目录内容
                async function loadDirectory(path = '') {
                  const browserContent = document.getElementById('browserContent');
                  browserContent.innerHTML = '<div class="loading">加载中...</div>';
                  
                  try {
                    const response = await fetch(\`/api/browse/\${path}\`);
                    if (response.status === 429) {
                      browserContent.innerHTML = \`
                        <div class="empty-message" style="color: #d9534f;">
                          <p>请求过于频繁，请稍后再试</p>
                          <p><button class="btn btn-primary" onclick="setTimeout(() => loadDirectory('${path}'), 3000)">3秒后重试</button></p>
                        </div>
                      \`;
                      return;
                    }
                    
                    if (!response.ok) {
                      throw new Error('加载失败: ' + response.status);
                    }
                    
                    const data = await response.json();
                    
                    // 更新当前路径和面包屑
                    currentPath = data.prefix || '';
                    updateBreadcrumb(currentPath);
                    
                    // 更新总数统计
                    const totalItems = document.getElementById('totalItems');
                    totalItems.textContent = \`\${data.directories.length} 个目录, \${data.files.length} 个文件\`;
                    
                    let content = '';
                    
                    // 目录区域
                    if (data.directories.length > 0) {
                      content += '<div class="section-title"><h3>目录</h3></div>';
                      content += '<div class="directory-list">';
                      
                      data.directories.forEach(dir => {
                        content += \`
                          <div class="directory" onclick="loadDirectory('\${dir.path}')">
                            <div class="directory-icon">📁</div>
                            <div class="directory-name">\${dir.name}</div>
                          </div>
                        \`;
                      });
                      
                      content += '</div>';
                    }
                    
                    // 文件区域
                    if (data.files.length > 0) {
                      content += '<div class="section-title"><h3>文件</h3></div>';
                      content += '<div class="file-grid">';
                      
                      data.files.forEach(file => {
                        const fileId = file.key.replace(/[\/\.]/g, '-');
                        const fileDate = new Date(file.uploaded).toLocaleString();
                        const fileSize = formatFileSize(file.size);
                        
                        content += \`
                          <div class="file" id="file-\${fileId}">
                            <div class="file-header">
                              <div>
                                <div class="file-title">
                                  <span class="file-icon">🖼️</span>
                                  <span class="file-name">\${file.name}</span>
                                </div>
                                <div class="file-size">\${fileSize}</div>
                              </div>
                              <div class="file-actions">
                                <button class="btn btn-primary" onclick="copyText('\${file.url}')">复制URL</button>
                                <button class="btn btn-success" onclick="copyText('\${file.markdown.replace(/'/g, "\\'")}')">复制Markdown</button>
                                <button class="btn btn-danger" onclick="deleteImage('\${file.key}')">删除</button>
                              </div>
                            </div>
                            <div class="file-preview">
                              <a href="\${file.url}" target="_blank">
                                <img src="\${file.url}" alt="\${file.name}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22320%22%20height%3D%22180%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22320%22%20height%3D%22180%22%20fill%3D%22%23e0e0e0%22%2F%3E%3Ctext%20x%3D%22160%22%20y%3D%2290%22%20font-size%3D%2216%22%20text-anchor%3D%22middle%22%20alignment-baseline%3D%22middle%22%20fill%3D%22%23999%22%3E加载失败%3C%2Ftext%3E%3C%2Fsvg%3E'">
                              </a>
                            </div>
                            <div class="file-details">
                              <div class="file-path">路径: \${file.key}</div>
                              <div class="file-date">上传时间: \${fileDate}</div>
                              <div>
                                <textarea rows="1" onclick="this.select()">\${file.url}</textarea>
                                <textarea rows="1" onclick="this.select()">\${file.markdown}</textarea>
                              </div>
                            </div>
                          </div>
                        \`;
                      });
                      
                      content += '</div>';
                    }
                    
                    // 空目录提示
                    if (data.directories.length === 0 && data.files.length === 0) {
                      content = \`
                        <div class="empty-message">
                          <p>此目录为空</p>
                          <p>您可以上传图片或创建子目录</p>
                        </div>
                      \`;
                    }
                    
                    browserContent.innerHTML = content;
                    
                  } catch (error) {
                    browserContent.innerHTML = \`
                      <div class="empty-message" style="color: #d9534f;">
                        <p>加载失败: \${error.message}</p>
                        <p><button class="btn btn-primary" onclick="loadDirectory('')">重试</button></p>
                      </div>
                    \`;
                    console.error('加载目录错误:', error);
                  }
                }
                
                // 更新面包屑导航
                function updateBreadcrumb(path) {
                  const additionalBreadcrumb = document.getElementById('breadcrumb-additional');
                  
                  if (!path) {
                    additionalBreadcrumb.innerHTML = '';
                    return;
                  }
                  
                  // 分割路径
                  const parts = path.split('/').filter(part => part);
                  let html = '';
                  let currentPart = '';
                  
                  // 构建面包屑
                  parts.forEach((part, index) => {
                    currentPart += part + '/';
                    if (index < parts.length - 1) {
                      html += \` <span>›</span> <a href="#" data-path="\${currentPart}" class="breadcrumb-item">\${part}</a>\`;
                    } else {
                      html += \` <span>›</span> <span>\${part}</span>\`;
                    }
                  });
                  
                  additionalBreadcrumb.innerHTML = html;
                  
                  // 添加点击事件
                  document.querySelectorAll('.breadcrumb-item').forEach(item => {
                    item.addEventListener('click', function(e) {
                      e.preventDefault();
                      const path = this.getAttribute('data-path');
                      loadDirectory(path);
                    });
                  });
                }
                
                // 自定义路径复选框事件
                document.getElementById('useCustomPath').addEventListener('change', function() {
                  const customPathSection = document.getElementById('customPathSection');
                  customPathSection.style.display = this.checked ? 'block' : 'none';
                });
                
                // 上传图片
                document.getElementById('uploadForm').addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  
                  // 如果在子目录中且使用自定义路径选项未勾选，自动将当前路径添加到自定义路径
                  if (currentPath && !formData.get('useCustomPath')) {
                    formData.set('useCustomPath', 'true');
                    formData.set('customPath', currentPath.replace(/\\/$/, ''));
                  }
                  
                  const result = document.getElementById('uploadResult');
                  const rateLimitWarning = document.getElementById('rateLimitWarning');
                  result.innerHTML = '<p>上传中...</p>';
                  
                  try {
                    const response = await fetch('/upload', {
                      method: 'POST',
                      body: formData
                    });
                    
                    if (response.status === 429) {
                      result.innerHTML = '<p style="color: red;">上传频率过高，请稍后再试</p>';
                      rateLimitWarning.style.display = 'block';
                      return;
                    }
                    
                    const data = await response.json();
                    if (data.success) {
                      // 提取纯文件名显示在Markdown中
                      const fileName = data.fileName.split('/').pop();
                      
                      result.innerHTML = \`
                        <p style="color: green;">上传成功!</p>
                        <p>图片链接: <a href="\${data.url}" target="_blank">\${data.url}</a></p>
                        <div>
                          <p>Markdown代码:</p>
                          <textarea rows="2" onclick="this.select()">![\${fileName}](\${data.url})</textarea>
                          <button class="btn btn-primary" onclick="copyText('![\${fileName}](\${data.url})')">复制Markdown代码</button>
                        </div>
                        <img src="\${data.url}" style="max-width: 300px; margin-top: 15px;" />
                      \`;
                      
                      // 刷新当前目录
                      setTimeout(() => {
                        loadDirectory(currentPath);
                      }, 2000);
                    } else {
                      result.innerHTML = '<p style="color: red;">上传失败: ' + data.message + '</p>';
                    }
                  } catch (err) {
                    result.innerHTML = '<p style="color: red;">上传出错: ' + err.message + '</p>';
                  }
                });
                
                // 复制文本
                function copyText(text) {
                  navigator.clipboard.writeText(text).then(() => {
                    alert('已复制到剪贴板');
                  }).catch(err => {
                    console.error('复制失败:', err);
                    // 备选方案
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    alert('已复制到剪贴板');
                  });
                }
                
                // 删除图片
                async function deleteImage(fileName) {
                  if (!confirm('确定要删除这张图片吗？此操作无法撤销。')) {
                    return;
                  }
                  
                  try {
                    const response = await fetch(\`/delete/\${encodeURIComponent(fileName)}\`, {
                      method: 'DELETE'
                    });
                    
                    if (response.status === 429) {
                      alert('删除操作过于频繁，请稍后再试');
                      return;
                    }
                    
                    const data = await response.json();
                    if (data.success) {
                      alert('图片已删除');
                      // 移除文件元素
                      const fileElement = document.getElementById(\`file-\${fileName.replace(/[\/\.]/g, '-')}\`);
                      if (fileElement) {
                        fileElement.remove();
                      }
                      
                      // 刷新当前目录
                      loadDirectory(currentPath);
                    } else {
                      alert('删除失败: ' + data.message);
                    }
                  } catch (err) {
                    alert('删除出错: ' + err.message);
                  }
                }
                
                // 格式化文件大小
                function formatFileSize(bytes) {
                  if (bytes < 1024) return bytes + ' B';
                  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
                  else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
                  else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
                }
                
                // 初始加载根目录
                window.onload = function() {
                  loadDirectory('');
                };
              </script>
            </body>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html' }
        });
      } catch (err) {
        console.error("管理页面错误:", err);
        return new Response(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>错误</title>
              <style>
                body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                .error-card { background: #fff3f3; border-left: 4px solid #e74c3c; padding: 20px; border-radius: 4px; }
                .back-btn { display: inline-block; margin: 20px 0; text-decoration: none; color: #4a89dc; }
              </style>
            </head>
            <body>
              <a href="/" class="back-btn">← 返回首页</a>
              <h1>操作失败</h1>
              <div class="error-card">
                <h3>获取图片列表失败</h3>
                <p>错误信息: ${err.message}</p>
                <p>可能的原因:</p>
                <ul>
                  <li>R2存储桶未正确绑定</li>
                  <li>存储桶权限配置问题</li>
                  <li>Worker代码错误</li>
                </ul>
                <p>请检查Worker配置和R2绑定是否正确。</p>
              </div>
            </body>
          </html>
        `, { 
          status: 500,
          headers: { 'Content-Type': 'text/html' }
        });
      }
    }
    
    // API端点：获取所有图片信息
    if (request.method === 'GET' && path === 'api/images') {
      try {
        const listed = await env.MY_BUCKET.list();
        const images = listed.objects.map(object => {
          // 提取文件名（不含路径）
          const fileName = object.key.split('/').pop();
          
          return {
            name: fileName,
            key: object.key,
            size: object.size,
            url: `${url.origin}/${object.key}`,
            markdown: `![${fileName}](${url.origin}/${object.key})`, // 只使用文件名
            uploaded: object.uploaded
          };
        });
        
        return new Response(JSON.stringify({ images }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 删除图片
    if (request.method === 'DELETE' && path.startsWith('delete/')) {
      try {
        const fileName = decodeURIComponent(path.replace('delete/', ''));
        await env.MY_BUCKET.delete(fileName);
        
        return new Response(JSON.stringify({ 
          success: true, 
          message: '图片已删除'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: '删除失败: ' + err.message 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 首页 - 上传界面
    if (request.method === 'GET' && path === '') {
      return new Response(`
        <!DOCTYPE html>
        <html lang="zh-CN">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>R2图床</title>
            <style>
              body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
              .container { background: #f9f9f9; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              h1 { margin-top: 0; color: #333; }
              form { display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px; }
              input[type="file"] { padding: 10px; border: 1px dashed #ccc; border-radius: 4px; }
              button { background: #4a89dc; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-size: 16px; }
              button:hover { background: #3a70c0; }
              #result { margin-top: 20px; }
              .features { margin-top: 30px; }
              .features h3 { margin-bottom: 10px; }
              .features ul { padding-left: 20px; }
              .manage-link { display: inline-block; margin-top: 20px; padding: 10px 15px; background: #eee; text-decoration: none; color: #333; border-radius: 4px; }
              .manage-link:hover { background: #ddd; }
              textarea { width: 100%; font-family: monospace; }
              .copy-btn { background: #4a89dc; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-top: 5px; }
              .custom-path-section { margin-top: 10px; padding: 10px; background: #f1f1f1; border-radius: 4px; display: none; }
              .login-alert { margin-bottom: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
              .rate-limit-warning { color: #d9534f; margin-bottom: 10px; font-size: 0.9em; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>R2图床上传</h1>
              
              ${AUTH_CONFIG.enabled && !getCookie(request.headers.get('Cookie'), 'r2auth') ? `
                <div class="login-alert">
                  <p>您需要登录才能上传和管理图片。</p>
                  <a href="/login" class="manage-link">登录 →</a>
                </div>
              ` : `
                <form id="uploadForm">
                  <div class="rate-limit-warning">注意: 上传限制为每分钟${RATE_LIMIT.max.upload}张图片</div>
                  <input type="file" name="image" id="fileInput" accept="image/*" required>
                  
                  <div>
                    <input type="checkbox" id="useCustomPath" name="useCustomPath" value="true">
                    <label for="useCustomPath">使用自定义路径</label>
                  </div>
                  
                  <div id="customPathSection" class="custom-path-section">
                    <label for="customPath">自定义路径:</label>
                    <input type="text" id="customPath" name="customPath" placeholder="例如: US/Cards/Visa" style="width: 100%;">
                    <div><small>注意：无需添加开头和结尾的斜杠</small></div>
                  </div>
                  
                  <button type="submit">上传图片</button>
                </form>
                <div id="result"></div>
                <a href="/manage" class="manage-link">管理已上传的图片 →</a>
              `}
              
              <div class="features">
                <h3>功能介绍</h3>
                <ul>
                  <li>支持各种图片格式上传</li>
                  <li>支持自定义路径/分类</li>
                  <li>自动生成唯一文件名</li>
                  <li>提供URL和Markdown格式代码</li>
                  <li>管理页面按目录分级展示图片</li>
                  <li>安全身份验证和请求频率限制</li>
                </ul>
              </div>
            </div>
            
            <script>
              // 自定义路径复选框事件
              const useCustomPath = document.getElementById('useCustomPath');
              if (useCustomPath) {
                useCustomPath.addEventListener('change', function() {
                  const customPathSection = document.getElementById('customPathSection');
                  customPathSection.style.display = this.checked ? 'block' : 'none';
                });
              }
              
              // 上传表单
              const uploadForm = document.getElementById('uploadForm');
              if (uploadForm) {
                uploadForm.addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  const result = document.getElementById('result');
                  result.innerHTML = '<p>上传中...</p>';
                  
                  try {
                    const response = await fetch('/upload', {
                      method: 'POST',
                      body: formData
                    });
                    
                    if (response.status === 429) {
                      result.innerHTML = '<p style="color: red;">上传频率过高，请稍后再试</p>';
                      return;
                    }
                    
                    if (response.status === 302 || response.status === 401) {
                      window.location.href = '/login';
                      return;
                    }
                    
                    const data = await response.json();
                    if (data.success) {
                      // 提取纯文件名（不含路径）
                      const fileName = data.fileName.split('/').pop();
                      
                      result.innerHTML = \`
                        <p style="color: green;">上传成功!</p>
                        <p>图片链接: <a href="\${data.url}" target="_blank">\${data.url}</a></p>
                        <div>
                          <p>Markdown代码:</p>
                          <textarea rows="2" onclick="this.select()">![\${fileName}](\${data.url})</textarea>
                          <button class="copy-btn" onclick="copyToClipboard('![\${fileName}](\${data.url})')">复制Markdown代码</button>
                        </div>
                        <img src="\${data.url}" style="max-width: 100%; margin-top: 15px;" />
                      \`;
                    } else {
                      result.innerHTML = '<p style="color: red;">上传失败: ' + data.message + '</p>';
                    }
                  } catch (err) {
                    result.innerHTML = '<p style="color: red;">上传出错: ' + err.message + '</p>';
                  }
                });
              }
              
              function copyToClipboard(text) {
                navigator.clipboard.writeText(text).then(() => {
                  alert('已复制到剪贴板');
                }).catch(err => {
                  console.error('复制失败:', err);
                  // 备选方案
                  const textarea = document.createElement('textarea');
                  textarea.value = text;
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textarea);
                  alert('已复制到剪贴板');
                });
              }
            </script>
          </body>
        </html>
      `, {
        headers: {
          'Content-Type': 'text/html'
        }
      });
    }
    
    // 登录页面
    if (path === 'login' || path === 'login.html') {
      return serveLoginPage(url.origin);
    }
    
    // 404页面 - Catch-all
    return new Response(`
      <!DOCTYPE html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>页面不存在</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; text-align: center; }
            .error-container { margin-top: 50px; }
            h1 { font-size: 36px; margin-bottom: 20px; }
            p { font-size: 18px; color: #666; margin-bottom: 30px; }
            .home-btn { display: inline-block; padding: 10px 20px; background: #4a89dc; color: white; text-decoration: none; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>404 - 页面不存在</h1>
            <p>您访问的页面不存在或已被移除。</p>
            <p>请求路径: ${path}</p>
            <a href="/" class="home-btn">返回首页</a>
          </div>
        </body>
      </html>
    `, {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    });
  }
};

// 获取Cookie值
function getCookie(cookieString, name) {
  if (!cookieString) return null;
  const cookies = cookieString.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

// 生成认证令牌
function generateAuthToken(username, password) {
  // 简单实现，生产环境建议使用更安全的方法
  return btoa(`${username}:${password}`);
}

// 处理登录认证
async function handleAuth(request, origin) {
  try {
    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password');
    
    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
      const authToken = generateAuthToken(username, password);
      
      // 设置Cookie并重定向到管理页面
      return new Response('Login successful', {
        status: 302,
        headers: {
          'Location': `${origin}/manage`,
          'Set-Cookie': `r2auth=${authToken}; HttpOnly; Path=/; Max-Age=86400` // 24小时有效
        }
      });
    } else {
      // 登录失败
      return Response.redirect(`${origin}/login?error=1`, 302);
    }
  } catch (err) {
    return new Response('Authentication error', { status: 500 });
  }
}

// 提供登录页面
function serveLoginPage(origin) {
  return new Response(`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>登录 - R2图床</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; }
          .container { background: #f9f9f9; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-top: 50px; }
          h1 { margin-top: 0; color: #333; text-align: center; }
          form { display: flex; flex-direction: column; gap: 15px; }
          label { font-weight: bold; }
          input[type="text"], input[type="password"] { padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
          button { background: #4a89dc; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-size: 16px; }
          button:hover { background: #3a70c0; }
          .error { color: #d9534f; margin-bottom: 15px; text-align: center; }
          .back-link { text-align: center; margin-top: 20px; }
          .back-link a { color: #666; text-decoration: none; font-size: 14px; }
          .back-link a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>R2图床登录</h1>
          <div id="error-message" class="error" style="display: none;">用户名或密码不正确</div>
          <form id="loginForm" action="/api/auth" method="post">
            <div>
              <label for="username">用户名:</label>
              <input type="text" id="username" name="username" required>
            </div>
            <div>
              <label for="password">密码:</label>
              <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">登录</button>
          </form>
          <div class="back-link">
            <a href="/">← 返回首页</a>
          </div>
        </div>
        
        <script>
          // 检查URL参数，显示错误信息
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('error') === '1') {
            document.getElementById('error-message').style.display = 'block';
          }
        </script>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// 检查API请求频率限制
async function checkRateLimit(request, env, action) {
  const clientIP = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const key = `rate_limit:${action}:${clientIP}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.window;
  
  // 使用R2存储桶自身作为简单的计数器存储
  // 注意：生产环境建议使用KV或Durable Objects
  try {
    const record = await env.MY_BUCKET.get(`${key}.json`);
    let timestamps = [];
    
    if (record) {
      timestamps = JSON.parse(await record.text());
      // 只保留窗口期内的时间戳
      timestamps = timestamps.filter(time => time > windowStart);
    }
    
    // 如果请求次数超过限制
    if (timestamps.length >= RATE_LIMIT.max[action]) {
      console.log(`Rate limit exceeded for ${action} by ${clientIP}, count: ${timestamps.length}`);
      return true;
    }
    
    // 添加新的时间戳
    timestamps.push(now);
    
    // 更新记录
    await env.MY_BUCKET.put(`${key}.json`, JSON.stringify(timestamps), {
      httpMetadata: { contentType: 'application/json' }
    });
    
    return false;
  } catch (err) {
    console.error("Rate limit check error:", err);
    // 出错时允许请求通过，以防止阻止合法请求
    return false;
  }
}
