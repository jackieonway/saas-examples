import { build, preview } from 'vite'
const watcher = await build({ build: { watch: {} } })
await new Promise((resolve, reject) => watcher.on('event', event => {
  if (event.code === 'ERROR') reject(event.error)
  if (event.code === 'END') resolve()
}))
const server = await preview()
server.printUrls()
const stop = async () => { await watcher.close(); server.httpServer.close(); process.exit(0) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
