'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const calc = require('../calculator.js');

const scriptPath = path.join(__dirname, '..', 'script.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource =
  scriptSource +
  '\n;globalThis.__testHarness = { applyGradingSystem, printReport, buildReportElement, removePrintReport, updateSummaryPanel, appState, appElements, createSemesterCard, confirmDialog, showToast, accountController, backupController, saveState, loadState };';

function matchesSelector(element, selector) {
  if (!element || !selector) return false;
  if (selector.startsWith('.')) {
    return String(element.className || '').split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('#')) {
    return element.id === selector.slice(1);
  }
  return false;
}

function makeClassList() {
  const classes = new Set();
  return {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    contains: (name) => classes.has(name),
    toggle: (name, force) => {
      if (force === undefined) {
        classes.has(name) ? classes.delete(name) : classes.add(name);
      } else if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    }
  };
}

function defaultState() {
  return {
    semesters: [
      {
        id: 'sem-1',
        title: 'Semester 1',
        subjects: [
          { id: 'sub-1', name: 'Mathematics', grade: 'A', credit: 4 },
          { id: 'sub-2', name: 'Physics', grade: 'S', credit: 3 }
        ]
      },
      {
        id: 'sem-2',
        title: 'Semester 2',
        subjects: [{ id: 'sub-3', name: 'Chemistry', grade: 'B', credit: 3 }]
      }
    ],
    selectedSemesterId: 'sem-1',
    selectedGradingSystem: 'standard-btech'
  };
}

function createApp(options = {}) {
  const state = options.state || defaultState();
  const confirmResult = options.confirm !== false;
  const printCalls = { count: 0 };
  const byId = new Map();
  const documentQueries = new Map();
  const storage = new Map();
  let generatedIds = 0;
  let focusedElement = null;

  function makeElement(tag, initialId = '') {
    let id = initialId;
    const listeners = new Map();
    const queries = new Map();
    const attributes = new Map();
    const element = {
      tagName: String(tag).toUpperCase(),
      className: '',
      value: '',
      textContent: '',
      hidden: false,
      dataset: {},
      style: {},
      children: [],
      classList: makeClassList(),
      _innerHTML: '',
      _removed: false,
      _listeners: listeners,
      _queries: queries,
      _attributes: attributes,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      removeEventListener(type, handler) {
        const handlers = listeners.get(type);
        if (handlers) listeners.set(type, handlers.filter((item) => item !== handler));
      },
      dispatch(type, event = {}) {
        let result;
        (listeners.get(type) || []).forEach((handler) => {
          result = handler(event);
        });
        return result;
      },
      focus() {
        focusedElement = element;
      },
      blur() {
        if (focusedElement === element) focusedElement = null;
      },
      click() {
        element._clicked = true;
        (listeners.get('click') || []).forEach((handler) => handler({ type: 'click', target: element }));
      },
      setAttribute(name, value) {
        const text = String(value);
        attributes.set(name, text);
        if (name === 'id') element.id = text;
      },
      getAttribute(name) {
        return attributes.has(name) ? attributes.get(name) : undefined;
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      appendChild(child) {
        element.children.push(child);
        if (child && child.id) byId.set(child.id, child);
        return child;
      },
      append(...children) {
        children.forEach((child) => element.appendChild(child));
      },
      removeChild(child) {
        const index = element.children.indexOf(child);
        if (index >= 0) element.children.splice(index, 1);
        return child;
      },
      replaceChild(next, previous) {
        const index = element.children.indexOf(previous);
        if (index >= 0) element.children[index] = next;
        else element.children.push(next);
        if (next && next.id) byId.set(next.id, next);
        return previous;
      },
      insertBefore(child) {
        element.children.unshift(child);
        if (child && child.id) byId.set(child.id, child);
        return child;
      },
      insertAdjacentElement(_position, child) {
        if (child && child.id) byId.set(child.id, child);
        return child;
      },
      querySelector(selector) {
        const child = element.children.find((candidate) => matchesSelector(candidate, selector));
        if (child) {
          return child;
        }
        if (!queries.has(selector)) queries.set(selector, makeElement('div'));
        return queries.get(selector);
      },
      querySelectorAll() {
        return [];
      },
      remove() {
        element._removed = true;
      },
      closest() {
        return null;
      }
    };

    Object.defineProperty(element, 'id', {
      get() {
        return id;
      },
      set(value) {
        id = String(value);
        if (id) byId.set(id, element);
      }
    });

    Object.defineProperty(element, 'innerHTML', {
      get() {
        return element._innerHTML;
      },
      set(value) {
        element._innerHTML = String(value);
        if (value === '') element.children = [];
      }
    });

    if (initialId) byId.set(initialId, element);
    return element;
  }

  const navLinks = ['#overview', '#semesters', '#report'].map((href, index) => {
    const link = makeElement('a');
    link.className = index === 0 ? 'nav-pill active' : 'nav-pill';
    link.setAttribute('href', href);
    if (index === 0) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'location');
    }
    return link;
  });

  const document = {
    documentElement: makeElement('html'),
    body: makeElement('body'),
    createElement: (tag) => makeElement(tag),
    get activeElement() {
      return focusedElement;
    },
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeElement('div', id));
      return byId.get(id);
    },
    querySelector(selector) {
      if (!documentQueries.has(selector)) documentQueries.set(selector, makeElement('div'));
      return documentQueries.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === '.bottom-nav .nav-pill') return navLinks;
      return [];
    }
  };

  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      const blocked = options.storageFails || (typeof options.storageFailsOn === 'function' && options.storageFailsOn(key));
      if (blocked) {
        const error = new Error('QuotaExceededError: storage is full');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key)
  };

  const navigator = {
    clipboard: {
      writeText: () => Promise.resolve()
    }
  };

  const windowListeners = new Map();
  const window = {
    scrollY: 0,
    scrollTo() {},
    print() {
      printCalls.count += 1;
    },
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = windowListeners.get(type);
      if (handlers) windowListeners.set(type, handlers.filter((item) => item !== handler));
    },
    location: { reload() {}, hash: options.hash || '' }
  };

  const context = {
    SgpaCalculator: calc,
    document,
    localStorage,
    sessionStorage: { getItem: () => null, setItem() {} },
    navigator,
    window,
    crypto: { randomUUID: () => `generated-${(generatedIds += 1)}` },
    confirm: () => confirmResult,
    Blob: class Blob {
      constructor(parts, options) {
        this.parts = parts;
        this.type = (options || {}).type || '';
        this.size = parts.join('').length;
      }
    },
    URL: {
      createObjectURL: () => 'blob:sgpa-test',
      revokeObjectURL: () => {}
    },
    requestAnimationFrame: (callback) => {
      callback();
      return 0;
    },
    setTimeout: () => 0,
    clearTimeout() {},
    console
  };

  if (options.legacyOnly) {
    storage.set('sgpaCgpaGradingSystem', options.legacySystem || state.selectedGradingSystem || 'standard-btech');
  } else {
    storage.set('sgpaCgpaPwaState', JSON.stringify(state));
    storage.set('sgpaCgpaGradingSystem', state.selectedGradingSystem || 'standard-btech');
  }
  if (options.savedTheme !== undefined) {
    storage.set('sgpaCgpaTheme', options.savedTheme);
  }
  if (options.savedState !== undefined) {
    storage.set('sgpaCgpaPwaState', options.savedState);
  }

  if (options.printAvailable === false) {
    delete window.print;
  }

  vm.createContext(context);
  vm.runInContext(instrumentedSource, context, { filename: 'script.js' });

  const harness = context.__testHarness;

  if (!options.dialog) {
    harness.confirmDialog.setDecisionHandler(() => confirmResult);
  }

  return {
    harness,
    appElements: harness.appElements,
    picker: harness.appElements.gradingSystemPicker,
    document,
    navLinks,
    window,
    byId: (id) => document.getElementById(id),
    dispatchWindowEvent(type, event = {}) {
      const handlers = windowListeners.get(type) || [];
      let result;
      handlers.forEach((handler) => {
        result = handler(event);
      });
      return result;
    },
    printCalls,
    storage,
    storageKeys: () => [...storage.keys()],
    toasts() {
      return harness.appElements.toastContainer.children.map((toast) => ({
        className: toast.className,
        message: toast._queries.get('.toast-message')?.textContent || ''
      }));
    }
  };
}

function fileWith(text) {
  return {
    name: 'backup.json',
    size: text.length,
    text: () => Promise.resolve(text)
  };
}

/* --------------------------------------------------------------- account */

test('the account view is hidden until it is opened, and the calculator keeps working', () => {
  const app = createApp();

  assert.equal(app.byId('account-view').hidden, true, 'the account view starts hidden');
  assert.equal(app.harness.accountController.isViewOpen(), false);

  app.byId('account-btn').dispatch('click');
  assert.equal(app.harness.accountController.isViewOpen(), true, 'the account view opens');

  app.byId('account-close-btn').dispatch('click');
  assert.equal(app.harness.accountController.isViewOpen(), false, 'the account view closes');

  // the guest calculator is untouched
  app.appElements.addSemesterBtn.dispatch('click');
  assert.equal(app.harness.appState.semesters.length, 3);
});

test('opening the account view moves focus inside, traps Tab and closes on Escape', () => {
  const app = createApp();
  const controller = app.harness.accountController;
  const view = app.byId('account-view');
  const heading = app.byId('account-view-title');

  app.byId('account-btn').dispatch('click');
  assert.equal(controller.isViewOpen(), true);
  assert.equal(app.document.activeElement, heading, 'the focus starts in the account view, not on the page body');
  assert.equal(heading.getAttribute('tabindex'), '-1', 'the heading is programmatically focusable');

  // Tab cycles through the visible account controls and never reaches the page.
  const sequence = [];
  for (let index = 0; index < 6; index += 1) {
    view.dispatch('keydown', { key: 'Tab', preventDefault() {} });
    sequence.push(app.document.activeElement.id);
  }
  assert.deepEqual(sequence, [
    'account-close-btn',
    'account-tab-signin',
    'account-signin-email',
    'account-signin-password',
    'account-signin-password-toggle',
    'account-signin-submit'
  ]);
  assert.equal(
    sequence.every((id) => id && id !== 'account-btn'),
    true,
    'the focus never moves to the page behind the account view'
  );

  // Shift+Tab moves backwards, and wraps from the first control to the last.
  view.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(app.document.activeElement.id, 'account-signin-password-toggle');

  app.byId('account-close-btn').focus();
  view.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(app.document.activeElement.id, 'account-signin-submit', 'Shift+Tab wraps inside the view');

  view.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(controller.isViewOpen(), false, 'Escape closes the account view');
  assert.equal(app.document.activeElement, app.byId('account-btn'), 'the focus returns to the opener');
});

test('the session is shown as a guest and no sign-out control is offered', () => {
  const app = createApp();

  assert.equal(app.byId('session-chip').dataset.sessionState, 'guest');
  assert.match(app.byId('session-chip').textContent, /device/i);
  assert.equal(app.byId('account-signout-btn').hidden, true);
  assert.equal(app.harness.accountController.getState().providerConfigured, false);
});

test('the sign-in form reports missing and malformed fields instead of submitting', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  const empty = await controller.handleSubmit('sign-in', { preventDefault() {} });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'validation');
  assert.equal(empty.errors.email, 'Enter your email address.');
  assert.equal(empty.errors.password, 'Enter your password.');
  assert.equal(app.byId('account-signin-email').getAttribute('aria-invalid'), 'true');
  assert.equal(app.byId('account-signin-email-error').hidden, false);
  assert.match(app.byId('account-signin-feedback').textContent, /highlighted fields/i);

  app.byId('account-signin-email').value = 'not-an-email';
  app.byId('account-signin-password').value = 'short';
  const invalid = await controller.handleSubmit('sign-in', { preventDefault() {} });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.email, /valid email/i);
  assert.match(invalid.errors.password, /at least 8/i);
});

test('the sign-up form checks that the two passwords match', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  app.byId('account-signup-email').value = 'student@example.com';
  app.byId('account-signup-password').value = 'correct-horse';
  app.byId('account-signup-confirm').value = 'different-horse';

  const result = await controller.handleSubmit('sign-up', { preventDefault() {} });
  assert.equal(result.ok, false);
  assert.match(result.errors.confirmPassword, /do not match/i);
});

test('a valid form reports honestly that no authentication provider is configured', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  app.byId('account-signin-email').value = 'student@example.com';
  app.byId('account-signin-password').value = 'correct-horse';

  const result = await controller.handleSubmit('sign-in', { preventDefault() {} });

  assert.equal(result.ok, false, 'no successful authentication is ever reported');
  assert.equal(result.code, 'provider-unavailable');
  assert.match(result.message, /no authentication provider is configured/i);
  assert.match(app.byId('account-signin-feedback').textContent, /no authentication provider/i);
  assert.equal(app.byId('account-signin-feedback').dataset.tone, 'error');
  assert.ok(
    app.toasts().some((toast) => /no authentication provider/i.test(toast.message)),
    'the failure is also announced'
  );

  // the guest state is unchanged and no session was created
  assert.equal(controller.getState().status, 'guest');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'guest');
  assert.equal(app.byId('account-signout-btn').hidden, true);
});

test('a password is never written to storage and never compared with a stored value', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  app.byId('account-signin-email').value = 'student@example.com';
  app.byId('account-signin-password').value = 'super-secret-value';
  await controller.handleSubmit('sign-in', { preventDefault() {} });

  for (const [key, value] of app.storage) {
    assert.equal(/super-secret-value/.test(String(value)), false, `the password leaked into ${key}`);
  }
  assert.equal(
    app.storageKeys().some((key) => /auth|session|token|password|user/i.test(key)),
    false,
    'no authentication record is written locally'
  );
});

test('the password field is masked and the show control is accessible', () => {
  const app = createApp();

  const input = app.byId('account-signin-password');
  const toggle = app.byId('account-signin-password-toggle');
  assert.equal(input.type, 'password', 'the password starts masked');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  toggle.dispatch('click');
  assert.equal(input.type, 'text', 'the password can be revealed');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.match(toggle.textContent, /hide/i);

  toggle.dispatch('click');
  assert.equal(input.type, 'password', 'the password can be hidden again');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});

test('the account tabs expose their state and switch the visible form', () => {
  const app = createApp();
  const controller = app.harness.accountController;

  assert.equal(app.byId('account-tab-signin').getAttribute('aria-selected'), 'true');
  assert.equal(app.byId('account-panel-signin').hidden, false);
  assert.equal(app.byId('account-panel-signup').hidden, true);

  controller.setMode('sign-up');
  assert.equal(app.byId('account-tab-signup').getAttribute('aria-selected'), 'true');
  assert.equal(app.byId('account-tab-signin').getAttribute('aria-selected'), 'false');
  assert.equal(app.byId('account-panel-signup').hidden, false);
  assert.equal(app.byId('account-panel-signin').hidden, true);
});

test('a configured provider drives the session state and the sign-out control', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  controller.setProvider({
    signIn: async ({ email }) => ({ ok: true, user: { email } }),
    signUp: async ({ email }) => ({ ok: true, user: { email } }),
    signOut: async () => ({ ok: true })
  });

  app.byId('account-signin-email').value = 'student@example.com';
  app.byId('account-signin-password').value = 'correct-horse';
  const result = await controller.handleSubmit('sign-in', { preventDefault() {} });

  assert.equal(result.ok, true);
  assert.equal(controller.getState().status, 'signed-in');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'signed-in');
  assert.match(app.byId('session-chip').textContent, /student@example\.com/);
  assert.equal(app.byId('account-signout-btn').hidden, false);
  assert.equal(app.byId('account-signin-password').value, '', 'the password field is cleared afterwards');
  assert.match(app.byId('account-provider-notice').textContent, /not uploaded or synced/i);
  assert.match(app.byId('account-provider-title').textContent, /optional/i);

  await controller.signOut();
  assert.equal(controller.getState().status, 'guest');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'guest');
  assert.equal(app.byId('account-signout-btn').hidden, true);
});

test('credential forms cannot fall back to a GET submission', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  for (const id of ['account-panel-signin', 'account-panel-signup']) {
    const match = html.match(new RegExp(`<form\\b[^>]*id="${id}"[^>]*>`));
    assert.ok(match, id + ' must be a form');
    assert.match(match[0], /method="post"/i, id + ' must not use the GET default');
    assert.match(match[0], /action="index\.html"/i, id + ' must stay on the app page');
  }
});

test('a failed sign-out keeps the session and never claims success', async () => {
  const app = createApp();
  const controller = app.harness.accountController;
  const state = { status: 'signed-in', user: { email: 'student@example.com' } };

  controller.setProvider({
    getState: () => state,
    subscribe(handler) {
      handler(state);
      return () => {};
    },
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signOut: async () => ({
      ok: false,
      code: 'sign-out-failed',
      message: 'We could not sign you out. Your session may still be active. Please try again.'
    })
  });

  const result = await controller.signOut();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'sign-out-failed');
  assert.equal(controller.getState().status, 'signed-in');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'signed-in');
  assert.equal(app.byId('account-signout-btn').hidden, false);
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), false);
  assert.equal(
    app.toasts().some((toast) => /could not sign you out/i.test(toast.message)),
    true,
    'the failure is reported instead of a false success'
  );
});

test('a rejected sign-out also preserves the session and reports a safe error', async () => {
  const app = createApp();
  const controller = app.harness.accountController;
  const state = { status: 'signed-in', user: { email: 'student@example.com' } };

  controller.setProvider({
    getState: () => state,
    subscribe(handler) {
      handler(state);
      return () => {};
    },
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signOut: async () => {
      throw new Error('network unavailable');
    }
  });

  const result = await controller.signOut();

  assert.equal(result.ok, false);
  assert.equal(controller.getState().status, 'signed-in');
  assert.equal(app.byId('account-signout-btn').hidden, false);
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), false);
  assert.equal(app.toasts().some((toast) => /could not sign you out/i.test(toast.message)), true);
});

test('sign-out waits for provider confirmation before showing success', async () => {
  const app = createApp();
  const controller = app.harness.accountController;
  const state = { status: 'signed-in', user: { email: 'student@example.com' } };
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });

  controller.setProvider({
    getState: () => state,
    subscribe(handler) {
      handler(state);
      return () => {};
    },
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signOut: () => pending
  });

  const signingOut = controller.signOut();
  assert.equal(app.byId('account-signout-btn').disabled, true, 'the sign-out button is disabled in flight');
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), false);

  const duplicate = await controller.signOut();
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'sign-out-in-flight');
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), false);

  state.status = 'guest';
  state.user = null;
  finish({ ok: true });
  const result = await signingOut;

  assert.equal(result.ok, true);
  assert.equal(controller.getState().status, 'guest');
  assert.equal(app.byId('account-signout-btn').disabled, false, 'the button is usable again afterwards');
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), true);
});

test('a provider without a sign-out method never reports a successful sign-out', async () => {
  const app = createApp();
  const controller = app.harness.accountController;
  const state = { status: 'signed-in', user: { email: 'student@example.com' } };

  controller.setProvider({
    getState: () => state,
    subscribe(handler) {
      handler(state);
      return () => {};
    },
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({ ok: false, code: 'unused', message: 'unused' })
  });

  const result = await controller.signOut();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'sign-out-unavailable');
  assert.equal(controller.getState().status, 'signed-in');
  assert.equal(app.byId('account-signout-btn').hidden, false);
  assert.equal(app.toasts().some((toast) => /signed out/i.test(toast.message)), false);
  assert.equal(app.toasts().some((toast) => /could not sign you out/i.test(toast.message)), true);
});

test('authentication problems are shown safely and cleared when a session becomes valid', () => {
  const app = createApp();
  const controller = app.harness.accountController;
  let listener = null;
  const state = { status: 'guest', user: null };

  controller.setProvider({
    getState: () => state,
    subscribe(handler) {
      listener = handler;
      handler(state);
      return () => {};
    },
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signOut: async () => ({ ok: true })
  });

  controller.reportAuthProblem({
    code: 'link',
    message: 'This confirmation link is invalid or has expired. Request a new email and try again.'
  });

  assert.equal(controller.getState().authProblem.code, 'link');
  assert.match(app.byId('account-provider-title').textContent, /needs attention/i);
  assert.match(app.byId('account-provider-notice').textContent, /confirmation link is invalid/i);
  assert.equal(app.toasts().some((toast) => /confirmation link is invalid/i.test(toast.message)), true);

  const before = app.toasts().filter((toast) => /confirmation link is invalid/i.test(toast.message)).length;
  controller.reportAuthProblem({
    code: 'link',
    message: 'This confirmation link is invalid or has expired. Request a new email and try again.'
  });
  assert.equal(
    app.toasts().filter((toast) => /confirmation link is invalid/i.test(toast.message)).length,
    before,
    'the same problem is not toasted repeatedly'
  );

  state.status = 'signed-in';
  state.user = { email: 'student@example.com' };
  listener(state);

  assert.equal(controller.getState().authProblem, null);
  assert.match(app.byId('account-provider-title').textContent, /optional/i);
  assert.match(app.byId('account-provider-notice').textContent, /not uploaded or synced/i);
});

test('a pending sign-up keeps the guest state and asks for email confirmation', async () => {
  const app = createApp();
  const controller = app.harness.accountController;

  controller.setProvider({
    signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
    signUp: async () => ({
      ok: true,
      pending: true,
      message: 'Check your email to confirm your account, then sign in.'
    }),
    signOut: () => {}
  });

  app.byId('account-signup-email').value = 'student@example.com';
  app.byId('account-signup-password').value = 'correct-horse';
  app.byId('account-signup-confirm').value = 'correct-horse';
  const result = await controller.handleSubmit('sign-up', { preventDefault() {} });

  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(controller.getState().status, 'guest');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'guest');
  assert.equal(app.byId('account-signout-btn').hidden, true);
  assert.match(app.byId('account-signup-feedback').textContent, /confirm your account/i);
  assert.match(app.byId('account-signup-password').value, /^$/, 'the password is cleared');
});

test('an unverified offline session is shown but never reported as signed in', () => {
  const app = createApp();
  const controller = app.harness.accountController;
  let listener = null;

  controller.setProvider({
    getState: () => ({ status: 'offline-unverified', user: { email: 'student@example.com' } }),
    subscribe(handler) {
      listener = handler;
      handler({ status: 'offline-unverified', user: { email: 'student@example.com' } });
      return () => {
        listener = null;
      };
    },
    signIn: async () => ({ ok: false, code: 'offline', message: 'Offline' }),
    signUp: async () => ({ ok: false, code: 'offline', message: 'Offline' }),
    signOut: () => {}
  });

  assert.equal(controller.getState().status, 'offline-unverified');
  assert.equal(app.byId('session-chip').dataset.sessionState, 'offline-unverified');
  assert.match(app.byId('session-chip').textContent, /needs verification/i);
  assert.match(app.byId('account-session-text').textContent, /could not be verified/i);
  assert.equal(app.byId('account-signout-btn').hidden, false);

  listener({ status: 'signed-in', user: { email: 'student@example.com' } });
  assert.equal(app.byId('session-chip').dataset.sessionState, 'signed-in');
  assert.match(app.byId('account-session-text').textContent, /Signed in as/i);
});

/* ----------------------------------------------------------- export flow */

test('exporting produces a documented backup file and announces it', () => {
  const app = createApp();
  const result = app.harness.backupController.exportBackup();

  assert.equal(result.ok, true);
  assert.match(result.fileName, /^sgpa-cgpa-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const document = app.harness.backupController.buildBackupDocument();
  assert.equal(document.format, 'sgpa-cgpa-backup');
  assert.equal(document.version, 1);
  assert.equal(document.plan.semesters.length, 2);
  assert.ok(app.toasts().some((toast) => /downloaded/i.test(toast.message)));
});

test('an exported backup can be parsed and restored to the same plan', async () => {
  const app = createApp();
  const document = app.harness.backupController.buildBackupDocument();
  const text = JSON.stringify(document);

  const parsed = calc.parseBackup(text);
  assert.equal(parsed.ok, true);

  const result = await app.harness.backupController.importBackupFile(fileWith(text));
  assert.equal(result.ok, true);
  assert.equal(app.harness.appState.semesters.length, 2);
  assert.equal(app.harness.appState.selectedGradingSystem, 'standard-btech');
});

test('a malformed backup is rejected and the current plan is preserved', async () => {
  const app = createApp();
  const before = JSON.stringify(app.harness.appState.semesters);

  for (const text of ['', 'not json', JSON.stringify({ format: 'other', version: 1, plan: {} })]) {
    const result = await app.harness.backupController.importBackupFile(fileWith(text));
    assert.equal(result.ok, false, `expected "${text}" to be rejected`);
  }

  assert.equal(JSON.stringify(app.harness.appState.semesters), before, 'the plan is unchanged');
  assert.ok(app.toasts().some((toast) => /not valid JSON|not an SGPA/i.test(toast.message)));
});

test('cancelling the import leaves everything untouched', async () => {
  const app = createApp({ confirm: false });
  const before = JSON.stringify(app.harness.appState.semesters);
  const document = app.harness.backupController.buildBackupDocument();

  const result = await app.harness.backupController.importBackupFile(fileWith(JSON.stringify(document)));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cancelled');
  assert.equal(JSON.stringify(app.harness.appState.semesters), before);
});

test('a restore keeps a recoverable copy of the plan it replaced', async () => {
  const app = createApp();
  const previousRaw = app.storage.get('sgpaCgpaPwaState');
  const document = app.harness.backupController.buildBackupDocument();

  await app.harness.backupController.importBackupFile(fileWith(JSON.stringify(document)));

  assert.equal(app.storage.get('sgpaCgpaPwaStateRecovery'), previousRaw, 'the previous plan is kept verbatim');
});

test('a restore is stopped when the current plan cannot be backed up', async () => {
  const app = createApp({ storageFailsOn: (key) => key === 'sgpaCgpaPwaStateRecovery' });
  const before = JSON.stringify(app.harness.appState.semesters);
  const document = app.harness.backupController.buildBackupDocument();

  const result = await app.harness.backupController.importBackupFile(fileWith(JSON.stringify(document)));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'backup-failed');
  assert.equal(JSON.stringify(app.harness.appState.semesters), before, 'the plan is unchanged');
  assert.ok(app.toasts().some((toast) => /could not be backed up/i.test(toast.message)));
});

test('a failed write keeps the previous plan and says so', async () => {
  const app = createApp({ storageFailsOn: (key) => key === 'sgpaCgpaPwaState' });
  const before = JSON.stringify(app.harness.appState.semesters);
  const document = app.harness.backupController.buildBackupDocument();

  const result = await app.harness.backupController.importBackupFile(fileWith(JSON.stringify(document)));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write-failed');
  assert.equal(JSON.stringify(app.harness.appState.semesters), before, 'the previous plan is restored in memory');
  assert.ok(app.toasts().some((toast) => /could not be saved/i.test(toast.message)));
});

/* ------------------------------------------------------ storage recovery */
test('unreadable saved data is copied aside instead of being overwritten', () => {
  const corrupt = '{ this is not json';
  const app = createApp({ savedState: corrupt });

  assert.equal(app.harness.appState.semesters.length, 1, 'the app still starts');
  assert.equal(app.storage.get('sgpaCgpaPwaStateRecovery'), corrupt, 'the unreadable payload is kept');
  assert.ok(
    app.toasts().some((toast) => /copy was kept/i.test(toast.message)),
    'the user is told that a copy was kept'
  );
});

test('a saved structure that cannot be used is copied aside as well', () => {
  const unusable = JSON.stringify({ semesters: 'not an array' });
  const app = createApp({ savedState: unusable });

  assert.equal(app.storage.get('sgpaCgpaPwaStateRecovery'), unusable);
  assert.equal(app.harness.appState.semesters.length, 1, 'the app starts with a fresh plan');
});

test('readable saved data is not copied aside', () => {
  const app = createApp();
  assert.equal(app.storage.get('sgpaCgpaPwaStateRecovery'), undefined, 'nothing is copied for healthy data');
});

/* ----------------------------------------------------- markup guardrails */

test('the account view is shipped hidden, labelled and keyboard reachable', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(
    html,
    /<section class="account-view" id="account-view" hidden role="dialog" aria-modal="true" aria-labelledby="account-view-title">/
  );
  assert.match(html, /<h1 id="account-view-title" tabindex="-1">/);
  assert.match(html, /role="tablist" aria-label="Account form"/);
  assert.match(html, /role="tab" aria-selected="true" aria-controls="account-panel-signin"/);
  assert.match(html, /role="tab" aria-selected="false" aria-controls="account-panel-signup"/);
  assert.match(html, /role="tabpanel" aria-labelledby="account-tab-signin"/);
  assert.match(html, /role="tabpanel" aria-labelledby="account-tab-signup"/);
  assert.match(html, /<button type="button" class="account-tab" id="account-tab-signup"[^>]*tabindex="-1"/);
  assert.match(html, /id="account-close-btn"[^>]*>Back to calculator</);

  // every password input is masked and every field has a label
  for (const id of ['account-signin-password', 'account-signup-password', 'account-signup-confirm']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="password"`), `${id} must be masked`);
  }
  for (const id of ['account-signin-email', 'account-signin-password', 'account-signup-email', 'account-signup-password', 'account-signup-confirm']) {
    assert.match(html, new RegExp(`<label for="${id}">`), `${id} needs a label`);
  }
  for (const id of ['account-signin-email', 'account-signin-password', 'account-signup-email', 'account-signup-password', 'account-signup-confirm']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-describedby=`), `${id} needs a described error`);
  }
});

test('the account interface never claims a password is stored or sent', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /no authentication provider is configured/i);
  assert.match(html, /Nothing you type here is sent anywhere or stored on this device/i);
  assert.equal(/type="password"[^>]*autocomplete="new-password"[^>]*value=/.test(html), false, 'no password value is pre-filled');
});

test('the backup controls are present and accept JSON only', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /id="export-backup-btn"/);
  assert.match(html, /id="import-backup-btn"/);
  assert.match(html, /id="import-backup-input" type="file" accept="application\/json,\.json"/);
  assert.match(html, /id="data-panel"|id="data"/);
  assert.match(html, /Backups contain your semester plan only/);
});

test('the new markup adds no external reference', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const external = [...html.matchAll(/https?:\/\/[^"'\s)]+/g)].map((match) => match[0]);
  const unique = [...new Set(external)];

  assert.deepEqual(unique, [], 'the application loads no external resource');
});
