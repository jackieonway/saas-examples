import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import SocketDemo from '../frontend';
import { createSocketLifecycle } from './qiankun-lifecycle.ts';
import './styles.css';

function renderChat(target: HTMLElement) {
  const root = createRoot(target);
  flushSync(() => root.render(<SocketDemo />));
  // Dispose the socket before another authorization context mounts.
  return () => flushSync(() => root.unmount());
}

export const { bootstrap, mount, update, unmount } = createSocketLifecycle(renderChat);

// Standalone development never invents platform credentials or connects automatically.
if (!(window as Window & { __POWERED_BY_QIANKUN__?: boolean }).__POWERED_BY_QIANKUN__) {
  const target = document.getElementById('root');
  if (!target) throw new Error('The demo root element is missing');
  renderChat(target);
}
