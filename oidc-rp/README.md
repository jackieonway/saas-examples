# 独立标准 OIDC 接入示例

这是一个可直接打开的独立 Web BFF，以及独立的机器调用 CLI。运行时仅依赖通用 [openid-client 6.8.8](https://www.npmjs.com/package/openid-client/v/6.8.8) 和 [jose 6.2.13](https://www.npmjs.com/package/jose/v/6.2.13)，使用公开 Discovery、授权码、JWKS、UserInfo、refresh、RFC 7009 撤销和已登记的 back-channel logout。没有平台 SDK、内部 Rust crate、数据库连接或 `/internal/*` 调用。用户的 `sub` 和客户端标识都作为不透明字符串处理。

样例使用单进程有界内存保存会话，默认本地会话最多 5 分钟。重启会结束本地会话；请按单副本运行。需要多副本或跨重启恢复时，应替换成同一原子事务边界的共享会话、重放和来源撤销存储，再完成相应并发验收。不能只把 Map 换成独立的普通缓存命令。

## 登记与配置

先通过运营方的合作方申请与独立审核流程取得当前环境批准的 **CONFIDENTIAL / WEB_BFF / USER / ACCOUNT_ONLY** 客户端，认证方式为 `client_secret_basic`，授权类型为 `authorization_code` 和允许的 `refresh_token`。精确登记以下 HTTPS 地址：

| 地址 | 用途 |
| --- | --- |
| `https://rp.example.com/auth/callback` | 授权码回调 |
| `https://rp.example.com/auth/backchannel-logout` | BACK_CHANNEL 模式的签名通知接收方 |

back-channel 地址需由运营方验证并绑定当前登记及审核版本。应用自己提供一个 target UUID 或一个邮箱字符串不能替代验证。公开入口只转发公开协议，身份服务私有管理地址不属于示例配置。

第三方默认仅获批 `openid profile`。`email`、`phone`、业务资源、`offline_access` 和 MACHINE 身份均不由这些默认权限派生。配置 `OIDC_SCOPES=openid profile offline_access` 只适用于运营方**另行明确批准**的 ACCOUNT_ONLY 离线配置；修改环境变量本身不能取得权限。机器 CLI 需要另外登记的 SERVICE / MACHINE 客户端。

工具要求为 Node.js `>=24.22.1 <25`、npm `>=11.16.0 <12`。锁文件由 npm 11.19.1 生成，依赖安装不执行生命周期脚本。

```sh
cd oidc-rp
npm ci --ignore-scripts
node --env-file=/run/config/oidc-rp.env server.mjs
```

从 [config.env.example](config.env.example) 复制运行配置到受保护的部署目录。应用密钥由部署系统写入 `OIDC_CLIENT_SECRET_FILE` 指向的私有文件；它不能放进前端、URL、Git 或构建参数。该文件仅在启动时读取。密钥轮换时以新文件重新启动样例，既有本地会话会关闭。

| 配置 | 要求或默认 |
| --- | --- |
| `OIDC_ISSUER` | 必填，准确的 HTTPS origin，无末尾 `/`、路径或查询 |
| `OIDC_CLIENT_ID` | 必填，公开客户端标识，不要求 UUID |
| `OIDC_CLIENT_SECRET_FILE` | 必填，运行时注入的私有密钥文件 |
| `OIDC_SCOPES` | `openid profile`；不接受浏览器动态扩大 |
| `RP_ORIGIN` | 必填，浏览器实际 HTTPS origin |
| `RP_BIND_HOST` / `RP_BIND_PORT` | `127.0.0.1` / `3012` |
| `RP_TLS_CERT_FILE` / `RP_TLS_KEY_FILE` | 可选但必须成对，用于直接 HTTPS；省略时由可信 HTTPS edge 转发 |
| `RP_SESSION_SECONDS` | `300`，允许 1–300，本地截止不会被 refresh 延长 |
| `RP_STATE_SECONDS` | `300`，允许 1–300 |
| `RP_MAX_ENTRIES` | `200`，允许 1–10000，状态／通知事实同样有上限 |
| `RP_HTTP_TIMEOUT_SECONDS` | `5`，允许 1–10 |
| `NODE_EXTRA_CA_CERTS` | 部署使用私有 CA 时，在 Node 进程启动前注入 CA 文件；仍校验 hostname |

直接 HTTPS 使用 `RP_TLS_*`；edge 模式只把内部监听暴露给可信代理，保留浏览器原始 `Host` 和 `Origin`。不要将客户端提交的 `X-Forwarded-*` 当作新的可信来源。应用不读取这些头来改变 issuer 或回调。所有浏览器 Cookie 均使用 `__Host-oidc_rp; Secure; HttpOnly; SameSite=Lax; Path=/`。不提供 HTTP／关闭 TLS 的开发开关。

启动先执行公开 Discovery。它固定 issuer、HTTPS 同源端点、S256、RS256 和可执行能力；上游错误、重定向、不可信 CA 或跨源端点会使启动失败。HTTP 传输不读取环境代理、不跟随跳转，有连接／总超时及响应体大小上限。

## 登录、刷新与撤销

浏览器页面在 `/api/session` 获得自己的会话和 CSRF 值。登录发起使用同源 POST；每次生成独立 state、nonce 和 S256 verifier，并与原浏览器会话绑定。回调先一次性消费原 state，再由 `openid-client.authorizationCodeGrant` 校验 issuer、PKCE、nonce 和必须存在的 ID Token。显式开启 `enableNonRepudiationChecks`，使用发现的固定 JWKS 校验 RS256 签名，再用 `fetchUserInfo` 强制验证相同 `sub`。

成功后轮换本地会话 ID，回调 303 到 `/`，清除地址栏中的 code。浏览器只取得已验证身份的最小展示字段，不取得 access/refresh/ID token、secret 或 verifier。页面不使用浏览器存储保存认证材料。

refresh 在单个本地会话内串行。新的 refresh token 必须轮换；返回 ID Token 时必须保留原 `sub` 与 `sid`，没有返回时保留已验证来源。权限只能保持或缩小。网络失败或 `invalid_grant` 会结束本地认证状态，不自动重耗原 refresh token。用户应重新发起登录。

`/api/userinfo` 每次做当前在线验证，`/api/session` 至多每 60 秒做在线验证。后续业务请求应在自己的资源服务验证正确的 Access Token audience/scope；ID Token 不能用于调用业务 API。

## 登出能力与扩展

标准撤销按钮使用 **RFC 7009**：先关闭本地原 `sid/sub` 来源，再撤销 refresh family 和 access token。成功返回 `LOCAL_SESSION_CLOSED_AND_TOKENS_REVOKED`。即使上游失败，本地也保持未认证；原 Cookie 仅保留匿名 CSRF 会话，不重新附加旧令牌。

当前认证中心没有声明标准 RP-Initiated Logout 的 `end_session_endpoint`。样例不会构造或伪称该能力。Discovery 中的 `rp_logout_command_endpoint` 是明确标注的运营方扩展，页面仅在实际声明时显示：

- `CURRENT_APP` 只失效原 grant，不退出同账号其他应用，保留用户同意。
- `GLOBAL` 结束此账号在认证中心的全部原 SSO 和 USER grant，包括离线 family，保留同意。
- 每次命令保留原 operation、token、sid、sub 和 scope。未知结果先查询**同一 operation**；只有明确 `404 / NOT_FOUND` 才按同号重发。不能改 operation 避免冲突。等待结果时本地已关闭，不允许新登录覆盖待确认操作。

通知接收严格验证固定 issuer、当前 JWKS、RS256、`typ=logout+jwt`、准确字符串 aud、sid/sub、UUIDv7 jti、120 秒期限、准确 events，拒绝 nonce 和未知 claims／header。相同 jti 返回 `409 BACKCHANNEL_REPLAY`。有效但未知 sid 的通知写入有界 tombstone；迟到的 callback 或 refresh 结果不能复活原来源。当前认证中心产生 64 位 hex sid，但本标准客户端按 1–256 字节 ASCII graphic 不透明字符串保存和比较，不假设 UUID 或 hex 结构；它独立于内部 session ID，不能拿来认证。

来源或重放事实达到容量上限时，已验证的原来源会先关闭其全部本地会话并推进 generation，再返回明确 `503`；接收方不会伪报 ACK，未过期事实不会被驱逐。来源事实无法写入时，一个有截止的 overflow 标记会阻止新的 code 结果挂载，覆盖尚未取得 sid 的等待中回调；已有无关来源的读取和保持原来源的刷新不因此被无差别清除。该截止为最后一次来源容量失败加 `state TTL + session TTL + 120 秒`，不新增无界记录或扩大容量。原登出 operation 可继续查询；本地关闭及截止／generation 校验不会因结果恢复而回退。

通知失败不撤销已经完成的本地失效。没有登记 BACK_CHANNEL 的接入方继续遵守最多 5 分钟本地会话、敏感动作每次或最多 60 秒在线检查的降级合同；第三方页面是否即时刷新并无保证。

## HTTP 接口

除回调和签名通知外，敏感 POST 要求准确单一 `Origin: <RP_ORIGIN>`、已有会话、`Content-Type: application/json` 和 `X-CSRF-Token`。拒绝跨来源、重复 Cookie／回调参数、未知字段和动态上游目标。所有响应禁止缓存。

| 方法与地址 | 输入与输出 |
| --- | --- |
| `GET /health` | 启动成功后的固定 ready 状态 |
| `GET /api/session` | 匿名／认证状态、CSRF、最小身份、本地截止与待确认登出状态 |
| `POST /auth/login` | `{}` 或 `{ "prompt": "login" / "consent" }`；返回 authorizationUrl |
| `GET /auth/callback` | 标准 code/state/iss 或 OAuth 错误；成功 303 `/` |
| `GET /api/userinfo` | 当前公开 UserInfo 校验后的 issuer/subject/displayName |
| `POST /auth/refresh` | `{}`；轮换授权，本地截止不延长 |
| `POST /auth/revoke` | `{}`；RFC 7009 与本地关闭 |
| `POST /auth/logout` | `{ "scope": "CURRENT_APP" / "GLOBAL" }`；明确的 RP 命令扩展 |
| `POST /auth/logout/recover` | `{}`；恢复原待确认操作 |
| `POST /auth/backchannel-logout` | form 中唯一 logout_token；不以 Cookie 授权 |
| `POST /api/account/link` | 始终拒绝自动关联，返回 `EXPLICIT_DUAL_CONTROL_LINK_REQUIRED` |

固定错误码不会转发上游错误正文。`OIDC_REQUEST_REJECTED` 包含库拒绝的 state/nonce/issuer/PKCE/签名、过期／撤销授权等情况；客户端应结束原流程并重新登录。`CSRF_REJECTED` 需要重新获取本地会话。`OPERATION_PENDING` 和 `LOGOUT_RESULT_UNKNOWN` 要求查询原操作，不能新建重复写入。`SOURCE_REVOKED`、`SOURCE_CHANGED` 或 `SESSION_CLOSED` 不能通过 refresh 恢复旧来源。日志只输出固定启动／CLI结果，不写请求 URL、回调查询、令牌、Cookie 或密码。

## 已有账号关联

第三方应用应以**验证过的 `(issuer, sub)` 二元组**作为外部身份键。相同 sub 在另一个 issuer 下是不同身份；不同应用／环境的 pairwise sub 也不能用于推断同一人。`email`、显示名、头像和内部 UUID 均不能成为自动合并依据。

本例不提供本地密码、既有业务账号或自动关联入口；关联接口明确拒绝。实际应用若增加关联，必须在一个有界操作中分别取得：

1. 用户对**当前已有本地账号**的近期重新认证及 CSRF 绑定证明。
2. 新发起的完整 OIDC code+state+nonce+PKCE 流程，证明用户控制待关联的外部身份。
3. 用户明确确认后，以唯一 `(issuer, sub)` 约束和同一 operation 原子写入关联；已关联到他人、过期证明或不确定结果都不能自动另建关联。

既有账号的邮箱恰好相同仍需这两个独立证明。账号来源由运营方受控创建或可信邀请；本例不提供公开自助注册、按邮箱恢复或自动创建平台成员／业务权限。

## 机器调用

机器授权与 USER 登录使用两组不同的部署配置。通过明确批准的 MACHINE/SERVICE 客户端，以 Discovery + `clientCredentialsGrant` 获得资源限定 opaque token，不请求 `openid`、profile、人员离线身份或 refresh token。

```sh
node --env-file=/run/config/machine.env machine.mjs
```

配置 `MACHINE_ISSUER`、`MACHINE_CLIENT_ID`、`MACHINE_CLIENT_SECRET_FILE` 和已批准的 `MACHINE_SCOPE`。可选 `MACHINE_RESOURCE_URL` 是部署固定的 HTTPS 资源地址；CLI 不接受浏览器 URL，也不跟随跳转。成功只打印 scope、expiresIn、状态及可选 HTTP 状态，不打印令牌或资源正文。机器 token 不能作为人员在 UserInfo 登录；是否允许访问某个业务租户仍由资源服务的独立范围政策决定。

## 验证及证据边界

```sh
npm run check
npm test
npm audit --omit=dev
```

Node 测试使用临时真实 HTTPS OP 与 RP 监听、动态 RSA 签名和准确 CA／hostname 校验。Windows 的证书生成使用已有 WSL 中的 OpenSSL/Python；Linux 使用本机工具。生成程序从 stdin 接收脚本以避免跨 shell 参数再解释，临时目录由退出 trap 定向删除。应用会话、HTTPS listener、机器 CLI 子进程和临时私有文件在 finally 中关闭／删除，不创建容器或数据库。

测试覆盖标准库的 state/nonce/issuer/S256/ID Token 必须存在与签名校验、UserInfo 一致性、CSRF、真实轮换并发、无 ID Token 的 refresh、来源改变／本地截止、RFC7009、原 operation 恢复、签名通知、重放及 callback/refresh 竞态。这个本地 OP 证据不代替当前真实认证中心互操作；实际新库、独立批准客户端、纯账号与机器资源矩阵由 Phase 21 总验收单独记录。本示例通过标准库测试也不意味着认证中心已获 OpenID 官方认证。
