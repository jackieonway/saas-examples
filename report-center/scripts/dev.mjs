import { build, preview } from 'vite'

// Serve the same classic UMD delivery as production, including during development.
// The browser reloads explicitly; no ESM/HMR client is injected into qiankun.
const watcher = await build({ build: { watch: {} } })
await new Promise((resolve, reject) => watcher.on('event', event => {
  if (event.code === 'ERROR') reject(event.error)
  if (event.code === 'END') resolve()
}))
const server = await preview()
server.printUrls()
const close = async () => { await watcher.close(); server.httpServer.close(); process.exit(0) }
process.once('SIGINT', close)
process.once('SIGTERM', close)
