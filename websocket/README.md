# Socket.IO 聊天示例

## 平台本地接入（websocket-chat）

已增加 SDK 1.0.0 iframe 生命周期适配，SDK 从同级平台仓库的固定发布目录复制到 `vendor/micro-app-sdk/1.0.0`，原样保留发布清单。`index.mjs` SHA256 为 `2365b2c6cf6be201d930ae6ca1010bd59ce3f7fa4ab6a0df965189529f43c837`。

平台应用编码必须为 `websocket-chat`，类型 HTML / iframe，路径 `/micro/websocket-chat`。适配允许的本地宿主来源为 `http://127.0.0.1:3000` 和 `http://localhost:3000`；生产接入前必须改成实际准确的 HTTPS 宿主来源。

平台 iframe 为不透明来源。独立聊天服务默认拒绝 `Origin: null`，本地演示时可以显式启用：

```powershell
$env:CHAT_ALLOW_SANDBOX_ORIGIN='true'
cargo run --locked --manifest-path backend/Cargo.toml
```

此开关允许所有不透明来源访问该无身份、无持久化的演示聊天室，不能用来源判断用户身份；服务仍强制只监听回环地址。不要将这个模式直接暴露到公网。

另一个终端构建：

```powershell
$env:VITE_CHAT_ENDPOINT='http://127.0.0.1:3008'
npm run build
New-Item -ItemType Directory artifacts -Force
Compress-Archive -Path dist/* -DestinationPath artifacts/websocket-chat-1.0.0.zip
```

此次本地接入使用平台 Vite 的独立版本目录：将 `dist` 内容复制到平台仓库 `frontend/deploy/micro-apps/websocket-chat/versions/1.0.0/`，在发布窗口选择 `development`，登记 `/sub-apps/websocket-chat/versions/1.0.0/index.html`，预检后激活。该目录只供本地开发使用；生产需要独立静态服务和明确的网关路由。

平台宿主还要求应用绑定已启用的机密 OAuth 客户端，才能签发五分钟内的应用上下文令牌；客户端密钥不进入这个示例的前端或聊天服务。需要的租户、组织和角色须获得应用及首页菜单权限。

本地已登记客户端 `websocket-psd6xx`，仅关联 `websocket-chat`，scope 为 `profile`，访问令牌有效期 300 秒。当前平台创建客户端接口会忽略 `applicationId`；创建后必须通过编辑再次保存应用关联，并在列表核对关联结果。

`artifacts/websocket-chat-1.0.0.zip` 保留为可上传产物；当前平台未配置 ZIP 存储时，不能只靠上传完成发布。此次接入使用登记 URL，不是受管镜像部署。相同版本不能覆盖，修改产物后使用新版本号。

React / TypeScript / Vite 前端与独立 Rust 聊天 API，使用根传输路径 / 和聊天事件，不使用平台 session 或持久通知收件箱。

## 本地开发

先在本 websocket 目录的终端启动 Rust 后端，保持终端输入开放，stdin EOF 或 Ctrl+C 会停止服务：

```sh
cargo run --locked --manifest-path backend/Cargo.toml
```

另开终端，在本目录配置公开 endpoint 并启动前端：

```powershell
npm ci
$env:VITE_CHAT_ENDPOINT='http://127.0.0.1:3008'
npm run dev
```

前端默认 3007，后端 3008。未配置 endpoint 时页面保持离线，用户点击 Connect、Join 后才进入聊天。endpoint 必须为无凭据、路径、查询或片段的 HTTP(S) 来源，不指向平台通知服务。

## 测试与构建

```sh
npm run typecheck
npm test
npm run build
npm run preview
cargo test --locked --manifest-path backend/Cargo.toml
```

test:browser 是独立浏览器测试，需要自己的 Playwright/浏览器环境。静态测试与拦截传输帧的 UI 测试不等于真实双客户端 TCP 验证。

## 协议与部署

聊天事件为 join、message、user-joined、user-left、users-list。用户名与连接绑定，重连后需重新加入。后端没有账号认证或持久化，Origin 校验不提供用户身份。

生产只发布 dist，静态入口保持相对资源、准确 MIME 和缺资源 404；Rust API 独立运行，由实际 HTTPS 入口代理其 Socket.IO 根路径并配置准确 CHAT_ALLOWED_ORIGINS。本示例没有可直接启用的生产 Compose，不将 Vite dev/preview 用作生产服务器。

后端配置、限额和生命周期见 [后端说明](backend/README.md)。
