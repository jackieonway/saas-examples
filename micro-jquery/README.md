# jQuery 微应用

此示例将 jQuery 3.7.1 页面通过 classic HTML 接入 qiankun。应用编码和最终导出名为 `legacy-jquery`，使用 SDK 3.0.0 / MicroProps 2.0，演示平台上下文、菜单查询、通知与导航，以及授权变更后的请求取消。

## 开发与检查

使用 Node.js 24.22.1、npm 11.16.0，在本目录执行：

```sh
npm ci
npm run dev
```

默认入口为 `http://127.0.0.1:3006/`，端口已占用时直接失败。通过平台加载入口以获得授权上下文；单独打开 HTML 不会自动挂载业务视图。开发模式关闭 HMR，修改后重新加载微应用。

```sh
npm test
npm run test:qiankun
npm run build
npm run preview
```

`npm test` 包括业务上下文、真实 jQuery/SDK 逐脚本沙箱、生命周期和 Vite HTTP 交付测试；`test:qiankun` 只执行名称匹配 qiankun 的用例。`build` 输出 `dist/`，`preview` 在 3006 端口预览构建结果。

## 宿主接入

平台应用设置为 `HTML + TRUSTED`，登记准确入口和已授权菜单。宿主示例：

```js
import { loadMicroApp } from 'qiankun'

const app = loadMicroApp({
  name: 'legacy-jquery',
  entry: 'http://127.0.0.1:3006/',
  container: '#micro-app-container',
  props: { platform: microProps },
})
await app.mountPromise
await app.update({ platform: nextMicroProps })
await app.unmount()
```

`microProps` 必须由宿主生成，`appCode` 为 `legacy-jquery`。入口只接收嵌套的 `props.platform`，查找 `props.container` 内的 `#app`，拒绝直接展开的 MicroProps。qiankun `name` 可用于标识加载实例，不能代替授权上下文中的应用编码。

HTML 脚本顺序为 `vendor/jquery.min.js`、`vendor/micro-sdk.js`、`app.js`、`qiankun-entry.js`。最后一个脚本导出 `bootstrap/mount/update/unmount`；不要改成模块入口或将 SDK 当作生命周期注册器。普通路由、主题更新保留界面状态，授权签名或宿主 signal 变化会取消旧请求并清除旧查询结果。卸载释放请求、计时器、jQuery 事件和授权监听器。

页面通过 SDK 请求当前浏览器来源的 `/api/external/menus`，携带当前应用 Bearer token。平台负责提供该 API、应用授权与上下文；Vite 静态服务器没有业务 API 代理。应用不自行保存平台令牌或刷新平台会话。

## 发布与依赖维护

完整发布 `dist/` 到新的版本目录，例如 `/sub-apps/jquery/versions/<版本号>/`。入口内资源是相对路径；静态服务器必须正确返回脚本 MIME、允许实际宿主来源获取资源，并让缺失文件返回 404。HTTPS 平台应登记 HTTPS 入口。不要发布源码、私有配置或 `node_modules`。

SDK 字节和来源说明位于 `public/vendor/micro-sdk.js` 与 `public/vendor/micro-sdk.SOURCE.json`，仓库根 `dependencies.lock.json` 固定摘要。`workingTree: true` 表明当前副本含 SDK 未提交迁移内容。升级后在仓库根运行 `node scripts/check-inputs.mjs`，再执行本目录的测试和构建。jQuery 副本及许可证随静态包交付；逐脚本测试验证其全局导出只写入当前应用的沙箱。
