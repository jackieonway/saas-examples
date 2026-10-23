# OAuth 流程 API

独立 Rust / Axum 服务，仅通过配置的平台 HTTP 契约执行 OAuth 流程，不读取平台数据库，不依赖平台业务 crate。client secret、access/refresh token、PKCE verifier 和 state 保存在有界短期内存会话中，浏览器仅收到摘要和脱敏结果。

## 启动与客户端配置

使用仓库固定 Rust 1.97.0，在本 `backend` 目录执行：

```sh
cargo run --locked
cargo test --locked
cargo build --release --locked
```

程序不自动读取 `.env`；通过进程环境或 Compose `env_file` 注入配置。必须先配置 `OAUTH_PUBLIC_ORIGIN` 和 `OAUTH_PLATFORM_ORIGIN`。本地完整启动示例见 [演练指南](../README.md)。

| 变量 | 默认 / 要求 |
| --- | --- |
| `OAUTH_PUBLIC_ORIGIN` | 必填，浏览器页面准确来源，callback 为此来源加 `/callback` |
| `OAUTH_PLATFORM_ORIGIN` | 必填，可信平台来源，提供 OAuth 与资源接口 |
| `OAUTH_BIND_ADDR` | `127.0.0.1:3011`；容器模板设为 `0.0.0.0:3011` |
| `OAUTH_ALLOW_INSECURE_LOOPBACK` | `false`，仅开发显式允许回环 HTTP；其他来源要求 HTTPS |
| `OAUTH_SCOPE` | `profile`，须与真实客户端许可一致 |
| `OAUTH_AUTH_CLIENT_ID` / `OAUTH_AUTH_CLIENT_SECRET` | 授权码 + PKCE 的机密客户端；ID 与 secret 配套 |
| `OAUTH_DEVICE_CLIENT_ID` / `OAUTH_DEVICE_CLIENT_SECRET` | 设备客户端，secret 可按实际客户端省略 |
| `OAUTH_CC_CLIENT_ID` / `OAUTH_CC_CLIENT_SECRET` | 客户端凭据，ID 与 secret 配套 |
| `OAUTH_PASSWORD_ENABLED` | `false`，历史 password 能力开关 |
| `OAUTH_PASSWORD_CLIENT_ID` / `OAUTH_PASSWORD_CLIENT_SECRET` | 启用 password 时必须配置 |

未配置的流程作为不可用能力返回，不伪造成功。来源不允许凭据、路径、查询或 fragment。通过 qiankun 在平台同源运行时，`OAUTH_PUBLIC_ORIGIN` 填实际平台来源；API 自己的 3011 监听地址不作为公开页面来源。

## 会话与限额

| 变量 | 默认值 | 范围 |
| --- | --- | --- |
| `OAUTH_SESSION_TTL_SECONDS` | 1800 | 1–3600 |
| `OAUTH_STATE_TTL_SECONDS` | 300 | 1–600 |
| `OAUTH_TOKEN_TTL_SECONDS` | 3600 | 1–3600 |
| `OAUTH_MAX_SESSIONS` | 200 | 1–10000 |
| `OAUTH_MAX_STATES` | 200 | 1–10000 |
| `OAUTH_HTTP_TIMEOUT_SECONDS` | 5 | 1–15 |

API 通过 `GET /api/config` 建立或复用独立会话 Cookie；HTTPS 使用 `__Host-oauth_playground`，本地 HTTP 使用 `oauth_playground`，均为 HttpOnly、SameSite=Lax、Path=/。所有 POST 要求准确单一 Origin、JSON 和已有会话，不接受平台 token 代替演练会话。

`GET /health`、`GET /api/health` 用于服务健康检查。流程动作通过 `/api/<action>` POST 执行，包括授权启动/callback、设备授权、机器凭据、password、刷新、userinfo、introspect、revoke 和外部菜单/角色检查。前端默认同源前缀 `/oauth-playground-api` 需由网关重写为 `/api`。

state、PKCE 与发起会话绑定且只消费一次，拒绝过期、重放和跨会话请求。并发刷新、吊销及回调采用流程占用控制；结果未知时不会自动重耗 refresh token 或授权码。上游目标由配置固定，客户端禁用环境代理与跳转，并限制响应大小与超时。

## 部署与验证

API 重启、切副本都会丢失内存流程；此模板按单副本演练管理，不提供共享会话恢复。secret 和 token 不进入静态构建、URL、日志或前端构建参数。公开环境使用 HTTPS、正常 TLS 校验及准确客户端 callback。

测试分为配置/会话单元测试、HTTP 安全测试及 `tests/upstream_contract.rs` 的真实本地 HTTP 模拟平台测试。默认使用原生 Axum 监听。若主机限制 Rust 测试可执行文件入站，可显式设置 `OAUTH_TEST_NODE` 为 Node 可执行文件绝对路径，再执行同一 `cargo test --locked`；Node 仅承担临时回环 HTTP 监听和 stdio 传输，生产 reqwest、原 Axum 处理器、并发控制及全部鉴权/脱敏断言不变，不修改主机网络策略。

部署模板、私有环境示例和 qiankun 路由见 [演练指南](../README.md#部署与网关路由)。生产 edge 转发准确的安全演练 Cookie、剥离平台 Cookie/Authorization 并保留 Origin；本服务继续独立执行会话和 CSRF 边界。目标环境仍需验证真实来源/Cookie、state 拒绝、token 生命周期和 callback；测试或候选构建不代表目标环境已部署。
