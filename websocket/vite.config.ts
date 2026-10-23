import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { parseChatEndpoint } from './src/chat-config.ts';
import { buildProvenance } from '../scripts/build-provenance.mjs';

// Expose this single public value; never copy the process environment or load local secrets.
const endpoint = parseChatEndpoint(process.env.VITE_CHAT_ENDPOINT);

export default defineConfig({
  base: './',
  appType: 'mpa',
  publicDir: 'public',
  envDir: false,
  envPrefix: [],
  define: {
    'import.meta.env.VITE_CHAT_ENDPOINT': JSON.stringify(endpoint ?? ''),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [buildProvenance('websocket', { publicConfig: { chatEndpoint: endpoint } }), {
    name: 'static-demo-boundary',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try {
          pathname = posix.normalize(decodeURIComponent((request.url ?? '').split('?', 1)[0]));
        } catch {
          response.statusCode = 404;
          response.end();
          return;
        }
        if (pathname.endsWith('/server.ts') || pathname === '/backend' || pathname.startsWith('/backend/') || /(?:^|\/)\.env(?:\.|$)/.test(pathname)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        next();
      });
    },
  }],
  server: {
    host: '127.0.0.1', port: 3007, strictPort: true, cors: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/server.ts', '**/backend/**'] },
  },
  preview: { host: '127.0.0.1', port: 3007, strictPort: true, cors: true },
  build: {
    outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/main.tsx', import.meta.url)),
      name: 'websocket-chat', formats: ['umd'], fileName: () => 'assets/websocket-chat.umd.js',
      cssFileName: 'assets/websocket-chat',
    },
  },
});
