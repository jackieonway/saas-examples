import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', windowsHide: true });
  }
}
visit(root); console.log('OIDC_RP_SYNTAX_PASS');
