# 独立报表中心

报表中心是独立 React 微应用，提供组织授权上下文、角色查询、导航/通知回调、计时器与组件状态演示。应用编码和 UMD 导出名为 `report-center`，通过 qiankun `HTML + TRUSTED` 接入，不依赖宿主 React、UI 别名或平台仓库源码。

## 启动和构建

使用 Node.js 24.22.1、npm 11.16.0，在本目录执行：

```sh
npm ci
npm run dev
```

入口为 `http://127.0.0.1:3009/index.html`。`dev` 监听源码构建后提供静态预览；修改后需在平台重新加载，无浏览器 ESM/HMR。单独打开 HTML 仅显示通过平台打开的提示。

```sh
npm run build
npm test
npm run preview
```

`build` 先执行 TypeScript 检查，再将 React、图标、本地组件和 SDK 构建为 `dist/report-center.umd.js` 与 `dist/report-center.css`。静态 HTML 来自 `public/index.html`，依赖许可证写入 `dist/licenses/`；`preview` 使用 3009 且端口冲突直接退出。

## 平台接入与生命周期

```js
import { loadMicroApp } from 'qiankun'

const application = loadMicroApp({
  name: 'report-center',
  entry: 'http://127.0.0.1:3009/index.html',
  container: '#micro-app-container',
  props: { platform: microProps },
})
await application.mountPromise
await application.update({ platform: nextMicroProps })
await application.unmount()
```

`microProps` 为 SDK 2.0.0 的完整 MicroProps 2.0，`appCode` 为 `report-center`。适配器从 `props.platform` 读取授权信息，查找 `props.container` 内的 `#report-center-root`，只导出标准 `bootstrap/mount/update/unmount`。缺失、过期上下文或无效 update 会清除授权视图；后续有效上下文可恢复挂载。

默认路由为 `/micro/report-center`，`/micro/report-center/shared` 展示独立运行时和平台回调。路由与主题通过平台 update 同步，应用通过 `onNavigate` 请求导航。普通 update 保留 React 根、按钮计数和计时器；授权签名变化则取消旧角色请求并屏蔽旧结果。宿主取消、上下文/令牌到期、卸载会清理视图和计时器。

点击查询调用当前浏览器来源的 `GET /api/external/roles`，只发送应用 Bearer token，`credentials: omit`。API 路由与用户/租户/组织授权由平台提供；静态服务器 CORS 不代表业务 API 已配置。

样式以 `.saas-report-center` 为作用域，Tailwind 内部属性使用报表专属前缀，主题写在应用节点上。qiankun 是可信同页执行方案，仍需审阅加载的应用代码与依赖。

## 交付与验证

完整发布 `dist/` 到新的版本目录，例如 `/sub-apps/report-center/versions/<版本号>/`。HTML 通过普通 `script` 加载 UMD，相对引用 JS/CSS；服务器需准确 MIME、静态 CORS、HTTPS 和缺失资源 404。不要将未知脚本请求回退为首页。

`npm test` 实际构建并在 jsdom 执行 UMD，检查生命周期导出、局部挂载、拒绝无效上下文、状态保留、请求取消与迟到响应、授权替换、计时器清理、版本目录 HTTP 交付、CSS 作用域和 SDK 产物清单。它不依赖真实数据库，也不替代平台联调。

固定 SDK 位于 `vendor/micro-sdk/`，`SOURCE.json` 记录来源基线、`workingTree` 和逐文件 SHA-256，`artifact-manifest.json` 描述产物。当前 SDK 包含工作树迁移内容。升级后更新仓库根 `dependencies.lock.json`，执行 `node scripts/check-inputs.mjs` 和本示例测试、构建。
