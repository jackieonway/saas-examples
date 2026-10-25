import {
  authorizationContextSignature,
  createContextClient,
  type ContextClient,
  type MicroProps,
} from '../vendor/micro-app-sdk/3.0.0/index.mjs';

export interface QiankunProps {
  container?: { querySelector(selector: string): Element | null };
  platform: MicroProps;
  services?: unknown;
}

/** The chat is anonymous; platform authorization only controls its mounted lifetime. */
export function createSocketLifecycle(render: (target: HTMLElement) => () => void) {
  let target: HTMLElement | null = null;
  let disposeView: (() => void) | null = null;
  let client: ContextClient | null = null;
  let signal: AbortSignal | null = null;
  let abort: (() => void) | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let authorization: string | null = null;

  function stop() {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
    if (signal && abort) signal.removeEventListener('abort', abort);
    signal = null;
    abort = null;
    client?.dispose();
    client = null;
    authorization = null;
    const dispose = disposeView;
    disposeView = null;
    dispose?.();
  }

  function revoke() {
    stop();
    if (target) {
      target.replaceChildren();
      target.textContent = '应用上下文已失效，请等待平台重新授权。';
      delete target.dataset.theme;
    }
  }

  function context(props: QiankunProps): MicroProps {
    // qiankun-owned fields must never enter the strict SDK DTO.
    const value = props?.platform;
    if (!value || value.appCode !== 'websocket-chat' || value.contractVersion !== '2.0' ||
        !value.basePath || typeof value.routePath !== 'string' || !['light', 'dark'].includes(value.theme) ||
        !Array.isArray(value.roles) || !Array.isArray(value.permissions) || !Array.isArray(value.dataGrants) ||
        !Array.isArray(value.menus) || typeof value.onNavigate !== 'function' || typeof value.onNotify !== 'function' ||
        !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.tokenExpiresAt))) {
      throw new Error('websocket-chat requires a valid props.platform authorization context');
    }
    return value;
  }

  function apply(props: QiankunProps) {
    const value = context(props);
    const nextKey = authorizationContextSignature(value);
    const changed = !client?.current() || nextKey === null || nextKey !== authorization || signal !== value.signal;
    if (changed) {
      stop();
      client = createContextClient(value);
      if (!client.current()) throw new Error('websocket-chat authorization context has expired or been revoked');
      signal = value.signal;
      abort = revoke;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) throw new Error('websocket-chat authorization context has been revoked');
      const expires = Math.min(Date.parse(value.expiresAt), Date.parse(value.tokenExpiresAt));
      expiryTimer = setTimeout(revoke, Math.min(expires - Date.now(), 2 ** 31 - 1));
      authorization = nextKey;
      if (target) disposeView = render(target);
    } else {
      client!.update(value);
    }
    if (target) target.dataset.theme = value.theme;
  }

  return {
    async bootstrap() {},
    async mount(props: QiankunProps) {
      stop();
      target = null;
      try {
        context(props);
        const root = props?.container?.querySelector('#root');
        if (!root || !(root instanceof HTMLElement)) throw new Error('qiankun mount requires #root inside props.container');
        target = root;
        apply(props);
      } catch (error) {
        revoke();
        throw error;
      }
    },
    async update(props: QiankunProps) {
      if (!target) return;
      try { apply(props); } catch (error) { revoke(); throw error; }
    },
    async unmount() {
      stop();
      target?.replaceChildren();
      if (target) delete target.dataset.theme;
      target = null;
    },
  };
}
