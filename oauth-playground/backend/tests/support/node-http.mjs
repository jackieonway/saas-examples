// Test-only HTTP transport. Rust supplies every status, header and response byte.
import http from 'node:http'
import readline from 'node:readline'

const pending = new Map()
let next = 0
const server = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const id = ++next
  pending.set(id, response)
  response.once('close', () => pending.delete(id))
  process.stdout.write(JSON.stringify({ id, method: request.method, url: request.url,
    headers: request.rawHeaders, body: Buffer.concat(chunks).toString('base64') }) + '\n')
})
const input = readline.createInterface({ input: process.stdin })
input.on('line', line => {
  const reply = JSON.parse(line)
  const response = pending.get(reply.id)
  pending.delete(reply.id)
  if (!response) return
  response.writeHead(reply.status, reply.headers.flat())
  response.end(Buffer.from(reply.body, 'base64'))
})
input.once('close', () => { server.closeAllConnections(); server.close(); process.exit(0) })
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}` }) + '\n')
})
