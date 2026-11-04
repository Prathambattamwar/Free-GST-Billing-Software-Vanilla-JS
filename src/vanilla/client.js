import { createNativeRoot } from './dom.js';

export function createRoot(container) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('createRoot needs a DOM container element.');
  }
  const root = createNativeRoot(container);
  return {
    render(vnode) { root.render(vnode); },
    unmount() { root.unmount(); },
  };
}
