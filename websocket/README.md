# Socket.IO 聊天微应用

React / TypeScript 前端通过 qiankun HTML + UMD 接入，应用编码和生命周期导出名为 `websocket-chat`。独立 Rust API 提供匿名、无持久化的 Socket.IO 聊天；平台授权上下文控制微应用挂载期，聊天 API 不消费平台令牌。

## 本地启动

使用 Node.js 24.22.1、npm 11.16.0、Rust 1.97.0。以下命令均在本 `websocket` 目录执行。先启动 Rust API，保持终端输入开放，stdin EOF 或 Ctrl+C 会停服：

```powershell
$env:CHAT_ALLOWED_ORIGINS='http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3007,http://localhost:3007'
cargo run --locked --manifest-path backend/Cargo.toml
```

上例同时放行常见本地平台来源与独立页面来源；实际使用时填写浏览器平台的准确来源。另开终端：

```powershell
npm ci
$env:VITE_CHAT_ENDPOINT='http://127.0.0.1:3008'
npm run dev
```

前端默认 `http://127.0.0.1:3007/`，后端为 3008。`dev` 使用构建监听和静态预览，始终交付 classic UMD，不注入 ESM/HMR；修改后手动刷新。未配置 endpoint 时保持离线。配置值只允许无凭据、路径、查询、片段的 HTTP(S) 来源；Vite 从进程环境读取此唯一公开构建值，不读取 `.env`。

独立打开页面可演示匿名聊天，不生成平台身份。通过 qiankun 加载时由宿主调用生命周期；两种模式都需要用户点击 Connect，随后填写用户名并 Join Chat 才能发送消息。连接中断后需重新加入。

## 平台接入

在平台登记 `websocket-chat`，采用 `HTML + TRUSTED`。宿主加载示例：

```js
import { loadMicroApp } from 'qiankun'

const app = loadMicroApp({
  name: 'websocket-chat',
  entry: 'http://127.0.0.1:3007/',
  container: '#micro-app-container',
  props: { platform: microProps },
})
await app.mountPromise
await app.update({ platform: nextMicroProps })
await app.unmount()
```

应用只接收 `props.platform` 内的完整 SDK 2.0.0 / MicroProps 2.0，挂载于 `props.container` 内的 `#root`。qiankun 的 `name/container` 和服务扩展不混入平台上下文。菜单路径可登记为 `/micro/websocket-chat`，应用权限与当前组织授权由宿主处理。

主题和路由更新保留当前连接。token、授权签名或宿主 signal 变化会销毁旧 React 根和 socket，清空聊天状态；用户需再次连接、加入。上下文或 token 到期、撤销、无效更新及卸载会清理 socket 监听器、重连任务、计时器和授权监听器。CSS 限定 `.saas-websocket-chat`。

聊天使用 Engine.IO 根传输路径 `/`，与平台持久通知服务区分。不要将平台 Cookie、应用 token 或 OAuth secret 加入聊天 URL/参数。qiankun 在平台页面中执行，聊天 API 的 Origin 白名单须包含实际平台来源；静态 HTML 来源不会代替浏览器 Origin。

## 测试与构建

```sh
npm run typecheck
npm test
npm run build
npm run preview
cargo test --locked --manifest-path backend/Cargo.toml
```

`npm test` 包括构建、endpoint 配置、UMD/版本目录 HTTP 交付和生命周期用例。浏览器测试单独执行，支持使用已安装的 Edge：

```powershell
$env:SAAS_TEST_BROWSER='msedge'
npm run test:browser
```

也可使用项目 Playwright 的 chromium 等已安装浏览器；`PLAYWRIGHT_BROWSERS_PATH` 必须是绝对路径，默认缓存位于 `tests/.browsers`。浏览器用例构建真实 UMD 并拦截受控 Socket.IO 帧，覆盖连接、加入、消息、重连及 qiankun 撤权清理；它不替代真实 Rust 服务的双客户端通信验收。

## 发布与历史材料

`npm run build` 输出 `dist/index.html`、`assets/websocket-chat.umd.js` 和 CSS。完整复制 `dist/` 到新的不可变版本目录，按实际发布版本登记入口。保留相对资源、准确 MIME、静态 CORS、HTTPS 和缺文件 404。可将当前构建另存为全新 ZIP，不能用旧归档代表当前源码，也不要覆盖已发布版本。

`artifacts/retired-release-1.0.0/` 与 `artifacts/websocket-chat-1.0.0.zip` 保留早期交付字节；旧 HTML 仍是 `type="module"` 入口，不能作为当前 qiankun 交付包。截图也只属于历史材料，不证明当前平台已登记、已授权或服务可用。

SDK 固定副本位于 `vendor/micro-app-sdk/2.0.0/`，`SOURCE.json`、产物清单与仓库根 `dependencies.lock.json` 记录来源和摘要。当前 `workingTree: true` 表示包含未提交 SDK 迁移内容。升级后运行仓库根 `node scripts/check-inputs.mjs` 和本例检查。

本示例没有完整生产 Compose。Rust 服务仅绑定回环地址，生产需在同机设计受控 HTTPS/WebSocket 代理、明确 Origin 白名单和进程管理。协议、限额与后端配置见 [Rust API 说明](backend/README.md)。
