# Socket.IO 聊天参考 API

这是独立 Rust / Axum / Tokio / socketioxide 工程，提供临时匿名聊天室，不依赖平台数据库或业务 crate。前端以 qiankun 运行时，平台授权只控制页面挂载期；本服务不验证平台 token，不提供账号认证和持久通知。

## 运行与配置

使用仓库固定 Rust 1.97.0，在本 `backend` 目录执行：

```sh
cargo run --locked
cargo test --locked
cargo build --release --locked
```

程序通过进程环境读取配置，不自动载入 `.env`。

| 变量 | 默认值 | 约束 |
| --- | --- | --- |
| `CHAT_BIND_ADDR` | `127.0.0.1:3008` | IP + 端口，只允许回环地址；测试可用端口 0 |
| `CHAT_ALLOWED_ORIGINS` | `http://127.0.0.1:3007,http://localhost:3007` | 逗号分隔的 1–16 个准确 HTTP(S) origin，无尾斜杠、路径、凭据、查询或通配符 |
| `CHAT_ALLOW_SANDBOX_ORIGIN` | `false` | 历史兼容开关，`true` 额外允许字面值 `null`；qiankun 接入保持 false |

qiankun 页面请求的 Origin 是实际平台来源。若本地平台为 3000，应在启动前把准确 3000 来源加入白名单。polling、WebSocket Upgrade 都经过 Origin 检查；多个 Origin 头或不在白名单的来源返回 403。没有 Origin 的非浏览器请求允许继续处理，因此 Origin 检查不能作为身份认证。

进程启动输出 JSON `ready` 事件及实际监听地址。stdin EOF 或 Ctrl+C 先关闭 Engine.IO 连接，再关闭 HTTP；通过进程管理器运行时要确保 stdin 的生命周期与预期一致。

## 协议

Engine.IO 请求路径和 Socket.IO namespace 均为 `/`。该路径与平台的 `/socket.io` 持久通知入口不同。

| 方向 | 事件 | 数据 |
| --- | --- | --- |
| 客户端 → 服务 | `join` | `{ username }`，先加入再发消息 |
| 客户端 → 服务 | `message` | `{ username, content }`，用户名必须与本连接已加入身份一致 |
| 服务 → 客户端 | `users-list` | `{ users }` |
| 服务 → 全部连接 | `user-joined` / `user-left` | `{ user, message }` |
| 服务 → 全部连接 | `message` | `{ id, username, content, timestamp, type }` |
| 服务 → 请求连接 | `error` | 固定 `code` 和 `message`，拒绝无效负载 |

还保留 `test` → `test-response` 诊断事件。用户名与 socket 绑定，重复使用相同用户名加入同一连接不重复广播；改名需断开后重新加入。断线会移除成员，重连后需再次 join。

聊天室上限 256 个成员。用户名为 1–64 个字符、最多 256 字节，不能有首尾空格或控制字符；消息为 1–4096 个字符、最多 16384 字节。join/message 只接受符合字段定义的 JSON 对象，拒绝未知字段。传输负载和缓冲也有上限，详见 `src/server.rs`。

## 验证和部署边界

单元测试覆盖配置、负载形状、连接身份与成员清理、文本和房间限额。真实 TCP、浏览器 CORS、TLS/WebSocket 代理及双客户端通信应另行联调。

服务本身仅允许回环监听，不能通过将 `CHAT_BIND_ADDR` 改为 `0.0.0.0` 暴露。生产演练需同机反向代理公开 HTTPS 根传输路径，支持 WebSocket Upgrade，并填写实际页面来源。没有随附可直接投产的 Compose、账号系统、历史存储或跨实例房间同步。前端接入见 [聊天微应用](../README.md)。
