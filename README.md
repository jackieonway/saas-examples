# 接入示例集合

本仓库的示例独立安装与构建，不读取平台或业务仓库源码。Node 24.18.0、npm 11.16.0、Rust 1.97.0 为工具基线。

| 示例 | 内容 | 开发端口 | 说明 |
| --- | --- | --- | --- |
| micro-vue | classic Vue 微应用 | 3005 | [开发与发布](micro-vue/README.md) |
| micro-jquery | classic jQuery 微应用 | 3006 | [开发与发布](micro-jquery/README.md) |
| websocket | React 聊天页、独立 Rust Socket.IO 参考 API | 3007 / 3008 | [开发与部署](websocket/README.md) |
| oauth-playground | Vite 演练页、Rust OAuth 流程 API | 3010 / 3011 | [开发与部署](oauth-playground/README.md) |

进入所需前端执行 npm ci、npm run dev，npm run build 生成 dist。Rust 服务分别在自己的 backend 执行 cargo run --locked。没有跨示例统一启动器。

仓库根执行 node scripts/check-inputs.mjs 校验 Vue/jQuery 的固定 SDK 副本，来源摘要在 dependencies.lock.json。升级从独立 SDK 仓库取得审阅版本，再更新副本、摘要和测试，不跟随上游 main。

CI 分别构建四个前端、运行前端/交付测试及两个 Rust 工程检查；不执行生产部署。静态页面只交付 dist，不发布源码、node_modules 或私有配置。示例不能替代真实平台授权或数据库业务验收。
