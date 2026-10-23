# Release 日志

## 1.0.1 — 2026-10-23

- 将六个自有 npm 包 `micro-vue`、`micro-jquery`、`saas-report-center`、`saas-websocket-demo-ui`、`oauth-playground` 和 `oauth-playground-frontend` 从 1.0.0 升级到 1.0.1，并同步各自 `package-lock.json` 的根包版本。
- 将活动 Node.js 基线从受影响的 24.18.0 升级到安全修复版 24.22.1，覆盖 `.node-version`、`.nvmrc`、六个包及锁文件的 `engines.node`、开发文档和 OAuth 前端 Docker 构建镜像。CI 通过 `.nvmrc` 使用新版本。
- Node.js 24.22.1 包含本项目所用 24.x 分支的安全修复：CVE-2026-105482、CVE-2026-105483、CVE-2026-106069、CVE-2026-111497、CVE-2026-105481、CVE-2026-106072、CVE-2026-106074、CVE-2026-106073。依据：[2026 年 10 月安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[Node.js 24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1)。
- 这些 Node.js 修复覆盖开发服务器、构建、测试和构建镜像中的 Node 运行时。生产服务使用 Rust API 和 Nginx 静态交付；需在 Node.js 24.22.1 下重新安装依赖、构建并部署新产物或镜像，现有部署不会因源码版本更新而自动生效。
- npm、Rust、供应商 SDK 和协议版本保持现有基线，历史交付归档保留原版本。本次版本记录不表示已向目标环境部署。

验证结果：在 Node.js `24.22.1`、npm `11.19.1` 下，五个前端的依赖安装和构建通过；Vue 12 项、jQuery 11 项、报表 8 项、聊天 9 项、OAuth 前端 18 项和根目录交付/代理/启动器 7 项测试通过。来源校验、2 项交付门禁测试及五份当前构建产物的交付校验通过。首轮并发运行的三个回环 HTTP 检查发生超时，随后单项及完整套件顺序重跑均通过。本机缺少 Docker、Nginx 和 OpenSSL 命令，未执行镜像构建及真实 Nginx 集成检查。

后续来源复核：早期 `qiankun-20261023-current-v2` 候选没有包锁/源码/实际构建工具链指纹，不能作为 Node 升级后的当前候选。五个构建已加入共享来源清单，门禁拒绝过期源码、包锁或 Node 基线，并保留历史候选字节；本轮使用实际 Node `24.22.1` / npm `11.19.1` 重新构建并生成 `qiankun-20261023-current-v3` 本地候选。新增来源回归覆盖“JS 未变但包锁、源码或 Node 基线变化”的拒绝行为。先前真实 Nginx HTTPS/回调/凭据边界测试已通过 WSL 中的隔离 Docker 执行；未构建部署镜像，未执行真实 OAuth、聊天或生产切换。
