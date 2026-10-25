# OAuth 演练微应用与独立 API

此示例由 qiankun HTML/UMD 前端、独立 callback 工具页和 Rust 流程 API 组成。主应用编码为 `oauth-playground`，使用 SDK 3.0.0 / MicroProps 2.0。授权码 + PKCE、设备码、客户端凭据和可选历史 password 流程由 API 执行；客户端 secret、access/refresh token、verifier 和流程状态保存在后端有界内存中。

## 本地启动

使用 Node.js 24.22.1、npm 11.16.0、Rust 1.97.0。以下命令均在本 `oauth-playground` 目录执行。前后端分别启动：

```powershell
$env:OAUTH_PUBLIC_ORIGIN='http://127.0.0.1:3010'
$env:OAUTH_PLATFORM_ORIGIN='http://127.0.0.1:3000'
$env:OAUTH_ALLOW_INSECURE_LOOPBACK='true'
$env:OAUTH_AUTH_CLIENT_ID='<真实登记的客户端 ID>'
$env:OAUTH_AUTH_CLIENT_SECRET='<私有客户端密钥>'
cargo run --locked --manifest-path backend/Cargo.toml
```

另开终端：

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

前端默认 3010、API 默认 3011。Vite 提供 `/oauth-playground-api/*` → API `/api/*` 的代理、`/sub/oauth-playground/*` 静态别名，以及 `/callback` → `callback.html`。主页面需通过 qiankun 挂载；独立打开只显示平台接入提示。

`OAUTH_PUBLIC_ORIGIN` 必须等于实际浏览器页面来源。通过本地平台 3000 挂载时，将其改为 `http://127.0.0.1:3000`，由平台网关转发上述路径，客户端 callback 也登记为 `http://127.0.0.1:3000/callback`。在 3010 独立工具来源演练时登记 `http://127.0.0.1:3010/callback`。来源和 callback 必须匹配当前部署。

配置 API 环境并安装前端依赖后，也可在本目录执行 `npm run dev` 同时启动两部分。仓内启动器先构建 Rust，再直接管理 API 可执行文件与前端构建监听；任一进程退出或收到终止信号时清理另一进程。还可分别执行 `npm run dev:frontend` 与 `npm run dev:api`。

## qiankun 与流程 API

平台采用 `HTML + TRUSTED`，主 HTML 只导出标准 qiankun 生命周期，完整授权信息放入 `props.platform`。微应用默认请求同源 `/oauth-playground-api/*`，可用 `props.services.oauthApiBase` 指定同源路径前缀。API 使用自己的 HttpOnly 会话 Cookie 和准确 Origin 校验；它不把平台应用 token 当作流程授权凭证。

平台代理应剥离 Authorization 和平台 Cookie，仅转发演练 Cookie，并把 `/oauth-playground-api/<action>` 重写为独立 API 的 `/api/<action>`。公开配置 GET 后，实际授权、交换、刷新、吊销与资源查询由用户操作触发。callback 页面先清除敏感查询，再等待用户点击确认，只提交一次回调。

完整平台挂载、静态资源和 callback 接入见 [前端说明](frontend/README.md)；环境变量、会话与流程限制见 [API 说明](backend/README.md)。

## 测试与构建

```sh
npm test
npm run build
cargo test --locked --manifest-path backend/Cargo.toml
```

`npm test` 执行前端 API 脱敏、设备轮询、真实构建后的 UMD 生命周期/callback 测试，以及网关、容器模板和开发启动器检查。前端构建不启动 API，也不执行真实 OAuth 授权。Rust 上游契约测试默认启动原生 Axum 回环监听；若测试机限制 Rust 测试进程入站，可设置 `OAUTH_TEST_NODE` 为 Node 可执行文件的绝对路径。此时只有监听传输交给临时 Node 进程，请求仍经生产 reqwest 和同一 Axum 测试处理器，全部断言保留，进程随测试清理。

## 部署与网关路由

`deploy/render-edge.mjs` 与 `deploy/static.nginx.conf` 提供当前微应用及 callback 的路由。接入平台时，在浏览器平台来源下保留以下映射；可以将模板作为专用上游，也可将同等路由合入平台网关，不要用专用静态入口覆盖平台其他业务路由：

| 浏览器公开路径 | 目标 |
| --- | --- |
| 微应用登记的静态入口与相对资源 | 当前前端 `dist/` |
| `/oauth-playground-api/*` | 独立 Rust API `/api/*`，保留 Origin、筛选 Cookie 并移除 Authorization |
| 精确 `/callback` | 当前 `dist/callback.html` |
| `/sub/oauth-playground/assets/*` | 当前 `dist/assets/*`，供 callback 使用 |

API 的 `OAUTH_PUBLIC_ORIGIN`、真实客户端 callback 和浏览器来源必须一致，生产使用 HTTPS。前端、API 与入口按单副本演练管理；重启会丢失会话，不能跨副本恢复。

生产 HTTPS edge 只向 API 转发准确的 `__Host-oauth_playground` Cookie，剥离 Authorization 和其他 Cookie，保留原始 Origin；API 继续校验会话、Origin 和 JSON。HTTP 回环开发使用 Vite 代理，允许准确的 `oauth_playground` 或 `__Host-oauth_playground` Cookie。固定命名的 UMD/CSS 与 callback 当前版本别名返回 `Cache-Control: no-store`，避免旧资源缓存跨版本混用。

现有 Dockerfile 可用于构建候选镜像，context 为本目录，`SOURCE_REVISION` 必须是实际完整 40 位提交：

```sh
docker build -f deploy/Dockerfile.frontend --build-arg SOURCE_REVISION=<完整40位SHA> -t oauth-web:local .
docker build -f deploy/Dockerfile.api --build-arg SOURCE_REVISION=<完整40位SHA> -t oauth-api:local .
```

私有 API 环境与 TLS/镜像配置按 `deploy/api.env.example`、`deploy/compose.env.example` 在源码之外准备。`render-edge.mjs` 根据 `deploy/edge.example.json` 生成配置，采用只新建、不覆盖输出文件的行为。生成并审阅网关配置后，可在目标 Linux 部署机校验 Compose：

```sh
docker compose --env-file /srv/oauth/private/compose.env -f deploy/compose.yml config --quiet
```

Compose 模板只有 edge 公开 HTTP/TLS，API 和静态服务留在私网。正式启动前应验证主应用、callback 资源、API 前缀、会话 Cookie、state 一次消费及上下文更新/卸载；文档中的镜像构建和配置校验不代表目标环境已部署。

具备 Nginx 和 OpenSSL 的隔离环境可运行真实路由测试：

```sh
OAUTH_TEST_NGINX=/usr/sbin/nginx OAUTH_TEST_OPENSSL=/usr/bin/openssl npm run test:nginx
```

测试使用当前 `frontend/dist`、临时自签证书与自有回环端口，执行真实 `nginx -t`、HTTPS 资源和 API 请求；验证固定 callback 别名、缺资源 404、Cookie/Authorization 筛选及缺失/错误 Origin 拒绝。不连接用户平台、数据库或真实 OAuth 客户端。
