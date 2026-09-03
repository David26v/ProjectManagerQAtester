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

  // element -> { value } — the latest typed value for a field that hasn't
  // been flushed yet. There is no independent timer here: a `fill` step is
  // emitted exactly once, on blur or Enter, with whatever the final value
  // was at that point. (An earlier version also flushed on a 500ms
  // inactivity timer, which could emit a stale partial-value `fill` if the
  // user paused mid-typing, followed by a second `fill` on blur — that's
  // exactly the duplicate/stale-value bug this comment is warning future
  // edits away from reintroducing.)
  const pendingFills = new Map();

  function cssEscape(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  }

  // For use inside a quoted attribute-value selector, e.g. `[name="..."]` —
  // only backslashes and double quotes need escaping there.
  function escapeAttrValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  const CLICKABLE_ROLES = ['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch'];

  // A raw click usually lands on a decorative leaf — a <span> or <svg>
  // inside the real button/link/row. Selectors built from that leaf's
  // utility classes ("span.min-w-0.flex-1.truncate:nth-of-type(1)") are
  // maximally fragile: any styling change or list reorder breaks the
  // replay. So before building a selector, climb to the nearest element
  // that's actually addressable — one with a test id / id / name, a native
  // interactive tag, or a clickable ARIA role — and describe THAT.
  function interactiveAncestor(el) {
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 8; depth += 1) {
      const tag = node.tagName.toLowerCase();
      if (node.getAttribute && (node.getAttribute('data-testid') || node.id || node.getAttribute('name'))) return node;
      if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'label' || tag === 'summary') return node;
      const role = node.getAttribute && node.getAttribute('role');
      if (role && CLICKABLE_ROLES.indexOf(role) !== -1) return node;
      node = node.parentElement;
    }
    return el;
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';

    const testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeAttrValue(testId)}"]`;

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `[name="${escapeAttrValue(name)}"]`;

    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute && el.getAttribute('role')) || '';
    const text = (el.textContent || '').trim().slice(0, 60);
    if ((tag === 'a' || tag === 'button') && text) {
      return `${tag}:has-text("${escapeAttrValue(text)}")`;
    }
    if (role && CLICKABLE_ROLES.indexOf(role) !== -1 && text) {
      return `[role="${role}"]:has-text("${escapeAttrValue(text)}")`;
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

  // Emits one `fill` for the field's current pending value, then clears it.
  // `window.__qaflowRecord` is an exposeBinding call, so it returns a
  // promise that resolves once the Node-side handler has processed it —
  // await it so callers (e.g. the stop/close flush below) can be sure the
  // step actually landed before they close the browser.
  async function flushFill(el) {
    if (!pendingFills.has(el)) return;
    const entry = pendingFills.get(el);
    pendingFills.delete(el);

    const password = isPasswordField(el);
    await window.__qaflowRecord({
      type: 'fill',
      selector: selectorFor(el),
      value: password ? '********' : entry.value,
      name: password ? 'Input password' : undefined,
      tagName: el.tagName,
    });
  }

  // Safety net for fields the user never blurred and never pressed Enter in
  // (e.g. they closed the recorder mid-typing). Only called at recorder
  // stop / page close — never on a mid-typing timer.
  async function flushAllPending() {
    const elements = Array.from(pendingFills.keys());
    for (const el of elements) {
      await flushFill(el);
    }
  }
  window.__qaflowFlushPending = flushAllPending;
  window.addEventListener('beforeunload', () => {
    // Best-effort only — browsers do not guarantee async work completes
    // during beforeunload. `recorder.js`'s explicit stop() flush is the
    // reliable path; this just catches the "user closed the window" case.
    flushAllPending();
  });

  document.addEventListener(
    'click',
    (e) => {
      if (!e.target || e.target.nodeType !== 1) return;
      const el = interactiveAncestor(e.target);
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

      // Just remember the latest value — flushed exclusively on blur/Enter
      // below, never on an inactivity timer.
      pendingFills.set(el, { value: el.value });
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
