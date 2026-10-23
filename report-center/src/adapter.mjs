import { SDK_VERSION, authorizationContextSignature } from '../vendor/micro-sdk/index.mjs'

/** qiankun owns its props; the platform contract stays nested and intact. */
export function createQiankunAdapter(view, selector = '#report-center-root') {
  let root = null
  let active = false
  let currentContext = null
  let signal = null
  let abort = null
  let expiryTimer = null
  let generation = 0
  let cleanup = Promise.resolve()
  const releaseLease = () => {
    generation += 1
    if (expiryTimer !== null) clearTimeout(expiryTimer)
    expiryTimer = null
    if (signal && abort) signal.removeEventListener('abort', abort)
    signal = null
    abort = null
  }
  const revoke = () => {
    releaseLease()
    active = false
    currentContext = null
    cleanup = Promise.resolve(view.dispose())
    return cleanup
  }
  const watch = context => {
    releaseLease()
    const lease = generation
    signal = context.signal
    abort = () => { if (lease === generation) void revoke().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    const expires = Math.min(Date.parse(context.expiresAt), Date.parse(context.tokenExpiresAt))
    expiryTimer = setTimeout(abort, Math.min(expires - Date.now(), 2 ** 31 - 1))
    if (signal.aborted) abort()
    return lease
  }
  const platform = props => {
    const value = props?.platform
    if (!value || value.appCode !== 'report-center' || value.contractVersion !== '2.0' ||
        value.sdkVersion !== SDK_VERSION ||
        typeof value.token !== 'string' || !value.token || typeof value.contextVersion !== 'string' || !value.contextVersion ||
        typeof value.basePath !== 'string' || !value.basePath || typeof value.routePath !== 'string' ||
        !['light', 'dark'].includes(value.theme) ||
        !Number.isSafeInteger(value.contextEpoch) || value.contextEpoch < 1 ||
        !value.signal || typeof value.signal.addEventListener !== 'function' || value.signal.aborted ||
        !value.user?.id || !value.tenant?.id || !value.organization?.id ||
        !Array.isArray(value.roles) || !Array.isArray(value.permissions) || !Array.isArray(value.dataGrants) ||
        !Array.isArray(value.menus) || typeof value.onNavigate !== 'function' || typeof value.onNotify !== 'function' ||
        authorizationContextSignature(value) === null ||
        Date.parse(value.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.tokenExpiresAt) <= Date.now() || !Number.isFinite(Date.parse(value.tokenExpiresAt))) {
      throw new Error('报表中心需要有效的 props.platform 授权上下文')
    }
    return value
  }
  return {
    async bootstrap() {},
    async mount(props) {
      await revoke()
      root = null
      try {
        const context = platform(props)
        const container = props?.container
        if (!container || typeof container.querySelector !== 'function') throw new Error('报表中心需要 qiankun container')
        const target = container.querySelector(selector)
        if (!target) throw new Error('报表中心挂载节点不存在')
        root = target
        const lease = watch(context)
        await view.render(target, context)
        if (lease !== generation) throw new Error('报表中心授权上下文已失效')
        active = true
        currentContext = context
      } catch (error) {
        await revoke()
        root = null
        throw error
      }
    },
    async update(props) {
      try {
        const context = platform(props)
        if (!root || (currentContext && context.contextEpoch < currentContext.contextEpoch)) return
        await cleanup
        const lease = watch(context)
        if (active) await view.updateContext(context)
        else await view.render(root, context)
        if (lease !== generation) throw new Error('报表中心授权上下文已失效')
        active = true
        currentContext = context
      } catch (error) {
        await revoke()
        throw error
      }
    },
    async unmount() {
      try { await revoke() } finally { root = null }
    },
  }
}
