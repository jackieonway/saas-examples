import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, build } from 'vite'
import prefixSelector from 'postcss-prefix-selector'
import { buildProvenance } from '../../scripts/build-provenance.mjs'

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, root, '')
  const target = process.env.OAUTH_PLAYGROUND_API_TARGET || env.OAUTH_PLAYGROUND_API_TARGET || 'http://127.0.0.1:3011'
  const port = Number(process.env.OAUTH_PLAYGROUND_FRONTEND_PORT || env.OAUTH_PLAYGROUND_FRONTEND_PORT || 3010)
  const stripPlatformCredentials = proxy => proxy.on('proxyReq', request => {
    request.removeHeader('authorization')
    const cookies = String(request.getHeader('cookie') || '').split(';').map(value => value.trim())
      .filter(value => /^(?:__Host-oauth_playground|oauth_playground)=/.test(value))
    if (cookies.length) request.setHeader('cookie', cookies.join('; '))
    else request.removeHeader('cookie')
  })
  const proxy = {
    '^/oauth-playground-api(?:/|$)': { target, changeOrigin: false,
      rewrite: value => value.replace(/^\/oauth-playground-api(?=\/|$)/, '/api'), configure: stripPlatformCredentials },
    '^/api(?:/|$)': { target, changeOrigin: false, configure: stripPlatformCredentials },
    '^/health(?:/|$)': { target, changeOrigin: false, configure: stripPlatformCredentials },
  }
  const aliases = server => { server.middlewares.use((request, _response, next) => {
    if (request.url?.startsWith('/sub/oauth-playground/')) request.url = request.url.slice('/sub/oauth-playground'.length)
    if (request.url?.split('?')[0] === '/callback') request.url = request.url.replace('/callback', '/callback.html')
    next()
  }) }

  return {
    root,
    base: './',
    appType: 'mpa',
    // Public configuration is fetched at runtime. No environment variables are
    // embedded into browser assets, including variables prefixed with VITE_.
    envPrefix: 'OAUTH_PLAYGROUND_PUBLIC_UNUSED_',
    css: { postcss: { plugins: [prefixSelector({ prefix: '.oauth-playground', transform(prefix, selector, prefixed) {
      if (selector.includes('.oauth-playground')) return selector
      if (selector === ':root' || selector === 'body') return prefix
      return prefixed
    } })] } },
    plugins: [buildProvenance('oauth-playground/frontend'), {
      name: 'oauth-classic-callback', configureServer: aliases, configurePreviewServer: aliases,
      buildStart() { this.addWatchFile(fileURLToPath(new URL('src/callback.js', import.meta.url))) },
      async generateBundle() {
        const result = await build({ configFile: false, root, publicDir: false, logLevel: 'silent',
          build: { write: false, target: 'es2022', lib: { entry: fileURLToPath(new URL('src/callback.js', import.meta.url)),
            name: 'OAuthCallback', formats: ['iife'], fileName: () => 'callback.js' } } })
        for (const output of (Array.isArray(result) ? result : [result])) for (const file of output.output) {
          if (file.type === 'chunk') this.emitFile({ type: 'asset', fileName: 'assets/callback.js', source: file.code })
        }
      },
    }],
    server: { host: '127.0.0.1', port, strictPort: true, proxy, cors: true },
    preview: { host: '127.0.0.1', port, strictPort: true, proxy, cors: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      lib: { entry: fileURLToPath(new URL('src/entry.js', import.meta.url)), name: 'oauth-playground',
        formats: ['umd'], fileName: () => 'assets/oauth-playground.umd.js', cssFileName: 'assets/oauth-playground' },
    },
  }
})
