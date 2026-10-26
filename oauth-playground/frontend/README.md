# OAuth qiankun 前端

独立 Vite 前端，应用编码和 UMD 导出名为 `oauth-playground`。源码使用 ESM，交付为 classic HTML + UMD；平台采用 `HTML + TRUSTED`。演练流程的机密操作由独立 Rust API 执行，前端只显示公开能力、状态与脱敏结果。

## 开发和检查

使用 Node.js 24.22.1、npm 11.16.0，在本 `frontend` 目录执行：

```sh
npm ci
npm run dev
```

默认 `http://127.0.0.1:3010/`。`dev` 监听源码重建并提供静态预览，修改后重新加载微应用，不注入原生 ESM/HMR。`OAUTH_PLAYGROUND_FRONTEND_PORT` 可修改端口，`OAUTH_PLAYGROUND_API_TARGET` 默认为 `http://127.0.0.1:3011`，只用于工具端代理；API 需另行启动。

```sh
npm test
npm run build
npm run preview
```

`dist/` 包含主 HTML、独立 `callback.html`、UMD、CSS 和 callback classic 脚本。Vite 不把常规 `VITE_*` 环境变量注入浏览器；公开 OAuth 能力在挂载后从 API 获取。

## 宿主挂载

```js
import { loadMicroApp } from 'qiankun'

const app = loadMicroApp({
  name: 'oauth-playground',
  entry: 'http://127.0.0.1:3010/index.html',
  container: '#micro-app-container',
  props: {
    platform: microProps,
    services: { oauthApiBase: '/oauth-playground-api' },
  },
})
await app.mountPromise
await app.update({
  platform: nextMicroProps,
  services: { oauthApiBase: '/oauth-playground-api' },
})
await app.unmount()
```

`platform` 是完整 SDK 3.0.0 / MicroProps 2.0，`appCode` 必须为 `oauth-playground`。入口只查找 `props.container` 内的 `#oauth-playground-root`，导出 `bootstrap/mount/update/unmount`。独立打开主 HTML 不自动挂载，也不生成平台身份。

页面流程切换通过 `onNavigate` 请求 `/micro/oauth-playground/<flow>`，路由和主题由 update 同步。有效授权替换会取消旧请求和设备轮询、清除密码及旧结果；无效 update、宿主 signal 取消、上下文或 token 最早到期会立即撤销旧视图并清理请求、计时器与事件监听，后续有效上下文可恢复。显式 unmount 后 update 不会重新挂载。CSS 限定 `.oauth-playground`，主题写入应用节点。

`services.oauthApiBase` 是应用本地扩展，仅允许同源路径前缀，默认 `/oauth-playground-api`，不是 SDK 公共 PlatformServices 的新增字段。挂载后改变 API 前缀需要重新挂载。

## 代理、会话与 callback

微应用请求 `/oauth-playground-api/*`，网关重写为 Rust API 的 `/api/*`。API 使用自己的 HttpOnly 会话 Cookie 和准确 Origin 校验，不接收平台应用 Bearer token。Vite 代理移除 Authorization，只转发 `oauth_playground` 或 `__Host-oauth_playground` Cookie，并保留真实 Origin；生产 HTTPS 模板只转发其 API 实际使用的 `__Host-oauth_playground` Cookie。网关不伪造 Origin 或放宽 API 的会话/JSON 检查。

挂载只自动读取公开配置；授权、换 token、刷新、吊销和资源检查都由用户操作触发。设备轮询依照服务给出的 interval 及 slow_down 调整，取消或上下文替换终止轮询。API 不可用时显示失败并禁用相关动作，不切换到平台业务 API。

API 的 `OAUTH_PUBLIC_ORIGIN` 必须是浏览器公开平台来源，callback 固定为该来源加 `/callback`。需在真实客户端登记准确地址，并提供以下公开路由：

| 路由 | 行为 |
| --- | --- |
| 主微应用入口 | 提供 `dist/index.html` 与相对资源 |
| `/oauth-playground-api/*` | 代理到独立 API `/api/*` |
| 精确 `/callback` | 提供 `dist/callback.html` |
| `/sub/oauth-playground/assets/*` | 提供 `dist/assets/*`，callback 使用固定静态别名 |

Vite dev/preview 提供这些本地别名，同时保留 `/api`、`/health` 代理。平台同源挂载时必须由平台入口提供映射，静态入口跨域 CORS不会改变 API 的同源目标。

callback 是独立工具页。加载时先从地址栏清除授权查询，只在点击“确认验证回调”后向 `/oauth-playground-api/callback` 提交一次。失败后核对会话并重新发起；主 qiankun 入口不消费宿主 URL 查询。callback 的 API 前缀固定，不能只修改主应用 services 而忽略 callback 路由。

## 交付、测试与 SDK

只发布完整 `dist/`，确保正确 MIME、静态 CORS、HTTPS 和缺失资源真实 404。主入口使用相对资源，可部署版本目录；callback 的固定别名也要映射到同一发布版本。Docker/网关模板已提供主入口、API 和 callback 别名，具体接入及真实 Nginx 测试见 [网关部署](../README.md#部署与网关路由)。稳定命名资源与当前 callback 别名使用 no-store，防止旧缓存混用。

测试覆盖 API 路径与脱敏、RFC 8628 设备轮询，并实际构建、执行 UMD，验证局部挂载、严格嵌套上下文、显式交互、授权替换、取消/清理、callback 和 HTTP 静态交付。测试不登记真实 OAuth 客户端或发起业务授权。

固定 SDK 位于 `vendor/micro-sdk/`。`SOURCE.json` 和仓库根 `dependencies.lock.json` 固定来源与 SHA-256；当前 `workingTree: true` 表示 SDK 副本含未提交迁移内容。升级后运行仓库根 `node scripts/check-inputs.mjs` 和本目录测试、构建。

当前平台已移除 password grant；新系统只验证授权码/设备授权及机器凭据流程，不配置或启用历史 password 示例。人员账号在 SSO 认证中心登录。
