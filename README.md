# SaaS 接入示例

独立维护 Vue、jQuery、Socket.IO 聊天和 OAuth 演练。每个示例使用自己的依赖锁和构建入口，不读取平台源码。聊天前后端、OAuth 前后端分别保留在各自示例目录。

```sh
npm run install:all
npm run deps:check
npm run build
npm test
npm run test:rust
```

工具版本：Node 24.18.0、npm 11.16.0、Rust 1.97.0。需要实际平台交互时，按各示例说明显式配置 HTTPS API 和客户端身份。独立单元/静态交付测试不代表真实平台联合验收通过。

Vue/jQuery 固定 SDK 1.0.0 的副本和 SHA-256 记录在 dependencies.lock.json；不跟随平台或 SDK 主分支。各示例原始提交历史通过 subtree 导入保留。旧说明中的平台根调度命令属于平台联合使用方式，独立运行请直接使用各示例的 package.json。

OAuth Dockerfile 的构建 context 是 oauth-playground/；聊天浏览器测试使用自身的 Playwright 开发依赖，需显式安装浏览器。
