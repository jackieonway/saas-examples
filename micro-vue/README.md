# Vue 微应用

此示例使用 Vue 3.5.43 global 构建和 classic HTML 接入 qiankun。应用编码和最终导出名为 `vue-workshop`，使用 SDK 3.0.0 / MicroProps 2.0，展示菜单、角色、权限、数据授权与平台导航通信。

## 开发与检查

使用 Node.js 24.22.1、npm 11.16.0，在本目录执行：

```sh
npm ci
npm run dev
```

默认入口为 `http://127.0.0.1:3005/`，端口冲突时退出。通过平台加载以取得真实上下文；单独打开页面不生成身份或自动挂载业务视图。开发模式不注入 ESM/HMR，修改后在平台重新加载应用。

```sh
npm test
npm run test:qiankun
npm run build
npm run preview
```

`npm test` 执行业务、生命周期、真实 Vue/SDK 逐脚本沙箱及 HTTP 交付用例；`test:qiankun` 执行名称匹配 qiankun 的子集。构建输出 `dist/`，预览端口同为 3005。

## qiankun 接入

平台登记应用编码 `vue-workshop`、`HTML + TRUSTED` 和已授权菜单。宿主调用方式：

```js
import { loadMicroApp } from 'qiankun'

const app = loadMicroApp({
  name: 'vue-workshop',
  entry: 'http://127.0.0.1:3005/',
  container: '#micro-app-container',
  props: { platform: microProps },
})
await app.mountPromise
await app.update({ platform: nextMicroProps })
await app.unmount()
```

完整 MicroProps 放入 `props.platform`，其中 `appCode` 必须一致。qiankun 的 `name` 仅标识加载实例。入口查找 `props.container` 内的 `#app`；缺失容器或平台上下文会拒绝挂载。

HTML 顺序为 Vue global 运行时、SDK classic 运行时、`app.js` 和最后的 `qiankun-entry.js`。后者导出标准 `bootstrap/mount/update/unmount`。Vue 官方文件的顶层 `var Vue` 在 qiankun 逐脚本函数作用域间不能直接共享，因此本地副本末尾保留 `window.Vue = Vue` 适配，将运行时暴露给当前沙箱。升级 Vue 时需保留该适配和 MIT 许可证，并运行真实 vendor 沙箱用例。

业务通过当前平台来源的 `/api/external/menus`、`/api/external/roles` 查询，使用应用 Bearer token。Vite 静态服务不代理这些接口。宿主提供用户、租户、组织、权限、期限与取消 signal，路由和主题通过 update 推送。授权签名变化取消旧请求并清除旧业务结果；卸载清理 Vue 根、计时器和授权监听器。

## 发布与 SDK 升级

只发布完整 `dist/`，可置于 `/sub-apps/vue/versions/<版本号>/`。相对资源路径适合版本目录；静态服务需正确 MIME、允许实际宿主来源的 CORS、HTTPS 入口，以及缺失脚本的真实 404。公开文件不能包含后端 secret。

SDK 固定副本为 `public/vendor/micro-sdk.js`，来源与 SHA-256 在 `public/vendor/micro-sdk.SOURCE.json`，仓库根锁定文件为 `dependencies.lock.json`。当前 `workingTree: true` 表示所用 SDK 包含未提交迁移字节。升级先审阅来源与实际文件，同步摘要后运行仓库根 `node scripts/check-inputs.mjs` 及本示例测试、构建。应用版本与 SDK 版本分别管理。
