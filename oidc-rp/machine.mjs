import * as client from 'openid-client';
import { loadMachineConfig } from './src/config.mjs';
import { discover } from './src/oidc.mjs';
import { secureFetch } from './src/transport.mjs';

try {
  const config = loadMachineConfig(), oidc = await discover(config);
  const tokens = await client.clientCredentialsGrant(oidc.configuration, { scope: config.scope });
  if (typeof tokens.access_token !== 'string' || tokens.id_token || tokens.refresh_token ||
      tokens.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 ||
      (tokens.scope !== undefined && (typeof tokens.scope !== 'string' || tokens.scope.split(' ').some(scope => !config.scope.split(' ').includes(scope))))) throw new Error();
  let resourceStatus;
  if (config.resourceUrl) {
    // The deployment selects this one resource. Caller input cannot redirect it.
    const resource = secureFetch({ origin: config.resourceUrl.origin });
    const response = await resource(config.resourceUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    resourceStatus = response.status;
    if (!response.ok) throw new Error();
  }
  console.log(JSON.stringify({ state: 'MACHINE_TOKEN_OBTAINED', scope: tokens.scope ?? config.scope,
    expiresIn: tokens.expires_in, ...(resourceStatus ? { resourceStatus } : {}) }));
} catch { console.error('MACHINE_REQUEST_REJECTED'); process.exitCode = 1; }
