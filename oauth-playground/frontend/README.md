# OAuth 静态前端

独立 Vite 工程，不直连机密 OAuth 端点。配置从后端 /api/config 获取，操作通过同源 /api 完成，静态产物不包含 token、secret 或 PKCE verifier。

Node 24.18.0、npm 11.16.0，在本 frontend 目录执行：

```sh
npm ci
npm test
npm run dev
npm run build
npm run preview
```

dev/preview 默认 127.0.0.1:3010，OAUTH_PLAYGROUND_FRONTEND_PORT 可改端口；OAUTH_PLAYGROUND_API_TARGET 默认为 http://127.0.0.1:3011，只用于工具端代理。改公开端口时同步 API public origin 和平台注册 callback。

build 生成 dist 的首页、callback 与相对资源；它不启动 Rust API。生产用同源 HTTPS 代理 /api，缺资源和未知路径保持 404，callback 页面及时清除 URL 查询。完整镜像和 Compose 步骤见 [演练指南](../README.md)。
