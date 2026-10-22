# OAuth 演练

本示例使用独立 Vite 页面和 Rust 流程 API。浏览器通过同源 /api 操作，secret、token、PKCE 和流程状态保存在有界短期后端内存，不进入静态构建。

## 本地开发

先在平台登记真实客户端和准确 callback，开发示例为 http://127.0.0.1:3010/callback。进入本 oauth-playground 目录，在终端配置并启动 API：

```powershell
$env:OAUTH_PUBLIC_ORIGIN='http://127.0.0.1:3010'
$env:OAUTH_PLATFORM_ORIGIN='http://127.0.0.1:3000'
$env:OAUTH_ALLOW_INSECURE_LOOPBACK='true'
$env:OAUTH_AUTH_CLIENT_ID='<平台生成的客户端ID>'
$env:OAUTH_AUTH_CLIENT_SECRET='<私有客户端密钥>'
cargo run --locked --manifest-path backend/Cargo.toml
```

另开终端进入本目录：

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

前端默认 3010，API 默认 3011，Vite 代理 /api 与 /health。根 package.json 的 dev 仍指向已不存在的旧统一调度器，当前不要使用它，按上述前后端独立命令启动。

## 流程与测试

支持配置驱动的机密客户端授权码加 PKCE、设备码、服务凭据；历史 password 默认禁用。未配置或平台拒绝的能力明确失败，不模拟成功。state 绑定会话且一次消费，重启/多副本切换会丢失内存流程。

```sh
npm --prefix frontend test
npm --prefix frontend run build
node --test tests/delivery.mjs
cargo test --locked --manifest-path backend/Cargo.toml
```

详情见 [前端说明](frontend/README.md)、[API 说明](backend/README.md)。

## Docker / HTTPS 部署

以下在本 oauth-playground 目录执行，两个 Dockerfile 均以本目录为 context，SOURCE_REVISION 必须为实际完整 40 位提交：

```sh
docker build -f deploy/Dockerfile.frontend --build-arg SOURCE_REVISION=<完整40位SHA> -t oauth-web:local .
docker build -f deploy/Dockerfile.api --build-arg SOURCE_REVISION=<完整40位SHA> -t oauth-api:local .
```

发布审阅镜像并记录摘要。根据 deploy/api.env.example 创建源码之外的私有 API 环境，生产 origin 必须为准确 HTTPS；将平台 callback 更新为该公开来源加 /callback。前端、API 和 HTTPS 入口保持同源，模板为单副本。

按 deploy/edge.example.json 准备公开入口配置，用 renderer 生成 Nginx；按 deploy/compose.env.example 准备私有镜像、证书和配置绝对路径：

```sh
node deploy/render-edge.mjs /srv/oauth/config/edge.json /srv/oauth/config/nginx.conf
docker compose --env-file /srv/oauth/private/compose.env -f deploy/compose.yml config --quiet
docker compose --env-file /srv/oauth/private/compose.env -f deploy/compose.yml up -d
```

只有 oauth-edge 公开 HTTP/TLS，API 和静态页留在私网。不要记录 callback 敏感查询、把 secret 传入构建参数或关闭 TLS 校验。实际验证回调、state 拒绝、令牌生命周期和入口故障后再用于目标环境演练。
