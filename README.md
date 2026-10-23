# qiankun 微应用示例

本仓库提供五个独立前端示例，以及聊天和 OAuth 两个独立 Rust 服务。当前前端源码统一采用 qiankun 标准 `bootstrap`、`mount`、`update`、`unmount` 生命周期，使用 SDK 2.0.0 的 MicroProps 2.0 授权上下文；平台接入配置为 `HTML + TRUSTED`。

| 目录 | 应用编码 / 生命周期导出名 | 页面与能力 | 前端端口 | 独立 API 端口 |
| --- | --- | --- | --- | --- |
| [micro-vue](micro-vue/README.md) | `vue-workshop` | Vue 3、菜单与角色查询 | 3005 | 使用平台 API |
| [micro-jquery](micro-jquery/README.md) | `legacy-jquery` | jQuery、遗留页面接入、菜单查询 | 3006 | 使用平台 API |
| [websocket](websocket/README.md) | `websocket-chat` | React、匿名 Socket.IO 聊天 | 3007 | 3008 |
| [report-center](report-center/README.md) | `report-center` | React、角色查询与运行时通信 | 3009 | 使用平台 API |
| [oauth-playground](oauth-playground/README.md) | `oauth-playground` | OAuth 流程与回调工具页 | 3010 | 3011 |

当前自有 npm 包版本为 1.0.1，安全升级记录见 [RELEASE.md](RELEASE.md)。

## 工具与启动

工具基线由 `.node-version`、`.nvmrc`、`rust-toolchain.toml` 和各 `package.json` 约束：Node.js 24.22.1、npm 11.16.0、Rust 1.97.0。先用 `node --version`、`npm --version`、`rustc --version` 确认终端实际命中的工具。

从本仓库根目录启动所需前端，例如：

```sh
npm --prefix micro-vue ci
npm --prefix micro-vue run dev
```

其他前端对应 `micro-jquery`、`report-center`、`websocket`、`oauth-playground/frontend`。各示例独立安装依赖，没有仓库根 package 或跨示例统一启动器。聊天和 OAuth API 的配置与启动见各示例说明；OAuth 目录的 `npm run dev` 可同时构建、启动本仓 API 和前端，并在任一进程退出时清理另一进程。

Vue/jQuery 的开发服务器直接交付 classic 脚本；其余三个前端使用构建监听加静态预览，交付 UMD。都不向 qiankun 入口注入浏览器原生 ESM/HMR 客户端；修改代码后在平台重新加载应用。

## 接入约定

宿主通过 qiankun 加载 HTML，生命周期只在 `props.container` 内挂载；平台授权信息完整放入 `props.platform`。不要将 qiankun 的 `container`、`name` 或本地服务扩展并入 MicroProps DTO。应用编码必须与平台登记和上下文中的 `appCode` 一致。

```js
import { loadMicroApp } from 'qiankun'

const application = loadMicroApp({
  name: 'vue-workshop',
  entry: 'http://127.0.0.1:3005/',
  container: '#micro-app-container',
  props: { platform: microProps },
})
await application.mountPromise
await application.update({ platform: nextMicroProps })
await application.unmount()
```

这里的 `microProps` 和 `nextMicroProps` 由真实宿主生成，包含应用令牌、用户、租户、组织、权限、数据授权、菜单、路由、主题、期限、`contextEpoch`、`signal` 和平台回调。示例不提供伪造平台授权的启动方式。上下文取消与应用卸载必须由宿主执行，以终止旧身份的请求和视图；qiankun 在可信同页环境中运行。

Vue/jQuery、报表中心的 `/api/external/*` 请求发送到浏览器当前平台来源。跨域 HTML 入口的静态 CORS 不会自动代理业务 API。聊天使用单独公开 endpoint；OAuth 使用独立的同源 API 前缀和会话，具体要求见相应文档。

## 构建、发布与来源校验

每个前端的 `npm run build` 生成自己的 `dist/`。完整发布 `dist` 到新的不可变版本目录，保留相对资源路径、准确 MIME 和缺失资源的真实 404；跨域加载时允许实际宿主来源访问 HTML、JS、CSS。HTTPS 宿主需要 HTTPS 静态入口和业务服务。应用版本与 SDK 版本分别管理。

SDK 副本来自独立 `saas-micro-app-sdk/releases/2.0.0`。仓库根 `dependencies.lock.json` 固定五处 SDK 副本及来源元数据，执行：

```sh
node scripts/check-inputs.mjs
```

`SOURCE.json` 或 `micro-sdk.SOURCE.json` 记录基线提交、实际文件 SHA-256 和 `workingTree`。当前 `workingTree: true` 表示副本包含 SDK 工作树中的未提交迁移内容，不能据此声称已发布版本经提交归档。升级应审阅 SDK 版本、同步副本和来源摘要、更新锁定清单，再运行测试。

`websocket/artifacts/retired-release-1.0.0/` 和 `websocket/artifacts/websocket-chat-1.0.0.zip` 是旧交付档案，不能作为当前 qiankun 发布包。OAuth 的微应用入口、API 前缀、callback 及资源别名见 [OAuth 网关接入](oauth-playground/README.md#部署与网关路由)。历史归档不进入当前产物门禁和候选包。

五个工程构建完成后，在仓库根验证和生成新的本地候选：

```sh
node scripts/verify-delivery.mjs
node scripts/package-candidates.mjs <新候选名称>
node scripts/verify-candidate.mjs artifacts/candidates/<新候选名称>
```

门禁只读取表中五个当前 `dist`，用禁用执行和外部加载的 HTML DOM 解析处理注释、实体及无引号属性，再检查 classic HTML/相对资源、实际逐脚本执行的四个生命周期、局部挂载、SDK 1 上下文拒绝和 SDK 2 上下文接受。构建输出的 `build-provenance.json` 记录源码、public/vendor、包锁及共享构建配置的 SHA-256，以及实际 Node/npm 版本；输入变化或 Node 构建版本不符合当前基线时，门禁要求重建。

候选输出到 `artifacts/candidates/<名称>/`，每个应用包含完整静态文件及逐文件 SHA-256 清单，汇总清单记录 Git 基线、工作树状态、验证器、依赖锁和构建输入摘要。`verify-candidate.mjs` 复核候选文件及其与当前输入的一致性。已有候选目录禁止覆盖；候选不代表已部署或业务授权验收。

## 验证

安装依赖后，在仓库根执行与 CI 对应的前端检查：

```sh
node scripts/check-inputs.mjs
npm --prefix micro-vue test
npm --prefix micro-jquery test
npm --prefix report-center test
npm --prefix websocket test
npm --prefix oauth-playground test
```

CI 构建五个前端、运行当前产物门禁与真实 Nginx OAuth 路由测试、上传候选，并对两个 Rust 工程执行格式检查和 `cargo test --locked`。聊天的 Playwright 测试需单独运行，不属于默认 `npm test`。测试覆盖生命周期、上下文更新、容器作用域、请求清理、classic/UMD 交付、静态 404 和 OAuth 代理凭据边界；真实平台授权、真实 OAuth 客户端及双客户端聊天仍需在目标环境验收。
