import http from 'node:http';
import https from 'node:https';
import { loadConfig } from './src/config.mjs';
import { createApplication } from './src/app.mjs';

let server, application;
try {
  const config = loadConfig(); application = await createApplication(config);
  server = config.tls ? https.createServer(config.tls, application.handler) : http.createServer(application.handler);
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  console.log('OIDC_RP_READY');
  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    application.close(); server.close(() => { process.exitCode = 0; }); server.closeAllConnections();
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch {
  application?.close(); server?.closeAllConnections(); server?.close();
  console.error('OIDC_RP_START_FAILED'); process.exitCode = 1;
}
