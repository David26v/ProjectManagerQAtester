'use strict';

// Self-contained recorder init script — injected into every page of the
// recording context via `context.addInitScript`. Playwright serializes this
// function with `.toString()` and runs it in the browser, so it must not
// close over anything outside its own body (no Node globals, no requires).
//
// It listens in the capture phase for click / input / change(select) /
// keydown(Enter) and reports normalized events to the Node side through
// `window.__qaflowRecord`, which `recorder.js` exposes via
// `context.exposeBinding`.

function qaflowRecorderInit() {
  if (window.__qaflowRecorderInstalled) return;
  window.__qaflowRecorderInstalled = true;

  const FLUSH_DEBOUNCE_MS = 500;
  const pendingFills = new Map(); // element -> { value, timer }

  function cssEscape(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';

    const testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `[name="${name}"]`;

    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button') {
      const text = (el.textContent || '').trim();
      if (text) return `${tag}:has-text("${text}")`;
    }

    // Fallback: tag.class:nth-of-type(n) among same-tag siblings.
    let selector = tag;
    if (typeof el.className === 'string' && el.className.trim()) {
      selector += '.' + el.className.trim().split(/\s+/).join('.');
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.prototype.filter.call(parent.children, (c) => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      selector += `:nth-of-type(${idx})`;
    }
    return selector;
  }

  function isPasswordField(el) {
    return el && el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'password';
  }

  function flushFill(el) {
    const entry = pendingFills.get(el);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingFills.delete(el);

    const password = isPasswordField(el);
    window.__qaflowRecord({
      type: 'fill',
      selector: selectorFor(el),
      value: password ? '********' : entry.value,
      name: password ? 'Input password' : undefined,
      tagName: el.tagName,
    });
  }

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      window.__qaflowRecord({
        type: 'click',
        selector: selectorFor(el),
        value: undefined,
        text: (el.textContent || '').trim().slice(0, 40),
        tagName: el.tagName,
      });
    },
    true
  );

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') return;

      const existing = pendingFills.get(el);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => flushFill(el), FLUSH_DEBOUNCE_MS);
      pendingFills.set(el, { value: el.value, timer });
    },
    true
  );

  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      if (el.tagName.toLowerCase() !== 'select') return;
      window.__qaflowRecord({
        type: 'select',
        selector: selectorFor(el),
        value: el.value,
        tagName: el.tagName,
      });
    },
    true
  );

  document.addEventListener(
    'blur',
    (e) => {
      const el = e.target;
      if (pendingFills.has(el)) flushFill(el);
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter') return;
      const el = e.target;
      if (el && pendingFills.has(el)) flushFill(el);
      window.__qaflowRecord({
        type: 'press',
        selector: undefined,
        value: 'Enter',
        tagName: el && el.tagName,
      });
    },
    true
  );
}

module.exports = qaflowRecorderInit;
