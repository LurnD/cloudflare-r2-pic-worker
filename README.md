R2 图床管理系统
一个完整的基于 Cloudflare Workers 和 R2 存储的图床管理系统，支持多级目录结构、文件分类和友好的图片管理界面。

系统截图 <!-- 请替换为您的实际截图 -->

功能特点
多级目录管理：支持无限层级的目录结构，轻松组织和管理大量图片
动态目录浏览：通过目录树结构轻松导航图片
自定义上传路径：上传时可指定自定义目录路径
响应式设计：完美支持桌面和移动设备
单页应用体验：无需刷新页面即可浏览目录和上传图片
Markdown 支持：自动生成简洁的 Markdown 图片链接代码
图片预览：直观地预览已上传的图片
面包屑导航：轻松了解当前位置并返回上级目录
部署指南
前提条件
Cloudflare 账号
Workers 订阅
R2 存储桶
部署步骤
创建 R2 存储桶 在 Cloudflare 控制台中创建一个 R2 存储桶。
创建 Worker 登录 Cloudflare Dashboard，前往 Workers 页面并创建一个新的 Worker。
编写 Worker 代码 将本仓库中的 Worker 代码复制到您的 Worker 编辑器中。
绑定 R2 存储桶 在 Worker 设置中，添加一个名为 MY_BUCKET 的 R2 绑定，并将其关联到您之前创建的 R2 存储桶。
部署 Worker 点击保存并部署按钮。
设置自定义域名（可选） 如果您希望使用自定义域名，请在 Workers 路由设置中配置。
使用入门
访问 Worker 的 URL (例如 https://your-worker.your-subdomain.workers.dev)
在首页上传图片，可选择使用自定义路径
使用 "管理" 链接进入图片管理页面
在管理页面中浏览目录、上传和管理图片
使用说明
上传图片
在首页或管理页面中，点击 "选择文件" 按钮选择要上传的图片
如需指定路径，勾选 "使用自定义路径" 并填写
点击 "上传图片" 按钮
上传成功后，系统将显示图片预览和 URL、Markdown 链接
目录导航
在管理页面，您可以看到目录和文件列表
点击任何文件夹进入该目录
使用面包屑导航返回上级目录
当您在某个目录中时，上传的图片会默认存储在该目录中
管理图片
每个图片卡片提供以下功能：

预览图片
复制图片 URL
复制 Markdown 代码
删除图片
技术细节
前端：纯 HTML/CSS/JavaScript，无需额外框架
后端：Cloudflare Worker (JavaScript)
存储：Cloudflare R2
API：自定义 RESTful API 处理目录浏览、文件上传和删除
配置选项
您可以修改代码中的以下部分来自定义图床行为：

缓存时间：修改 'Cache-Control' 头的值
界面样式：编辑 HTML 中的 CSS 部分
上传文件命名：修改生成唯一文件名的逻辑
故障排除
图片无法加载
检查：

R2 存储桶绑定是否正确
CORS 配置是否正确
图片路径是否包含特殊字符
上传失败
检查：

Worker 是否有足够的执行时间
是否超出 R2 存储桶容量限制
图片大小是否过大
贡献指南
欢迎提交 Issues 和 Pull Requests 来帮助改进此项目。

许可证
本项目采用 MIT 许可证。

鸣谢
Cloudflare Workers 和 R2 团队
所有为这个项目提供反馈和建议的用户
更新日志
v1.0.0 (2025-03-25)
初始发布
支持多级目录结构
文件上传、预览和管理功能
响应式设计
v1.1.0 (2025-03-26)
优化 Markdown 格式：现在只显示文件名而非完整路径
改进目录导航体验
添加面包屑导航
优化图片预览功能
修复文件夹点击无效的问题
快速链接
设置指南
API 文档
