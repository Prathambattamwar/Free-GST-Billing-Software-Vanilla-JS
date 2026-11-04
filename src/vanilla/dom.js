/*
 * Free GST Billing — framework-free DOM renderer
 * ------------------------------------------------
 * Native HTML/SVG nodes, DOM events and browser JavaScript only.
 * No external UI framework or runtime is loaded.
 */

export const Fragment = Symbol('vanilla.fragment');
export const StrictMode = Symbol('vanilla.strict-mode');
export const Suspense = Symbol('vanilla.suspense');
const LAZY_PENDING = Symbol('vanilla.lazy-pending');
const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ROOTS = new WeakMap();
let activeFiber = null;

function asArray(value) {
  if (value == null || value === false || value === true) return [];
  return Array.isArray(value) ? value.flat(Infinity).filter((v) => v != null && v !== false && v !== true) : [value];
}

export function h(type, config, ...children) {
  const props = { ...(config || {}) };
  const key = props.key == null ? null : String(props.key);
  if (children.length) props.children = children.length === 1 ? children[0] : children;
  return { __vnode: true, type, props, key };
}
export const createElement = h;

export class Component {
  constructor(props) {
    this.props = props || {};
    this.state = this.state || {};
    this.__root = null;
    this.__path = null;
  }
  setState(update, callback) {
    const patch = typeof update === 'function' ? update(this.state, this.props) : update;
    if (patch && typeof patch === 'object') this.state = { ...this.state, ...patch };
    this.__root?.schedule();
    if (typeof callback === 'function') queueMicrotask(callback);
  }
  forceUpdate(callback) {
    this.__root?.schedule();
    if (typeof callback === 'function') queueMicrotask(callback);
  }
}

function depsEqual(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

function hookCell(index) {
  if (!activeFiber) throw new Error('A state hook was called outside a component.');
  const { root, path } = activeFiber;
  let hooks = root.hooks.get(path);
  if (!hooks) { hooks = []; root.hooks.set(path, hooks); }
  return hooks[index] || (hooks[index] = {});
}

export function useState(initialValue) {
  if (!activeFiber) throw new Error('useState must run inside a component.');
  const index = activeFiber.hookIndex++;
  const cell = hookCell(index);
  if (!Object.prototype.hasOwnProperty.call(cell, 'value')) cell.value = typeof initialValue === 'function' ? initialValue() : initialValue;
  const root = activeFiber.root;
  if (!cell.setState) {
    cell.setState = (nextValue) => {
      const next = typeof nextValue === 'function' ? nextValue(cell.value) : nextValue;
      if (Object.is(next, cell.value)) return;
      cell.value = next;
      root.schedule();
    };
  }
  return [cell.value, cell.setState];
}

export function useRef(initialValue) {
  if (!activeFiber) throw new Error('useRef must run inside a component.');
  const index = activeFiber.hookIndex++;
  const cell = hookCell(index);
  if (!cell.ref) cell.ref = { current: initialValue };
  return cell.ref;
}

export function useMemo(factory, deps) {
  if (!activeFiber) throw new Error('useMemo must run inside a component.');
  const index = activeFiber.hookIndex++;
  const cell = hookCell(index);
  if (!cell.hasValue || !depsEqual(cell.deps, deps)) {
    cell.value = factory();
    cell.deps = deps;
    cell.hasValue = true;
  }
  return cell.value;
}
export function useCallback(callback, deps) { return useMemo(() => callback, deps); }

export function useEffect(effect, deps) {
  if (!activeFiber) throw new Error('useEffect must run inside a component.');
  const index = activeFiber.hookIndex++;
  const cell = hookCell(index);
  if (cell.hasEffect && depsEqual(cell.deps, deps)) return;
  cell.deps = deps;
  cell.hasEffect = true;
  activeFiber.root.pendingEffects.push({ path: activeFiber.path, cell, effect });
}
export const useLayoutEffect = useEffect;

export function useImperativeHandle(ref, create, deps) {
  useEffect(() => {
    const value = create();
    if (typeof ref === 'function') ref(value);
    else if (ref && typeof ref === 'object') ref.current = value;
    return () => {
      if (typeof ref === 'function') ref(null);
      else if (ref && typeof ref === 'object') ref.current = null;
    };
  }, deps);
}

export function memo(component) { return component; }
export function forwardRef(render) {
  const wrapper = function ForwardRef(props) { return render(props || {}, props?.ref ?? null); };
  Object.defineProperty(wrapper, 'name', { value: render.displayName || render.name || 'ForwardRef' });
  wrapper.__forwardRef = true;
  return wrapper;
}
export function lazy(loader) {
  return { __lazy: true, loader, status: 'idle', component: null, error: null, promise: null, roots: new Set() };
}

function typeLabel(vnode) {
  if (!vnode?.__vnode) return typeof vnode;
  if (typeof vnode.type === 'string') return `dom:${vnode.type}`;
  if (vnode.type === Fragment) return 'fragment';
  if (vnode.type === Suspense) return 'suspense';
  if (vnode.type === StrictMode) return 'strict';
  if (vnode.type?.__lazy) return 'lazy';
  return vnode.type?.displayName || vnode.type?.name || 'component';
}

function childPath(parentPath, child, index) {
  const key = child?.key != null ? `key:${child.key}` : `index:${index}`;
  return `${parentPath}/${typeLabel(child)}/${key}`;
}

function kebabCase(value) { return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`); }

function updateStyle(el, oldStyle, newStyle) {
  const oldObj = oldStyle && typeof oldStyle === 'object' ? oldStyle : {};
  const newObj = newStyle && typeof newStyle === 'object' ? newStyle : {};
  for (const name of Object.keys(oldObj)) {
    if (Object.prototype.hasOwnProperty.call(newObj, name)) continue;
    try {
      if (name.startsWith('--')) el.style.removeProperty(name);
      else el.style.removeProperty(kebabCase(name));
    } catch { /* ignore unsupported style */ }
  }
  for (const [name, value] of Object.entries(newObj)) {
    if (value == null || value === false) continue;
    try {
      if (name.startsWith('--')) el.style.setProperty(name, String(value));
      else if (name.startsWith('Webkit') || name.startsWith('ms')) el.style.setProperty(`-${kebabCase(name)}`, String(value));
      else el.style[name] = typeof value === 'number' && value !== 0 && !['opacity','zIndex','fontWeight','lineHeight','flex','order','zoom','gridRow','gridColumn','scale'].includes(name) ? `${value}px` : String(value);
    } catch { /* ignore invalid style declarations */ }
  }
}

const BOOL_PROPS = new Set(['disabled','checked','selected','multiple','required','readOnly','autoFocus','hidden','open','controls','loop','muted','playsInline','noValidate','formNoValidate','reversed','itemScope','allowFullScreen']);
const ATTR_MAP = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex', readOnly: 'readonly', autoFocus: 'autofocus', srcSet: 'srcset', colSpan: 'colspan', rowSpan: 'rowspan', maxLength: 'maxlength', minLength: 'minlength', dateTime: 'datetime', crossOrigin: 'crossorigin', contentEditable: 'contenteditable', spellCheck: 'spellcheck', autoComplete: 'autocomplete', autoCapitalize: 'autocapitalize', encType: 'enctype', acceptCharset: 'accept-charset', formAction: 'formaction', formMethod: 'formmethod', formNoValidate: 'formnovalidate', noValidate: 'novalidate', playsInline: 'playsinline', allowFullScreen: 'allowfullscreen', xlinkHref: 'xlink:href', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule', stopColor: 'stop-color', stopOpacity: 'stop-opacity', textAnchor: 'text-anchor', dominantBaseline: 'dominant-baseline', preserveAspectRatio: 'preserveAspectRatio' };
const EVENT_NAME = { onDoubleClick: 'dblclick', onFocus: 'focusin', onBlur: 'focusout', onMouseEnter: 'mouseenter', onMouseLeave: 'mouseleave', onPointerEnter: 'pointerenter', onPointerLeave: 'pointerleave', onChange: 'change', onKeyDown: 'keydown', onKeyUp: 'keyup', onKeyPress: 'keypress', onMouseDown: 'mousedown', onMouseUp: 'mouseup', onMouseMove: 'mousemove', onContextMenu: 'contextmenu', onDragStart: 'dragstart', onDragOver: 'dragover', onDrop: 'drop', onTouchStart: 'touchstart', onTouchMove: 'touchmove', onTouchEnd: 'touchend', onAnimationEnd: 'animationend', onTransitionEnd: 'transitionend', onLoad: 'load', onError: 'error', onScroll: 'scroll' };

function eventNames(el, propName) {
  if (propName === 'onChange') {
    const textLike = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|range|color|date|datetime-local|month|time|week)$/i.test(el.type || ''));
    return textLike ? ['input'] : (el.type === 'range' ? ['input', 'change'] : ['change']);
  }
  return [EVENT_NAME[propName] || propName.slice(2).toLowerCase()];
}

function setEvent(el, propName, handler) {
  const map = el.__vanillaEvents || (el.__vanillaEvents = new Map());
  const previous = map.get(propName);
  if (previous?.handler === handler) return;
  if (previous) previous.names.forEach((name) => el.removeEventListener(name, previous.handler, previous.options));
  map.delete(propName);
  if (typeof handler !== 'function') return;
  const names = eventNames(el, propName);
  const options = { passive: propName === 'onScroll' || propName === 'onTouchMove' };
  names.forEach((name) => el.addEventListener(name, handler, options));
  map.set(propName, { handler, names, options });
}

function removeProperty(el, name, oldValue) {
  if (name.startsWith('on') && typeof oldValue === 'function') { setEvent(el, name, null); return; }
  if (name === 'style') { updateStyle(el, oldValue, {}); return; }
  if (name === 'ref' || name === 'children' || name === 'key' || name === 'dangerouslySetInnerHTML') return;
  if (name === 'value' || name === 'checked') {
    el.removeAttribute(name);
    el.removeAttribute('data-vcontrolled');
    return;
  }
  const attr = ATTR_MAP[name] || (BOOL_PROPS.has(name) ? name.toLowerCase() : name);
  try { el.removeAttribute(attr); } catch { /* ignore */ }
  if (BOOL_PROPS.has(name)) { try { el[name] = false; } catch { /* readonly */ } }
}

function setProperty(el, name, value, oldValue) {
  if (name === 'key' || name === 'children' || name === 'ref' || name === 'dangerouslySetInnerHTML') return;
  if (name === 'style') { updateStyle(el, oldValue, value); return; }
  if (name === 'className') { el.setAttribute('class', value == null ? '' : String(value)); return; }
  if (name === 'htmlFor') { el.setAttribute('for', value == null ? '' : String(value)); return; }
  if (name === 'defaultValue') {
    if (!('value' in el)) return;
    el.defaultValue = value == null ? '' : value;
    if (oldValue === undefined && el.value === '') el.value = value == null ? '' : value;
    return;
  }
  if (name === 'defaultChecked') {
    el.defaultChecked = !!value;
    if (oldValue === undefined && !el.checked) el.checked = !!value;
    return;
  }
  if (name === 'value') {
    try {
      if (el.tagName === 'SELECT' && Array.isArray(value)) {
        for (const option of el.options) option.selected = value.includes(option.value);
      } else if (el.value !== String(value ?? '')) el.value = value == null ? '' : value;
      el.setAttribute('data-vcontrolled', '1');
    } catch (error) {
      // File inputs reject non-empty programmatic values; browsers own their selection.
      if (el.type !== 'file') throw error;
    }
    return;
  }
  if (name === 'download') {
    if (value == null || value === false) el.removeAttribute('download');
    else el.setAttribute('download', value === true ? '' : String(value));
    return;
  }
  if (name === 'checked') { el.checked = !!value; el.setAttribute('data-vcontrolled', '1'); return; }
  if (name.startsWith('on')) { setEvent(el, name, value); return; }
  if (value == null || (value === false && !name.startsWith('aria-') && !name.startsWith('data-'))) {
    try { el.removeAttribute(ATTR_MAP[name] || name); } catch { /* ignore */ }
    return;
  }
  if (BOOL_PROPS.has(name)) {
    try { el[name] = !!value; } catch { /* readonly */ }
    if (value) el.setAttribute(ATTR_MAP[name] || name.toLowerCase(), '');
    else el.removeAttribute(ATTR_MAP[name] || name.toLowerCase());
    return;
  }
  if (typeof value === 'object') return;
  const attr = ATTR_MAP[name] || name;
  try {
    if (['title','id','name','type','placeholder','href','src','target','rel','role','alt','width','height','min','max','step','accept','action','method','pattern','tabIndex','contentEditable','spellcheck','draggable'].includes(name)) {
      try { el[name] = value; } catch { /* property may be readonly */ }
    }
    el.setAttribute(attr, value === true ? '' : String(value));
  } catch { /* unsupported attribute */ }
}

function updateDomProps(el, entry, newProps) {
  const oldProps = entry.props || {};
  for (const [name, value] of Object.entries(oldProps)) {
    if (name === 'ref') continue;
    if (!Object.prototype.hasOwnProperty.call(newProps, name)) removeProperty(el, name, value);
  }
  for (const [name, value] of Object.entries(newProps)) {
    if (name === 'ref' || name === 'children') continue;
    if (name === 'style' || !Object.is(value, oldProps[name])) setProperty(el, name, value, oldProps[name]);
  }
  if (entry.ref !== newProps.ref) {
    if (entry.ref) assignRef(entry.ref, null);
    if (newProps.ref) assignRef(newProps.ref, el);
    entry.ref = newProps.ref;
  }
  entry.props = newProps;
  if (newProps.autoFocus && !oldProps.autoFocus) queueMicrotask(() => { try { el.focus(); } catch { /* ignore */ } });
}

function assignRef(ref, value) {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') ref.current = value;
}

function patchChildren(parent, desiredNodes) {
  for (let index = 0; index < desiredNodes.length; index++) {
    const node = desiredNodes[index];
    const current = parent.childNodes[index] || null;
    if (current !== node) parent.insertBefore(node, current);
  }
  while (parent.childNodes.length > desiredNodes.length) parent.removeChild(parent.lastChild);
}

function renderDom(vnode, path, root, parentNs) {
  const { type, props } = vnode;
  const ns = type === 'svg' ? SVG_NS : (parentNs === SVG_NS && type !== 'foreignObject' ? SVG_NS : HTML_NS);
  let entry = root.domByPath.get(path);
  if (!entry || entry.kind !== 'element' || entry.tag !== type || entry.ns !== ns) {
    const el = ns === SVG_NS ? document.createElementNS(SVG_NS, type) : document.createElement(type);
    entry = { kind: 'element', tag: type, ns, node: el, props: {}, ref: null };
  }
  const el = entry.node;
  root.nextDomByPath.set(path, entry);
  if (!el.hasAttribute('data-vpath')) el.setAttribute('data-vpath', path);
  updateDomProps(el, entry, props || {});

  const html = props?.dangerouslySetInnerHTML?.__html;
  if (html != null) {
    if (entry.html !== html) el.innerHTML = String(html);
    entry.html = html;
  } else {
    if (entry.html != null) { el.replaceChildren(); entry.html = null; }
    const children = renderChildren(props?.children, path, root, type === 'foreignObject' ? HTML_NS : ns);
    patchChildren(el, children);
    // A select's options must exist before its controlled/default value is applied.
    if (type === 'select') {
      if (props?.value != null) {
        if (Array.isArray(props.value)) {
          for (const option of el.options) option.selected = props.value.includes(option.value);
        } else {
          el.value = String(props.value);
        }
      } else if (props?.defaultValue != null && !entry.defaultSelectApplied) {
        el.value = String(props.defaultValue);
        entry.defaultSelectApplied = true;
      }
    }
  }
  return el;
}

function renderChildren(children, path, root, ns) {
  const nodes = [];
  asArray(children).forEach((child, index) => {
    const childNode = renderNode(child, childPath(path, child, index), root, ns);
    if (Array.isArray(childNode)) nodes.push(...childNode);
    else if (childNode) nodes.push(childNode);
  });
  return nodes;
}

function renderFunction(type, props, path, root, parentNs) {
  root.visited.add(path);
  let hooks = root.hooks.get(path);
  if (!hooks) { hooks = []; root.hooks.set(path, hooks); }
  const previousFiber = activeFiber;
  activeFiber = { root, path, hooks, hookIndex: 0 };
  let output;
  try { output = type(props); }
  finally { activeFiber = previousFiber; }
  return renderNode(output, `${path}/output`, root, parentNs);
}

function renderClass(type, props, path, root, parentNs) {
  root.visited.add(path);
  let instance = root.classes.get(path);
  if (!instance) {
    instance = new type(props);
    instance.__root = root;
    instance.__path = path;
    root.classes.set(path, instance);
  }
  instance.props = props || {};
  try {
    return renderNode(instance.render(), `${path}/output`, root, parentNs);
  } catch (error) {
    if (typeof type.getDerivedStateFromError !== 'function') throw error;
    const derived = type.getDerivedStateFromError(error);
    if (derived) instance.state = { ...instance.state, ...derived };
    if (typeof instance.componentDidCatch === 'function') instance.componentDidCatch(error, { componentStack: `\n    in ${type.name || 'Component'}` });
    return renderNode(instance.render(), `${path}/fallback`, root, parentNs);
  }
}

function renderLazy(type, props, path, root, parentNs) {
  type.roots.add(root);
  if (type.status === 'ready') return renderNode(h(type.component, props), `${path}/loaded`, root, parentNs);
  if (type.status === 'error') throw type.error;
  if (type.status === 'idle') {
    type.status = 'loading';
    type.promise = Promise.resolve().then(type.loader).then((mod) => {
      type.component = mod?.default || mod;
      if (typeof type.component !== 'function') throw new Error('Lazy view did not export a component.');
      type.status = 'ready';
      for (const renderRoot of type.roots) renderRoot.schedule();
    }).catch((error) => {
      type.error = error;
      type.status = 'error';
      for (const renderRoot of type.roots) renderRoot.schedule();
    });
  }
  const pending = new Error('A lazy module is still loading.');
  pending.code = LAZY_PENDING;
  pending.__vanillaPending = true;
  throw pending;
}

function renderNode(node, path, root, parentNs = HTML_NS) {
  if (node == null || node === false || node === true) return null;
  if (Array.isArray(node)) return renderChildren(node, path, root, parentNs);
  if (typeof node === 'string' || typeof node === 'number') {
    const entry = root.domByPath.get(path);
    if (entry?.kind === 'text') {
      entry.node.nodeValue = String(node);
      root.nextDomByPath.set(path, entry);
      return entry.node;
    }
    const text = document.createTextNode(String(node));
    root.nextDomByPath.set(path, { kind: 'text', node: text });
    return text;
  }
  if (node instanceof Node) return node;
  if (!node || node.__vnode !== true) return document.createTextNode(String(node));
  const { type, props } = node;
  if (type === Fragment || type === StrictMode) return renderChildren(props?.children, path, root, parentNs);
  if (type === Suspense) {
    try { return renderChildren(props?.children, `${path}/suspense`, root, parentNs); }
    catch (error) {
      if (error?.code === LAZY_PENDING || error?.__vanillaPending) return renderNode(props?.fallback ?? null, `${path}/fallback`, root, parentNs);
      throw error;
    }
  }
  if (typeof type === 'string') return renderDom(node, path, root, parentNs);
  if (type?.__lazy) return renderLazy(type, props || {}, path, root, parentNs);
  if (typeof type === 'function') {
    if (type.prototype instanceof Component) return renderClass(type, props || {}, path, root, parentNs);
    return renderFunction(type, props || {}, path, root, parentNs);
  }
  throw new Error(`Unsupported view node: ${String(type)}`);
}

function cleanRemoved(root, oldDom) {
  for (const [path, hooks] of root.hooks) {
    if (root.visited.has(path)) continue;
    hooks.forEach((cell) => { try { cell.cleanup?.(); } catch (error) { console.warn('View cleanup failed', error); } });
    root.hooks.delete(path);
  }
  for (const path of root.classes.keys()) if (!root.visited.has(path)) root.classes.delete(path);
  for (const [path, entry] of oldDom) {
    const next = root.nextDomByPath.get(path);
    if ((!next || next.node !== entry.node) && entry.ref) assignRef(entry.ref, null);
  }
}

function runEffects(root) {
  const effects = root.pendingEffects.splice(0).reverse();
  for (const item of effects) {
    if (!root.visited.has(item.path)) continue;
    try {
      item.cell.cleanup?.();
      const cleanup = item.effect();
      item.cell.cleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch (error) {
      console.error('View effect failed', error);
      window.dispatchEvent(new CustomEvent('fgsb-runtime-error', { detail: error }));
    }
  }
}

class NativeRoot {
  constructor(container) {
    this.container = container;
    this.vnode = null;
    this.hooks = new Map();
    this.classes = new Map();
    this.domByPath = new Map();
    this.nextDomByPath = new Map();
    this.pendingEffects = [];
    this.visited = new Set();
    this.queued = false;
    this.destroyed = false;
  }
  render(vnode) {
    if (this.destroyed) throw new Error('Cannot render an unmounted root.');
    this.vnode = vnode;
    this.commit();
  }
  schedule() {
    if (this.destroyed || this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.destroyed) this.commit(); });
  }
  commit() {
    const oldDom = this.domByPath;
    this.nextDomByPath = new Map();
    this.visited = new Set();
    this.pendingEffects = [];
    try {
      const rendered = renderNode(this.vnode, 'root', this, HTML_NS);
      const nodes = Array.isArray(rendered) ? rendered : rendered ? [rendered] : [];
      patchChildren(this.container, nodes);
      cleanRemoved(this, oldDom);
      this.domByPath = this.nextDomByPath;
      runEffects(this);
    } catch (error) {
      console.error('The billing screen could not render:', error);
      const panel = document.createElement('section');
      panel.className = 'glass-panel problem-panel';
      panel.innerHTML = '<h2>This screen ran into a problem.</h2><p>Your saved data has not been deleted. Reload the app or open the Dashboard.</p>';
      this.container.replaceChildren(panel);
    }
  }
  unmount() {
    this.destroyed = true;
    for (const hooks of this.hooks.values()) hooks.forEach((cell) => { try { cell.cleanup?.(); } catch { /* ignore */ } });
    for (const entry of this.domByPath.values()) if (entry.ref) assignRef(entry.ref, null);
    this.hooks.clear();
    this.classes.clear();
    this.domByPath.clear();
    this.container.replaceChildren();
    ROOTS.delete(this.container);
  }
}

export function createNativeRoot(container) {
  let root = ROOTS.get(container);
  if (!root || root.destroyed) { root = new NativeRoot(container); ROOTS.set(container, root); }
  return root;
}

const FrameworkFreeCompat = { createElement: h, Fragment, StrictMode, Suspense, Component, memo, forwardRef, lazy };
export default FrameworkFreeCompat;
