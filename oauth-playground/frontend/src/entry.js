import './style.css'
import { createApplication } from './app.js'
import { apiRequest, flowApiPath } from './api.js'
import { createContextClient, authorizationContextSignature } from '../vendor/micro-sdk/index.mjs'

/** @typedef {import('../vendor/micro-sdk/index.mjs').PlatformServices & { oauthApiBase?: string }} OAuthServices */

let active
let target
const now = () => Date.now()
function readPlatform(props) {
  const value = props?.platform
  if (!value || value.appCode !== 'oauth-playground' || typeof value.basePath !== 'string' ||
      typeof value.routePath !== 'string' || typeof value.onNavigate !== 'function' || typeof value.onNotify !== 'function' ||
      !['light', 'dark'].includes(value.theme) || !Array.isArray(value.menus) || !Array.isArray(value.roles) ||
      !Array.isArray(value.permissions) || !Array.isArray(value.dataGrants) || value.signal?.aborted ||
      !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now() ||
      !Number.isFinite(Date.parse(value.tokenExpiresAt)) || Date.parse(value.tokenExpiresAt) <= now()) {
    throw new Error('OAuth 演练需要有效的 props.platform 授权上下文')
  }
  return value
}

export async function bootstrap() {}
export async function mount(props) {
  await unmount()
  target = null
  try {
    const platform = readPlatform(props)
    if (!props.container?.querySelector) throw new Error('OAuth 演练需要 qiankun container')
    const root = props.container.querySelector('#oauth-playground-root')
    if (!root) throw new Error('OAuth 演练挂载节点不存在')
    const apiBase = props.services?.oauthApiBase || '/oauth-playground-api'
    flowApiPath('/api/config', apiBase)
    target = root
    const client = createContextClient(platform)
    const current = { root, client, platform, apiBase, scope: new AbortController(), application: null,
      authorizationKey: authorizationContextSignature(platform), unbind: null }
    const request = async (path, body, signal) => {
      if (active !== current || !client.current()) throw new DOMException('Context expired', 'AbortError')
      const scope = current.scope
      const result = await apiRequest(path, body, AbortSignal.any([scope.signal, current.platform.signal, ...(signal ? [signal] : [])]), { apiBase })
      if (active !== current || scope !== current.scope || scope.signal.aborted || !client.current()) throw new DOMException('Context changed', 'AbortError')
      return result
    }
    active = current
    root.classList.add('oauth-playground')
    root.dataset.theme = platform.theme
    current.application = createApplication(root, request, platform)
    bindLease(current)
    await current.application.ready
  } catch (error) { await unmount(); target = null; throw error }
}

function bindLease(current) {
  current.unbind?.()
  const signal = current.platform.signal
  const abort = () => { if (active === current) void revoke() }
  signal.addEventListener('abort', abort, { once: true })
  const expires = Math.min(Date.parse(current.platform.expiresAt), Date.parse(current.platform.tokenExpiresAt))
  const timer = setTimeout(abort, Math.min(expires - now(), 2 ** 31 - 1))
  current.unbind = () => { signal.removeEventListener('abort', abort); clearTimeout(timer) }
  if (signal.aborted) abort()
}

export async function update(props) {
  try {
    const platform = readPlatform(props)
    if (!active) {
      const root = target
      if (root) await mount({ ...props, container: { querySelector: selector => selector === '#oauth-playground-root' ? root : null } })
      return
    }
    if (platform.contextEpoch < active.platform.contextEpoch) return
    const current = active
    const apiBase = props.services?.oauthApiBase || '/oauth-playground-api'
    if (apiBase !== current.apiBase) throw new Error('OAuth API prefix changes require remounting')
    const key = authorizationContextSignature(platform)
    const changed = key === null || key !== current.authorizationKey || platform.signal !== current.platform.signal
    current.client.update(platform)
    if (changed) { current.scope.abort(); current.scope = new AbortController() }
    current.authorizationKey = key
    current.platform = platform
    bindLease(current)
    current.application.update(platform, changed)
  } catch (error) { await revoke(); throw error }
}

async function revoke() {
  const current = active
  if (!current) return
  active = undefined
  current.unbind?.()
  current.scope.abort()
  current.client.dispose()
  current.application.dispose()
  current.root.classList.remove('oauth-playground')
  delete current.root.dataset.theme
}

export async function unmount() {
  await revoke()
  target = null
}
