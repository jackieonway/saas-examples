# 本地接入状态

> 后续状态：用户已确认移除该示例。平台应用及其菜单/租户/组织/角色菜单授权已删除，聊天服务已停止；静态 1.0.0 材料移至 `artifacts/retired-release-1.0.0`，不再由平台开发服务器提供。以下为此前接入时的历史记录。

- 平台：`http://127.0.0.1:3000`。
- 应用：WebSocket 聊天，编码 `websocket-chat`，HTML / IFRAME。
- 菜单：`/micro/websocket-chat`。
- 发布：`development` / `1.0.0`，通过 3/3 资源预检并激活。
- 入口：`/sub-apps/websocket-chat/versions/1.0.0/index.html`。
- 静态材料：平台 `frontend/deploy/micro-apps/websocket-chat/versions/1.0.0/`。
- 授权：仅为平台管理租户和总公司开启应用及首页菜单，未对其他租户批量授权。
- OAuth：客户端 `websocket-psd6xx`，机密类型，profile，访问令牌 300 秒，已通过编辑页面确认关联 WebSocket 聊天。
- 浏览器：平台显示令牌已注入、运行时同步、运行中，iframe 聊天界面已渲染。
- 自动检查：前端类型检查与构建通过；5 项前端测试通过；6 项 Rust 测试通过。
- 未完成：真实聊天收发验收。此次启动的 Rust 进程虽然显示监听 `127.0.0.1:3008`，但浏览器和本机 HTTP/Socket.IO 客户端均连接超时。独立页面同样不能连接，因此故障不局限于 iframe。尚未定位主机连接超时的原因。
- 客户端密钥仅保留在浏览器一次性展示窗口，未复制到源码、产物、状态记录或聊天服务。

此次通过登记 URL 完成本地静态接入；ZIP 上传未生成版本记录。没有启用受管镜像部署，也不代表已完成生产部署。
