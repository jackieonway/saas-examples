import { apiRequest, explainError } from './api.js'

// A dedicated callback utility does not mount the micro application or exchange
// credentials automatically. Clear the URL before reading config or networking.
const params = new URLSearchParams(location.search)
let callback = { state: params.get('state') || '', ...(params.has('code') ? { code: params.get('code') } : {}),
  ...(params.has('error') ? { error: params.get('error') } : {}) }
history.replaceState(null, '', location.pathname)
const root = document.querySelector('#oauth-callback-root')
if (root) {
  const controller = new AbortController()
  const button = root.querySelector('[data-testid="complete-callback"]')
  const output = root.querySelector('[data-testid="callback-result"]')
  const stop = () => { controller.abort(); callback = undefined; button.disabled = true }
  window.addEventListener('pagehide', stop, { once: true })
  button.addEventListener('click', async () => {
    if (!callback || controller.signal.aborted) return
    const input = callback
    callback = undefined
    button.disabled = true
    try {
      const response = await apiRequest('/api/callback', input, controller.signal, { apiBase: '/oauth-playground-api' })
      if (controller.signal.aborted) return
      output.textContent = response.ok ? JSON.stringify(response.data, null, 2) : explainError(response.data?.error)
    } catch { if (!controller.signal.aborted) output.textContent = '回调验证未完成。请核对会话状态后从平台重新发起授权。' }
  })
}
