# jQuery 微应用示例

独立 jQuery / Vite 前端，使用固定 SDK 1.0.0 的 classic 生命周期。该示例按已登记 TRUSTED 兼容模式消费 window.__MICRO_APP__，不是可以随意放宽 opaque iframe 权限的通用模板。

## 开发与测试

Node 24.18.0、npm 11.16.0，在本 micro-jquery 目录执行：

```sh
npm ci
npm run dev
```

默认 http://127.0.0.1:3006，端口占用直接失败。通过平台登记的示例入口加载，宿主所需身份/上下文由平台提供。开发页使用 classic 脚本，代码变化通过宿主重新加载，不把它改成模块脚本绕过加载规则。

```sh
npm test
npm run build
npm run preview
```

测试覆盖上下文、取消/卸载、迟到响应和实际 Vite HTTP/静态交付；不代表真实数据库或生产浏览器链路通过。

## 发布

构建结果为 dist，完整放到新的不可变版本目录，例如 /sub-apps/jquery/versions/1.0.0/。资源相对入口解析，静态服务保持正确 MIME 与真实 404，未知脚本不能回退首页；只发布 dist，不发布配置和依赖缓存。

应用不保存平台令牌或自行刷新会话；切身份、组织或授权后取消旧请求、隔离旧数据。公开配置不能包含后端 secret。

固定 SDK 及框架副本由示例仓库维护。升级先审阅版本、更新 dependencies.lock.json，再运行仓库根 node scripts/check-inputs.mjs 和本示例测试/构建；保留仍受支持的旧静态资源。
