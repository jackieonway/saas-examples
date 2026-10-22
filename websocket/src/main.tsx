import { createRoot, type Root } from 'react-dom/client';
import { installIframeBridge } from '../vendor/micro-app-sdk/1.0.0/index.mjs';
import SocketDemo from '../frontend';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('The demo root element is missing');
let root: Root | null = null;
function mount(target: HTMLElement) {
  root?.unmount();
  root = createRoot(target);
  root.render(<SocketDemo />);
}

if (window.parent === window) {
  mount(container);
} else {
  installIframeBridge(window);
  window.MicroIframe.connect({
    appCode: 'websocket-chat',
    allowedHostOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
    container,
    lifecycle: {
      name: 'websocket-chat',
      mount: target => mount(target),
      update: props => { document.documentElement.dataset.theme = props.theme; },
      unmount: () => { root?.unmount(); root = null; },
    },
  });
}
