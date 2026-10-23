/** Independent report view; only the qiankun entry exports its lifecycle. */

import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Layers,
  Moon,
  Palette,
  Share2,
  Sun,
  Zap,
} from "lucide-react"

import { Badge, Button, Skeleton, cn } from "./ui"
import { authorizationContextSignature } from "../vendor/micro-sdk/index.mjs"
import type {
  MicroProps,
  MicroNotifyVariant,
} from "../vendor/micro-sdk/index.mjs"

interface ReportView {
  render(container: HTMLElement, props: MicroProps): void | Promise<void>
  updateContext(props: MicroProps): void | Promise<void>
  dispose(): void | Promise<void>
}

/* ============================ 模块级挂载状态 ============================ */

let root: Root | null = null
let containerEl: HTMLElement | null = null
let latestProps: MicroProps | null = null
let rolesRequest: AbortController | null = null
let teardownTask: Promise<void> | null = null
/** update 推送计数(「未重挂」证据之一) */
let updateCount = 0
let lastUpdateAt = ""
/** 强制重渲染监听(props 模块变量 → React 状态桥) */
let bumpListeners: Array<() => void> = []

function notifyUpdate() {
  for (const fn of bumpListeners) fn()
}

function pad2(n: number) {
  return (n < 10 ? "0" : "") + n
}

function authorizationKey(props: MicroProps) {
  return authorizationContextSignature(props) ?? ""
}

function isCurrentContext(props: MicroProps) {
  return Boolean(
    latestProps && !props.signal.aborted && latestProps.signal === props.signal &&
    authorizationKey(props) !== "" &&
    authorizationKey(latestProps) === authorizationKey(props) &&
    Date.parse(props.expiresAt) > Date.now() &&
    Date.parse(props.tokenExpiresAt) > Date.now(),
  )
}

function cancelRolesRequest() {
  rolesRequest?.abort()
  rolesRequest = null
}

/* ============================ 对外 API 类型 ============================ */

interface ExternalRoleOrg {
  id: string
  name: string
  tenantName: string
  roles: MicroProps["roles"]
}

interface ExternalRolesResp {
  application?: { code: string; name: string }
  organizations?: ExternalRoleOrg[]
}

interface RolesState {
  contextKey: string
  loading: boolean
  fired: boolean
  status: string
  ok: boolean
  message: string
  data: ExternalRolesResp | null
}

function emptyRolesState(contextKey: string): RolesState {
  return { contextKey, loading: false, fired: false, status: "", ok: false, message: "", data: null }
}

/* ============================ 子应用根组件 ============================ */

function ReportApp() {
  const props = latestProps
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  const [seconds, setSeconds] = React.useState(0)
  const [clicks, setClicks] = React.useState(0)
  const [rolesState, setRolesState] = React.useState<RolesState>(() => emptyRolesState(""))
  const contextKey = props ? authorizationKey(props) : ""

  // props 模块变量 → React 状态桥: update() 时强制重渲染
  React.useEffect(() => {
    bumpListeners.push(force)
    return () => {
      cancelRolesRequest()
      bumpListeners = bumpListeners.filter((fn) => fn !== force)
    }
  }, [force])

  // 挂载时钟(不重挂证据: update 推送不重置)
  React.useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  // 同一 React 根保留演示计时器；授权上下文或令牌替换时清除旧业务结果。
  React.useEffect(() => {
    setRolesState(emptyRolesState(contextKey))
  }, [contextKey])

  if (!props) return null

  const isSharedView = props.routePath === `${props.basePath}/shared`
  const theme = props.theme
  // 先按 key 屏蔽旧结果，避免 effect 清理前的一帧暴露旧组织数据。
  const currentRolesState = rolesState.contextKey === contextKey
    ? rolesState
    : emptyRolesState(contextKey)

  const loadRoles = async () => {
    if (!isCurrentContext(props)) return
    cancelRolesRequest()
    const controller = new AbortController()
    rolesRequest = controller
    const abort = () => controller.abort()
    props.signal.addEventListener("abort", abort, { once: true })
    const canApply = () => !controller.signal.aborted && rolesRequest === controller && isCurrentContext(props)
    setRolesState({ ...emptyRolesState(contextKey), loading: true, fired: true })
    try {
      const res = await fetch("/api/external/roles", {
        credentials: "omit",
        headers: { Authorization: `Bearer ${props.token}` },
        signal: controller.signal,
      })
      const body = (await res.json().catch(() => ({}))) as ExternalRolesResp & { message?: string }
      if (!canApply()) return
      setRolesState({
        contextKey,
        loading: false,
        fired: true,
        status: String(res.status),
        ok: res.ok,
        message: body.message ?? "",
        data: res.ok ? body : null,
      })
    } catch (e) {
      if (!canApply()) return
      setRolesState({
        contextKey,
        loading: false,
        fired: true,
        status: "—",
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        data: null,
      })
    } finally {
      props.signal.removeEventListener("abort", abort)
      if (rolesRequest === controller) rolesRequest = null
    }
  }

  const sendNotify = (variant: MicroNotifyVariant) => {
    if (isCurrentContext(props)) props.onNotify(`来自报表中心的消息 (${variant})`, variant)
  }

  return (
    <div className="saas-report-center" data-theme={theme}>
    <div className="space-y-4 p-4 sm:p-6">
      {/* ---------- 子应用头部 ---------- */}
      <header className="flex flex-wrap items-center gap-2 border-b pb-3">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <Zap className="size-3" />
          qiankun · 独立报表中心
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <Share2 className="size-3" />
          React {React.version} · 独立运行时
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          routePath: <code className="rounded bg-muted px-1.5 py-px">{props.routePath}</code>
        </span>
      </header>

      {isSharedView ? (
        <SharedRuntimeView
          props={props}
          theme={theme}
          clicks={clicks}
          onCounter={() => setClicks((c) => c + 1)}
          onNotify={sendNotify}
          seconds={seconds}
          updateCount={updateCount}
          lastUpdateAt={lastUpdateAt}
        />
      ) : (
        <OverviewView
          props={props}
          theme={theme}
          seconds={seconds}
          updateCount={updateCount}
          lastUpdateAt={lastUpdateAt}
          rolesState={currentRolesState}
          onLoadRoles={loadRoles}
          onNotify={sendNotify}
        />
      )}
    </div>
    </div>
  )
}

/* ============================ 视图: 数据总览 ============================ */

function OverviewView({
  props,
  theme,
  seconds,
  updateCount,
  lastUpdateAt,
  rolesState,
  onLoadRoles,
  onNotify,
}: {
  props: MicroProps
  theme: string
  seconds: number
  updateCount: number
  lastUpdateAt: string
  rolesState: RolesState
  onLoadRoles: () => void
  onNotify: (v: MicroNotifyVariant) => void
}) {
  const orgs = rolesState.data?.organizations ?? []
  const totalRoles = orgs.reduce((acc, o) => acc + o.roles.length, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ① 主应用注入的 props */}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-primary" />
          ① 主应用注入的 props
        </h3>
        <dl className="grid gap-2 text-xs">
          <Kv k="user.username" v={props.user.username} />
          <Kv k="user.displayName" v={props.user.displayName} />
          <Kv k="tenant" v={`${props.tenant.name} (${props.tenant.code})`} />
          <Kv k="organization" v={props.organization.name} />
          <Kv k="appCode" v={props.appCode} />
          <Kv k="basePath" v={props.basePath} />
          <Kv k="routePath" v={props.routePath} mono />
          <Kv k="theme" v={theme} />
          <Kv k="contractVersion" v={props.contractVersion} />
          <Kv k="contextVersion" v={props.contextVersion} mono />
          <Kv k="contextEpoch" v={String(props.contextEpoch)} />
          <Kv k="token" v="应用专用令牌已注入" />
          <Kv k="tokenExpiresAt" v={props.tokenExpiresAt} />
          <Kv k="expiresAt" v={props.expiresAt} />
          <Kv k="menus" v={`注入 ${props.menus.length} 项`} />
          <Kv k="permissions" v={props.permissions.join(", ") || "无操作权限"} />
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          宿主同时注入应用上下文和最多 5 分钟有效的应用令牌。角色控制菜单和操作，
          数据范围由独立的成员关系授权决定；业务后端须再次校验两类授权。
        </p>
      </section>

      {/* ② 增量更新指标(未重挂证据) */}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-primary" />
          ② 运行时同步 · 无需重新部署
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <p className="font-mono text-xl font-semibold tabular-nums leading-none">{seconds}s</p>
            <p className="mt-1.5 text-[10px] text-muted-foreground">挂载时钟(不重置)</p>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <p className="font-mono text-xl font-semibold tabular-nums leading-none">×{updateCount}</p>
            <p className="mt-1.5 text-[10px] text-muted-foreground">上下文与页面同步次数</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {updateCount > 0 && `最近一次同步 ${lastUpdateAt}。`}
          授权上下文最长有效 30 秒，宿主约每 20 秒重新核对；路径或主题变化也会同步。计数增加不代表上传新版本、重新下载代码或重挂页面。
        </p>
      </section>

      {/* ③ 当前用户授权与对外 API 演示 */}
      <section className="rounded-lg border bg-card p-4 lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="size-4 text-primary" />
            ③ 当前用户角色 · GET /api/external/roles
          </h3>
          <Button size="sm" variant="outline" onClick={onLoadRoles} disabled={rolesState.loading}>
            {rolesState.loading ? "请求中…" : "请求当前用户角色"}
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {props.roles.map((role) => (
            <Badge key={role.id} variant="secondary">{role.name} · {role.code}</Badge>
          ))}
          {props.roles.length === 0 && <span className="text-xs text-muted-foreground">当前组织没有可用角色</span>}
        </div>
        <p className="mb-2 text-xs font-medium">独立数据授权</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {props.dataGrants.map((grant, index) => (
            <Badge key={`${grant.resource}:${grant.action}:${grant.scope}:${index}`} variant="outline">
              {grant.resource}:{grant.action} · {grant.scope}
            </Badge>
          ))}
          {props.dataGrants.length === 0 && <span className="text-xs text-muted-foreground">未授予业务数据访问范围</span>}
        </div>
        {rolesState.fired && (
          <p className="mb-3 text-xs text-muted-foreground">
            HTTP{" "}
            <b className={rolesState.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              {rolesState.status}
            </b>
            {rolesState.ok && rolesState.data?.application && ` · 应用「${rolesState.data.application.name}」`}
            {rolesState.ok && ` · 当前组织 / ${totalRoles} 个有效角色`}
          </p>
        )}
        {rolesState.loading && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-4/6" />
          </div>
        )}
        {rolesState.fired && !rolesState.loading && !rolesState.ok && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {rolesState.message || "请求失败"}
          </p>
        )}
        {rolesState.ok && !rolesState.loading && (
          <div className="space-y-3">
            {orgs.map((org) => (
              <div key={org.id}>
                <div className="mb-1 flex items-baseline gap-2 text-xs">
                  <span className="font-semibold">{org.name}</span>
                  <span className="text-muted-foreground">· {org.tenantName}</span>
                  <span className="ml-auto font-mono text-muted-foreground">{org.roles.length} 角色</span>
                </div>
                {org.roles.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {org.roles.map((role) => (
                      <Badge key={role.id} variant="secondary" className="gap-1 text-[10px] font-normal">
                        {role.name}
                        <span className="text-muted-foreground">{role.code}</span>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              接口只返回当前用户在当前组织的有效角色，包含继承的祖先组织角色。
            </p>
          </div>
        )}
        {!rolesState.fired && !rolesState.loading && (
          <p className="text-xs text-muted-foreground">
            上方直接展示宿主注入的当前用户上下文。点击按钮可使用 props.token 调用对外 API；
            上下文切换会取消请求并丢弃迟到响应。
          </p>
        )}
      </section>
    </div>
  )
}

/* ============================ 视图: 独立运行时与平台通信 ============================ */

function SharedRuntimeView({
  props,
  theme,
  clicks,
  onCounter,
  onNotify,
  seconds,
  updateCount,
  lastUpdateAt,
}: {
  props: MicroProps
  theme: string
  clicks: number
  onCounter: () => void
  onNotify: (v: MicroNotifyVariant) => void
  seconds: number
  updateCount: number
  lastUpdateAt: string
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ① 应用自带组件与运行时 */}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Share2 className="size-4 text-primary" />
          ① 独立构建的组件与 React
        </h3>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          本页按钮、徽章和骨架屏由报表应用自行构建，包含独立的 React {React.version}。
          平台通过标准生命周期传入授权上下文，无需引用宿主源码或共享模块单例。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onCounter}>
            应用按钮 · 点击 {clicks} 次
          </Button>
          <Badge>Badge 组件</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          组件状态(count={clicks})存活于子应用根。路由、主题和授权上下文更新复用当前根，
          切换本应用页面不会重新创建 React 实例；卸载会清理计时器和未完成请求。
        </p>
      </section>

      {/* ② 主题级联 */}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Palette className="size-4 text-primary" />
          ② 应用内主题同步
        </h3>
        <div className="mb-3 flex items-center gap-2 text-sm">
          {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          <span className="font-medium">当前主题: {theme}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { name: "background", cls: "bg-background" },
            { name: "card", cls: "bg-card" },
            { name: "primary", cls: "bg-primary" },
            { name: "muted", cls: "bg-muted" },
          ].map((sw) => (
            <div key={sw.name} className="space-y-1">
              <div className={cn("h-10 rounded-md border", sw.cls)} />
              <p className="text-center font-mono text-[9px] text-muted-foreground">{sw.name}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          平台通过 props.platform.theme 增量同步主题。颜色变量和样式限定在报表根节点内，
          应用不会修改主页面的 html、body 或全局主题。切换平台主题后，色板和文案即时跟随。
        </p>
      </section>

      {/* ③ 通信与导航 */}
      <section className="rounded-lg border bg-card p-4 lg:col-span-2">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Boxes className="size-4 text-primary" />
          ③ 与主应用通信与导航
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" onClick={() => onNotify("success")}>
            props.onNotify · success
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNotify("info")}>
            props.onNotify · info
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          通知和页面跳转统一通过 props.platform 中的平台回调完成。
          应用不直接导入宿主的消息组件，也不保存平台会话；业务请求只携带应用专用令牌。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => props.onNavigate(props.basePath)}>
            onNavigate → 数据总览
            <ArrowUpRight className="size-3.5" />
          </Button>
          <span className="font-mono">
            挂载时钟 {seconds}s · 运行时同步 ×{updateCount}
            {updateCount > 0 && ` · 最近 ${lastUpdateAt}`}
          </span>
        </div>
      </section>
    </div>
  )
}

/* ============================ 小组件 ============================ */

function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-32 shrink-0 font-mono text-[11px] text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 break-all font-medium", mono && "font-mono text-[11px]")}>{v}</dd>
    </div>
  )
}

/* ============================ 生命周期契约 ============================ */

function teardown(): Promise<void> {
  if (teardownTask) return teardownTask
  const retiringRoot = root
  const retiringContainer = containerEl
  cancelRolesRequest()
  root = null
  containerEl = null
  latestProps = null
  bumpListeners = []
  updateCount = 0
  // 在宿主 React commit 后卸载另一棵根；Promise 完成前禁止下一次 mount。
  const task = Promise.resolve().then(() => {
    retiringRoot?.unmount()
    if (retiringContainer) retiringContainer.replaceChildren()
  }).finally(() => {
    if (teardownTask === task) teardownTask = null
  })
  teardownTask = task
  return task
}

export const reportView: ReportView = {

  async render(container: HTMLElement, props: MicroProps) {
    if (teardownTask) await teardownTask
    if (root) await teardown()
    if (!container) throw new Error("mount 需要一个 container HTMLElement")
    if (props.signal.aborted) throw new Error("应用上下文已失效")
    latestProps = props
    updateCount = 0
    lastUpdateAt = ""
    containerEl = container
    container.replaceChildren()
    root = createRoot(container)
    root.render(<ReportApp />)
  },

  updateContext(props: MicroProps) {
    if (!root || !latestProps || props.signal.aborted) return
    if (props.contextEpoch < latestProps.contextEpoch) return
    if (authorizationKey(props) !== authorizationKey(latestProps)) cancelRolesRequest()
    latestProps = props
    updateCount += 1
    const d = new Date()
    lastUpdateAt = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    notifyUpdate()
  },

  dispose: teardown,
}

