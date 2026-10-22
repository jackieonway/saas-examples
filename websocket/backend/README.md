# 聊天 Rust 参考服务

Rust 1.97.0 独立 Cargo 工程，使用 Axum/Tokio 与 socketioxide/engineioxide 实现 Socket.IO 聊天协议，不依赖平台数据库或业务 crate。

在本 backend 执行 cargo run --locked、cargo test --locked、cargo build --release --locked。程序默认绑定 127.0.0.1:3008，CHAT_BIND_ADDR 可改为受支持的回环地址；CHAT_ALLOWED_ORIGINS 是精确来源列表，默认前端 127.0.0.1/localhost:3007。

polling 和 WebSocket Upgrade 均校验来源，非浏览器无 Origin 行为以源码为准。没有账号认证、平台会话或持久化。

每连接先 join 再发 message，用户名绑定该连接；最多 256 个成员，用户名 1–64 字符/256 字节，消息 1–4096 字符/16384 字节，非法对象返回固定错误。stdin EOF 或 Ctrl+C 关闭连接与 HTTP，后台运行时不能意外关闭 stdin。

部署时单独设计 HTTPS 入口和进程管理，不将此参考服务用于平台持久通知。前端运行见 [聊天说明](../README.md)。
