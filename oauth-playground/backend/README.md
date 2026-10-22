# OAuth 流程 API

独立 Rust / Axum 服务，不查平台数据库，也不依赖平台实现 crate。只调用配置的平台 HTTPS 契约，保存有界、短期演练会话。

## 配置与开发

在本 backend 执行 cargo run --locked、cargo test --locked、cargo build --release --locked。程序不自动读取 .env，配置通过进程环境或 Compose env_file 注入。

| 变量 | 用途 |
| --- | --- |
| OAUTH_PUBLIC_ORIGIN | 演练页面准确公开来源，callback 为此来源加 /callback |
| OAUTH_PLATFORM_ORIGIN | 可信平台入口，提供 /oauth、/api 与授权页面 |
| OAUTH_BIND_ADDR | 默认 127.0.0.1:3011；容器为 0.0.0.0:3011 |
| OAUTH_ALLOW_INSECURE_LOOPBACK | 默认 false，仅开发显式允许回环 HTTP |
| OAUTH_AUTH_CLIENT_ID / SECRET | 已登记机密授权码加 PKCE 客户端 |
| OAUTH_DEVICE_CLIENT_ID / SECRET | 按实际设备客户端配置 |
| OAUTH_CC_CLIENT_ID / SECRET | 明确允许机器凭据的客户端 |
| OAUTH_PASSWORD_ENABLED | 默认 false，历史兼容能力显式启用 |
| OAUTH_SCOPE | 默认 profile，与平台许可一致 |

上表简写 SECRET 指对应完整 OAUTH_*_CLIENT_SECRET，所有实际键见 [部署模板](../deploy/api.env.example)。会话、状态和令牌缓存数量/期限在 src/config.rs 校验。

## 状态与恢复

GET /health、/api/health 是服务检查，/api/config 返回公开能力，流程动作通过当前同源会话调用。state、PKCE 与发起会话绑定且一次消费，错误、过期、重放和跨会话请求拒绝。

secret、access/refresh token 和 verifier 留在后端，不放 URL。API 重启或切副本会丢失流程，需重新发起；结果未知不自动重耗 refresh 或授权码。当前是单副本演练模板，不提供共享会话恢复。

生产使用准确 HTTPS 来源与正常 TLS 校验，镜像、配置与运行顺序见 [演练指南](../README.md)。
