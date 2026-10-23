import { build, preview } from 'vite';

// qiankun receives the production classic entry during development, without ESM/HMR.
const watcher = await build({ build: { watch: {} } });
await new Promise((resolve, reject) => watcher.on('event', event => {
  if (event.code === 'ERROR') reject(event.error);
  if (event.code === 'END') resolve();
}));
const server = await preview();
server.printUrls();
const close = async () => {
  await watcher.close();
  server.httpServer.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
