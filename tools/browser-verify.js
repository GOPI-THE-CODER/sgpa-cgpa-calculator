'use strict';

/**
 * Reproducible browser verification for the SGPA & CGPA Calculator.
 *
 * Uses only tools that are already installed locally: a Chromium-family browser
 * (Chrome or Edge) driven through the Chrome DevTools Protocol over Node's
 * built-in WebSocket. No package is installed, no external site is contacted,
 * and nothing in the application is modified: the script only reads state and
 * drives the UI the way a user would.
 *
 *   node tools/browser-verify.js [--out <dir>] [--port <n>] [--keep-artifacts]
 *
 * Exit codes
 *   0  every check that could run passed
 *   1  at least one check failed
 *   2  no usable browser (or a required capability) was available, so nothing ran
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodePng, contrastRatio, medianColour, parseColour } = require('./png.js');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';

const WINDOWS_BROWSERS = [
  { name: 'Chrome', bin: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Chrome', bin: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
  { name: 'Edge', bin: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Edge', bin: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' }
];

const POSIX_BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

const THEMES = [
  'premium-navy',
  'light',
  'red-black',
  'electric-blue',
  'cyber-magenta',
  'acid-green',
  'violet-grid',
  'orange-pulse'
];

const VIEWPORTS = [375, 768, 1440];

const CONTRAST_VIEWPORTS = [1440, 375];

/** Text that must meet WCAG 1.4.3 (4.5:1, or 3:1 when the text is large). */
const TEXT_TARGETS = [
  { selector: '.hero-panel h1', label: 'dashboard title' },
  { selector: '.eyebrow', label: 'hero eyebrow' },
  { selector: '.card-label', label: 'KPI card label' },
  { selector: '.summary-card h2', label: 'KPI value' },
  { selector: '.card-text', label: 'KPI supporting text' },
  { selector: '.hero-copy', label: 'hero supporting text' },
  { selector: '.panel-header p', label: 'panel supporting text' },
  { selector: '.metric-row span', label: 'report metric label' },
  { selector: '.metric-row strong', label: 'report metric value' },
  { selector: '.trend-title', label: 'trend chart title' },
  { selector: '.trend-subtitle', label: 'trend chart subtitle' },
  { selector: '.semester-meta small', label: 'semester meta text' },
  { selector: '.subject-cell label', label: 'subject field label' },
  { selector: '.field-error:not([hidden])', label: 'validation message' },
  { selector: '#validation-banner', label: 'incomplete-results banner' },
  { selector: '.row-action', label: 'remove-subject label' },
  { selector: '#export-btn', label: 'print report label' },
  { selector: '#share-btn', label: 'copy summary label' },
  { selector: '#reset-all-btn', label: 'reset all label' },
  { selector: '#top-add-semester-btn', label: 'add semester label' },
  { selector: '#top-add-subject-btn', label: 'add subject label' },
  { selector: '#top-delete-semester-btn', label: 'delete semester label' },
  { selector: '.nav-pill.active', label: 'active navigation label' },
  { selector: '.nav-pill:not(.active)', label: 'inactive navigation label' },
  { selector: '.semester-tab.active', label: 'active semester tab label' }
];

/** Component boundaries that must meet WCAG 1.4.11 (3:1). */
const BOUNDARY_TARGETS = [
  { selector: '.subject-row input', label: 'subject input border', against: 'interior' },
  { selector: '.subject-row select', label: 'subject select border', against: 'interior' },
  { selector: '#share-btn', label: 'outline button border', against: 'exterior' },
  { selector: '.subject-row input[aria-invalid="true"]', label: 'invalid input border', against: 'interior' }
];

/**
 * Hovered button labels that must stay readable. The generic hover rule once
 * replaced the primary gradient with a translucent surface, leaving the white
 * label effectively blank in the light theme; this measures the real hover state.
 */
const HOVER_TARGETS = [
  { selector: '#export-btn', label: 'primary button hover label' },
  { selector: '#share-btn', label: 'outline button hover label' },
  { selector: '#reset-all-btn', label: 'secondary button hover label' }
];

/** Focus indicators that must meet WCAG 1.4.11 / 2.4.11 (3:1). */
const FOCUS_TARGETS = [
  { selector: '#theme-picker', label: 'theme select' },
  { selector: '#export-btn', label: 'primary button' },
  { selector: '#share-btn', label: 'outline button' },
  { selector: '.nav-pill.active', label: 'navigation link' },
  { selector: '.subject-row input', label: 'text input' }
];

/**
 * Toast variants that must meet WCAG 1.4.3 (4.5:1). The clipboard is stubbed
 * so the copy action produces a deterministic success or error toast.
 */
const TOAST_VARIANTS = [
  { name: 'success', clipboard: 'Promise.resolve()' },
  { name: 'error', clipboard: "Promise.reject(new Error('clipboard blocked for the check'))" }
];

const CONTRAST_STATE = {
  semesters: [
    {
      id: 's1',
      title: 'Semester 1',
      subjects: [
        { id: 'a1', name: 'Mathematics', grade: 'S', credit: 4 },
        { id: 'a2', name: 'Physics', grade: 'A', credit: 3 }
      ]
    },
    {
      id: 's2',
      title: 'Semester 2 (flagged)',
      subjects: [
        { id: 'b1', name: 'Bad Credit', grade: 'S', credit: 'abc' },
        { id: 'b2', name: 'Unsupported Grade', grade: 'O', credit: 3 }
      ]
    }
  ],
  selectedSemesterId: 's2',
  selectedGradingSystem: 'standard-btech'
};

const STORAGE_FAILURE_STUB = `
  (() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sgpaCgpaPwaState' || key === 'sgpaCgpaTheme' || key === 'sgpaCgpaGradingSystem') {
        const error = new Error('QuotaExceededError: storage is full');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return original.call(this, key, value);
    };
  })();
`;

/* ------------------------------------------------------------------ utils */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {
    out: path.join(os.tmpdir(), 'sgpa-cgpa-browser-verify'),
    port: 8123,
    debugPort: 9334,
    keepArtifacts: false,
    browser: null,
    contrastOnly: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = path.resolve(argv[++i] || options.out);
    else if (arg === '--port') options.port = Number(argv[++i]) || options.port;
    else if (arg === '--debug-port') options.debugPort = Number(argv[++i]) || options.debugPort;
    else if (arg === '--browser') options.browser = path.resolve(argv[++i] || '');
    else if (arg === '--contrast-only') options.contrastOnly = true;
    else if (arg === '--keep-artifacts') options.keepArtifacts = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node tools/browser-verify.js [--out <dir>] [--port <n>] [--debug-port <n>] [--browser <path>] [--contrast-only] [--keep-artifacts]');
      process.exit(0);
    }
  }
  return options;
}

function findBrowser() {
  for (const candidate of WINDOWS_BROWSERS) {
    if (fs.existsSync(candidate.bin)) return candidate;
  }
  for (const name of POSIX_BROWSERS) {
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    const found = String(which.stdout || '').split(/\r?\n/).find(Boolean);
    if (which.status === 0 && found) return { name, bin: found };
  }
  return null;
}

/* ------------------------------------------------------------------- CDP */

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = () => resolve();
      this.socket.onerror = (event) => reject(new Error(`WebSocket error: ${event && event.message}`));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        (this.listeners.get(message.method) || []).forEach((handler) => handler(message.params));
      }
    };
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`page evaluation failed: ${(details.exception && details.exception.description) || details.text}`);
    }
    return result.result.value;
  }

  close() {
    try {
      this.socket.close();
    } catch (error) {
      /* the socket may already be closed */
    }
  }
}

async function waitForPort(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return true;
    } catch (error) {
      /* not up yet */
    }
    await sleep(200);
  }
  return false;
}

/* -------------------------------------------------------------- processes */

function startServer(port) {
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'server.js'))}).startServer(${port})`], {
    cwd: ROOT,
    stdio: 'ignore'
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, sleep(3000)]);
}

/* ---------------------------------------------------------------- results */

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  return status === 'pass';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

/* ----------------------------------------------------------------- checks */

async function waitForApp(cdp) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const ready = await cdp.evaluate(
        "document.readyState === 'complete' && !!document.getElementById('semester-list') && document.getElementById('semester-list').children.length > 0"
      );
      if (ready) return true;
    } catch (error) {
      /* the page is still navigating */
    }
    await sleep(200);
  }
  return false;
}

async function checkStartup(cdp, appUrl) {
  await cdp.send('Page.navigate', { url: appUrl });
  const ready = await waitForApp(cdp);
  assert(ready, 'the dashboard did not render within the timeout');

  const state = await cdp.evaluate(`(() => ({
    title: document.title,
    kpiCards: document.querySelectorAll('.summary-card').length,
    tabs: document.querySelectorAll('.semester-tab').length,
    rows: document.querySelectorAll('#semester-list .subject-row').length,
    trendSvg: !!document.querySelector('#trend-chart svg'),
    metricRows: document.querySelectorAll('#report .metric-row').length,
    navPills: document.querySelectorAll('.bottom-nav .nav-pill').length,
    cgpa: (document.getElementById('overall-cgpa') || {}).textContent
  }))()`);

  assert(state.title.includes('SGPA & CGPA Calculator'), `unexpected title: ${state.title}`);
  assert(state.kpiCards === 5, `expected 5 KPI cards, found ${state.kpiCards}`);
  assert(state.tabs >= 1, 'no semester tabs rendered');
  assert(state.rows >= 1, 'the semester editor rendered no subject rows');
  assert(state.trendSvg, 'the trend chart did not render');
  assert(state.metricRows === 4, `expected 4 report metric rows, found ${state.metricRows}`);
  assert(state.navPills === 3, `expected 3 navigation pills, found ${state.navPills}`);
  assert(/^\d+\.\d{2}$/.test(state.cgpa || ''), `the CGPA value looks wrong: ${state.cgpa}`);

  return state;
}

async function checkThemesAndViewports(cdp, outDir) {
  const perTheme = [];

  for (const theme of THEMES) {
    await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(500);

    const applied = await cdp.evaluate('document.documentElement.dataset.theme');
    assert(applied === theme, `theme ${theme} did not apply (got ${applied})`);

    const measurements = {};
    for (const width of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 760
      });
      await sleep(300);

      measurements[width] = await cdp.evaluate(`(() => {
        const innerWidth = window.innerWidth;
        const offenders = [];
        for (const el of [...document.querySelectorAll('body *')]) {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = getComputedStyle(el);
          if (style.position === 'fixed' || style.display === 'none' || style.visibility === 'hidden') continue;
          if (rect.right > innerWidth + 1 || rect.left < -1) {
            offenders.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
          }
        }
        const grid = getComputedStyle(document.querySelector('.summary-grid')).gridTemplateColumns;
        const pills = [...document.querySelectorAll('.bottom-nav .nav-pill')];
        return {
          hScroll: document.documentElement.scrollWidth > innerWidth + 1,
          offenders,
          kpiColumns: grid.split(' ').length,
          navRows: new Set(pills.map((p) => Math.round(p.getBoundingClientRect().top))).size,
          activeNav: !!document.querySelector('.nav-pill.active')
        };
      })()`);

      assert(!measurements[width].hScroll, `horizontal scroll appeared at ${width}px in ${theme}`);
      assert(measurements[width].offenders.length === 0, `elements overflow the viewport at ${width}px in ${theme}: ${measurements[width].offenders.slice(0, 3).join(', ')}`);
      assert(measurements[width].activeNav, `the active navigation item was lost at ${width}px in ${theme}`);
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
    fs.writeFileSync(path.join(outDir, `theme-${theme}.png`), Buffer.from(shot.data, 'base64'));

    perTheme.push({ theme, measurements });
  }

  return perTheme;
}

async function checkStorageFailure(cdp, appUrl) {
  const exceptions = [];
  const onException = (params) => {
    const details = params.exceptionDetails || {};
    exceptions.push((details.exception && (details.exception.description || details.exception.value)) || details.text);
  };
  cdp.on('Runtime.exceptionThrown', onException);

  const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_FAILURE_STUB });
  await cdp.send('Page.navigate', { url: appUrl });
  const ready = await waitForApp(cdp);
  assert(ready, 'the app did not render while browser storage refused writes');

  const state = await cdp.evaluate(`(() => {
    const input = document.querySelector('.subject-row .subject-name');
    const before = input ? input.value : null;
    if (input) {
      input.value = 'Edited while storage fails';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return {
      rows: document.querySelectorAll('#semester-list .subject-row').length,
      before,
      after: input ? input.value : null,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim()),
      storageWarnings: [...document.querySelectorAll('.toast')].filter((t) => /storage/i.test(t.textContent)).length
    };
  })()`);

  assert(state.rows >= 1, 'the semester editor did not render while storage refused writes');
  assert(exceptions.length === 0, `uncaught errors while storage refused writes: ${exceptions[0]}`);
  assert(state.storageWarnings === 1, `expected exactly one storage warning, saw ${state.storageWarnings}`);
  assert(/cannot be saved in this session/i.test(state.toasts.find((t) => /storage/i.test(t)) || ''), 'the storage warning does not say the session only');
  assert(state.after === 'Edited while storage fails', 'in-memory editing stopped working when storage failed');

  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier });
  // Removing the injected script only stops future injections; the current
  // document still has the patched Storage prototype, so reload into a clean one.
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForApp(cdp);
  return { rows: state.rows, warnings: state.storageWarnings, uncaught: exceptions.length };
}

async function checkSubjectsAndPersistence(cdp, appUrl) {
  const before = await cdp.evaluate("document.querySelectorAll('#semester-list .subject-row').length");

  await cdp.evaluate("document.getElementById('top-add-subject-btn').click(); true");
  await sleep(400);
  const afterAdd = await cdp.evaluate("document.querySelectorAll('#semester-list .subject-row').length");
  assert(afterAdd === before + 1, `adding a subject did not add a row (${before} -> ${afterAdd})`);

  await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#semester-list .subject-row')];
    rows[rows.length - 1].querySelector('.row-action').click();
    return true;
  })()`);
  await sleep(400);
  const afterRemove = await cdp.evaluate("document.querySelectorAll('#semester-list .subject-row').length");
  assert(afterRemove === before, `removing a subject did not remove a row (${before} -> ${afterRemove})`);

  // reduce to a single subject, then try to remove the last one
  const guard = await cdp.evaluate(`(async () => {
    for (let i = 0; i < 10; i += 1) {
      const rows = [...document.querySelectorAll('#semester-list .subject-row')];
      if (rows.length <= 1) break;
      rows[rows.length - 1].querySelector('.row-action').click();
      await new Promise((r) => setTimeout(r, 250));
    }
    const rows = [...document.querySelectorAll('#semester-list .subject-row')];
    rows[0].querySelector('.row-action').click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      rows: document.querySelectorAll('#semester-list .subject-row').length,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim())
    };
  })()`);
  assert(guard.rows === 1, `the last subject was removed (${guard.rows} rows left)`);
  assert(
    guard.toasts.some((toast) => /at least one subject/i.test(toast)),
    'the minimum-subject safeguard was not announced'
  );

  // edit and reload
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.subject-row .subject-name');
    input.value = 'Persisted Subject';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForApp(cdp);
  const restored = await cdp.evaluate("document.querySelector('.subject-row .subject-name').value");
  assert(restored === 'Persisted Subject', `the edit did not survive a reload (got "${restored}")`);

  return { before, afterAdd, afterRemove, guardRows: guard.rows, restored };
}

async function checkServiceWorkerAndOffline(cdp, appUrl, serverControl) {
  const registration = await cdp.evaluate(`(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      supported: true,
      scope: reg ? reg.scope : null,
      scriptURL: reg && reg.active ? reg.active.scriptURL : null,
      state: reg && reg.active ? reg.active.state : null
    };
  })()`);

  if (!registration.supported) {
    return { supported: false, reason: 'the browser exposes no service worker API' };
  }
  assert(registration.state === 'activated', `the service worker is not activated (state: ${registration.state})`);

  const cache = await cdp.evaluate(`(async () => {
    const names = await caches.keys();
    const details = {};
    for (const name of names) {
      const store = await caches.open(name);
      details[name] = (await store.keys()).map((request) => new URL(request.url).pathname);
    }
    return { names, details };
  })()`);
  assert(cache.names.length >= 1, 'the service worker created no cache');
  const cached = cache.details[cache.names[0]] || [];
  assert(cached.includes('/index.html') || cached.includes('/'), 'the app shell is not cached');
  assert(cached.some((entry) => entry.endsWith('styles.css')), 'the stylesheet is not cached');
  assert(cached.some((entry) => entry.endsWith('script.js')), 'the application script is not cached');

  const manifest = await cdp.evaluate(`(async () => {
    const response = await fetch('manifest.json');
    const data = await response.json();
    return { name: data.name, display: data.display, icons: data.icons.length, startUrl: data.start_url };
  })()`);
  assert(manifest.name && manifest.display, 'the web app manifest is incomplete');

  // genuine offline: stop the origin, reload, then restore
  await serverControl.stop();
  const unreachable = !(await waitForPort(appUrl, 4000));
  assert(unreachable, 'the origin server was still reachable, the offline check would be meaningless');

  await cdp.send('Page.navigate', { url: appUrl });
  await sleep(3000);
  const offline = await cdp.evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0] || {};
    return {
      title: document.title,
      kpiCards: document.querySelectorAll('.summary-card').length,
      rows: document.querySelectorAll('#semester-list .subject-row').length,
      transferSize: navigation.transferSize,
      deliveryType: navigation.deliveryType
    };
  })()`);
  await serverControl.start();

  assert(offline.kpiCards === 5, `the offline reload lost the KPI cards (${offline.kpiCards})`);
  assert(offline.rows >= 1, 'the offline reload lost the semester editor');
  assert(offline.transferSize === 0, `the offline reload was not served from the cache (transferSize ${offline.transferSize})`);

  return { registration, cacheNames: cache.names, cachedEntries: cached.length, manifest, offline };
}

async function checkKeyboardAndAccessibility(cdp) {
  await cdp.send('Accessibility.enable');
  await cdp.evaluate('document.body.focus(); true');

  const stops = [];
  for (let i = 0; i < 40; i += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(60);
    const stop = await cdp.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        focusVisible: el.matches(':focus-visible'),
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow
      };
    })()`);
    if (!stop) continue;
    stops.push(stop);
    if (stops.length >= 30) break;
  }

  assert(stops.length > 10, `only ${stops.length} tab stops were reachable`);
  const withoutFocusVisible = stops.filter((stop) => !stop.focusVisible);
  assert(withoutFocusVisible.length === 0, `${withoutFocusVisible.length} focused controls did not match :focus-visible`);
  const withoutIndicator = stops.filter(
    (stop) => !((parseFloat(stop.outlineWidth) > 0 && stop.outlineStyle !== 'none') || (stop.boxShadow && stop.boxShadow !== 'none'))
  );
  assert(withoutIndicator.length === 0, `${withoutIndicator.length} focused controls showed no focus indicator`);

  const tree = await cdp.send('Accessibility.getFullAXTree');
  const interactive = tree.nodes.filter((node) => ['button', 'link', 'combobox', 'textbox', 'spinbutton'].includes(node.role && node.role.value));
  const unnamed = interactive.filter((node) => !node.name || !node.name.value.trim());
  assert(unnamed.length === 0, `${unnamed.length} interactive controls have no accessible name`);

  const figure = tree.nodes.find((node) => node.role && node.role.value === 'figure');
  const table = tree.nodes.find((node) => node.role && node.role.value === 'table');
  assert(figure && figure.name && figure.name.value.trim(), 'the trend figure has no accessible name');
  assert(table && table.name && table.name.value.trim(), 'the accessible trend table has no accessible name');

  return {
    tabStops: stops.length,
    focusVisible: stops.every((stop) => stop.focusVisible),
    interactiveNodes: interactive.length,
    unnamedInteractive: unnamed.length,
    figureName: figure.name.value,
    tableName: table.name.value
  };
}

/* --------------------------------------------------------- account access */

/**
 * The account interface must be complete and honest: a masked password, a
 * labelled form, inline validation, and a clear statement that no
 * authentication provider is configured. It must never claim a session.
 */
async function checkAccountInterface(cdp) {
  await cdp.evaluate("document.getElementById('account-btn').click(); true");
  await sleep(450);

  const view = await cdp.evaluate(`(() => {
    const view = document.getElementById('account-view');
    const shell = document.querySelector('.app-shell');
    const tab = document.getElementById('account-tab-signin');
    const panel = document.getElementById('account-panel-signin');
    const password = document.getElementById('account-signin-password');
    const toggle = document.getElementById('account-signin-password-toggle');
    const label = document.querySelector('label[for="account-signin-email"]');
    const notice = document.querySelector('.account-notice');
    return {
      viewVisible: !view.hidden,
      viewRole: view.getAttribute('role'),
      ariaModal: view.getAttribute('aria-modal'),
      focusAfterOpen: document.activeElement ? document.activeElement.id : '',
      shellHidden: Boolean(shell && shell.hidden),
      tabRole: tab.getAttribute('role'),
      tabSelected: tab.getAttribute('aria-selected'),
      hasTablist: Boolean(document.querySelector('[role="tablist"]')),
      panelRole: panel.getAttribute('role'),
      panelLabelled: panel.getAttribute('aria-labelledby'),
      passwordType: password.type,
      togglePressed: toggle.getAttribute('aria-pressed'),
      emailLabel: label ? label.textContent.trim() : '',
      chipState: document.getElementById('session-chip').dataset.sessionState,
      notice: notice ? notice.textContent.replace(/\\s+/g, ' ').trim() : ''
    };
  })()`);

  assert(view.viewVisible, 'the account view did not open');
  assert(view.viewRole === 'dialog', 'the account view does not expose its dialog role');
  assert(view.ariaModal === 'true', 'the account view does not report that it is modal');
  assert(view.focusAfterOpen === 'account-view-title', 'the focus was not moved into the account view');
  assert(view.shellHidden, 'the calculator stayed visible behind the account view');
  assert(view.tabRole === 'tab', 'the account forms are not exposed as tabs');
  assert(view.tabSelected === 'true', 'the sign-in tab is not selected');
  assert(view.hasTablist, 'the account forms are not wrapped in a tab list');
  assert(view.panelRole === 'tabpanel', 'the account form is not a tab panel');
  assert(view.panelLabelled, 'the account panel is not labelled by its tab');
  assert(view.passwordType === 'password', 'the password field is not masked');
  assert(view.togglePressed === 'false', 'the show control does not report its state');
  assert(view.emailLabel.length > 0, 'the email field has no label');
  assert(view.chipState === 'guest', 'the session chip does not show the guest state');
  assert(/no authentication provider is configured/i.test(view.notice), 'the missing provider is not stated');

  // Tab must cycle inside the modal account view, never into the hidden page.
  const tabEscapes = [];
  for (let press = 0; press < 10; press += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(50);
    tabEscapes.push(
      await cdp.evaluate(`(() => {
        const active = document.activeElement;
        return {
          id: active ? active.id : '',
          inside: Boolean(active && active.closest && active.closest('#account-view'))
        };
      })()`)
    );
  }
  const escapedTabs = tabEscapes.filter((step) => !step.inside);
  assert(escapedTabs.length === 0, `Tab left the account view and reached ${escapedTabs.map((step) => step.id || 'an unnamed node').join(', ')}`);

  await cdp.evaluate("document.getElementById('account-signin-password-toggle').click(); true");
  await sleep(200);
  const revealed = await cdp.evaluate("document.getElementById('account-signin-password').type");
  assert(revealed === 'text', 'the show control did not reveal the password');
  await cdp.evaluate("document.getElementById('account-signin-password-toggle').click(); true");
  await sleep(150);

  await cdp.evaluate("document.getElementById('account-signin-submit').click(); true");
  await sleep(350);
  const invalid = await cdp.evaluate(`(() => ({
    emailError: (document.getElementById('account-signin-email-error') || {}).textContent || '',
    emailInvalid: document.getElementById('account-signin-email').getAttribute('aria-invalid'),
    feedback: (document.getElementById('account-signin-feedback') || {}).textContent || ''
  }))()`);
  assert(/email/i.test(invalid.emailError), 'an empty form did not report the missing email');
  assert(invalid.emailInvalid === 'true', 'the invalid field is not marked');

  await cdp.evaluate(`(() => {
    const email = document.getElementById('account-signin-email');
    const password = document.getElementById('account-signin-password');
    email.value = 'student@example.com';
    password.value = 'correct-horse-battery';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('account-signin-submit').click();
    return true;
  })()`);
  await sleep(700);
  const submitted = await cdp.evaluate(`(() => {
    const feedback = document.getElementById('account-signin-feedback');
    return {
      feedback: feedback.textContent || '',
      tone: feedback.dataset.tone || '',
      chipState: document.getElementById('session-chip').dataset.sessionState,
      signOutHidden: document.getElementById('account-signout-btn').hidden,
      toasts: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent.replace(/\\s+/g, ' ').trim())
    };
  })()`);

  assert(/no authentication provider is configured/i.test(submitted.feedback), 'the form did not report the missing provider');
  assert(submitted.tone === 'error', 'the failure is not marked as an error');
  assert(submitted.chipState === 'guest', 'a session was claimed without a provider');
  assert(submitted.signOutHidden === true, 'a sign-out control is offered without a session');
  assert(
    submitted.toasts.some((toast) => /no authentication provider/i.test(toast)),
    'the failure was not announced'
  );

  const stored = await cdp.evaluate(`(() => {
    const keys = Object.keys(localStorage);
    return {
      keys,
      leaked: keys.some((key) => /correct-horse-battery/.test(String(localStorage.getItem(key))))
    };
  })()`);
  assert(stored.leaked === false, 'the password reached browser storage');

  await cdp.evaluate("document.getElementById('account-close-btn').click(); true");
  await sleep(350);
  const closed = await cdp.evaluate(`(() => ({
    viewHidden: document.getElementById('account-view').hidden,
    shellHidden: Boolean(document.querySelector('.app-shell').hidden),
    focusId: document.activeElement ? document.activeElement.id : ''
  }))()`);
  assert(closed.viewHidden === true, 'the account view did not close');
  assert(closed.shellHidden === false, 'the calculator did not come back');
  assert(closed.focusId === 'account-btn', 'the focus did not return to the account button');

  // Escape closes the view and restores the focus as well.
  await cdp.evaluate("document.getElementById('account-btn').click(); true");
  await sleep(300);
  await cdp.evaluate("document.getElementById('account-view-title').focus(); true");
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
  const escaped = await cdp.evaluate(`(() => ({
    viewHidden: document.getElementById('account-view').hidden,
    shellHidden: Boolean(document.querySelector('.app-shell').hidden),
    focusId: document.activeElement ? document.activeElement.id : ''
  }))()`);
  assert(escaped.viewHidden === true, 'Escape did not close the account view');
  assert(escaped.shellHidden === false, 'the calculator did not come back after Escape');
  assert(escaped.focusId === 'account-btn', 'the focus did not return to the account button after Escape');

  return {
    providerMessage: submitted.feedback.trim().slice(0, 64),
    validationMessage: invalid.emailError.trim(),
    storedKeys: stored.keys.length
  };
}

/**
 * A live Supabase project is not available. Exercise the same controller code
 * in the real page with a provider that rejects sign-out and reports a bad
 * callback, so the browser verifies the failure UI rather than only the unit
 * stub.
 */
async function checkMockedAuthFailures(cdp) {
  const result = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const state = { status: 'signed-in', user: { email: 'student@example.com' } };
    const provider = {
      getState: () => state,
      subscribe(handler) {
        handler(state);
        return () => {};
      },
      signIn: async () => ({ ok: false, code: 'unused', message: 'unused' }),
      signUp: async () => ({ ok: false, code: 'unused', message: 'unused' }),
      signOut: () => new Promise((resolve) => setTimeout(() => resolve({
        ok: false,
        code: 'sign-out-failed',
        message: 'We could not sign you out. Your session may still be active. Please try again.'
      }), 120))
    };

    accountController.setProvider(provider);
    document.getElementById('account-btn').click();
    await wait(80);
    const button = document.getElementById('account-signout-btn');
    const before = {
      hidden: button.hidden,
      disabled: button.disabled,
      chip: document.getElementById('session-chip').dataset.sessionState
    };

    button.click();
    await wait(20);
    const during = {
      disabled: button.disabled,
      chip: document.getElementById('session-chip').dataset.sessionState
    };

    await wait(240);
    const after = {
      disabled: button.disabled,
      hidden: button.hidden,
      chip: document.getElementById('session-chip').dataset.sessionState,
      messages: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent.replace(/\\s+/g, ' ').trim())
    };

    accountController.reportAuthProblem({
      code: 'link',
      message: 'This confirmation link is invalid or has expired. Request a new email and try again.'
    });
    const problem = {
      code: accountController.getState().authProblem && accountController.getState().authProblem.code,
      title: document.getElementById('account-provider-title').textContent,
      notice: document.getElementById('account-provider-notice').textContent,
      messages: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent.replace(/\\s+/g, ' ').trim())
    };

    accountController.setProvider(null);
    document.querySelectorAll('.toast').forEach((toast) => toast.remove());
    document.getElementById('account-close-btn').click();
    return { before, during, after, problem };
  })()`);

  assert(result.before.hidden === false, 'a signed-in mock did not expose the sign-out control');
  assert(result.before.disabled === false, 'the sign-out control started disabled');
  assert(result.during.disabled === true, 'the sign-out control was not disabled while the provider was working');
  assert(result.after.disabled === false, 'the sign-out control stayed disabled after the failure');
  assert(result.after.hidden === false, 'a failed sign-out hid the session control');
  assert(result.after.chip === 'signed-in', 'a failed sign-out cleared the session state');
  assert(
    result.after.messages.some((message) => /could not sign you out/i.test(message)),
    'the sign-out failure was not announced'
  );
  assert(
    result.after.messages.some((message) => /^Signed out\./.test(message)) === false,
    'a failed sign-out showed a success message'
  );

  assert(result.problem.code === 'link', 'the callback problem was not recorded');
  assert(/needs attention/i.test(result.problem.title), 'the provider notice does not show the problem');
  assert(/confirmation link is invalid/i.test(result.problem.notice), 'the callback problem is not explained');
  assert(
    result.problem.messages.some((message) => /confirmation link is invalid/i.test(message)),
    'the callback problem was not announced'
  );

  return {
    signOutDisabledInFlight: result.during.disabled,
    sessionPreserved: result.after.chip,
    callbackProblem: result.problem.code,
    successMessages: result.after.messages.filter((message) => /^Signed out\./.test(message)).length
  };
}

/* ------------------------------------------------------------- backups */

async function checkBackupRoundTrip(cdp, outDir) {
  const downloadDir = path.join(outDir, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  for (const file of fs.readdirSync(downloadDir)) {
    fs.rmSync(path.join(downloadDir, file), { force: true });
  }

  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  } catch (error) {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  }

  const originalName = await cdp.evaluate("document.querySelector('.subject-row .subject-name').value");
  await cdp.evaluate("document.getElementById('export-backup-btn').click(); true");
  await sleep(1400);

  const files = fs.readdirSync(downloadDir).filter((name) => name.endsWith('.json'));
  assert(files.length === 1, `expected exactly one backup file, found ${files.length}`);
  const fileName = files[0];
  assert(/^sgpa-cgpa-backup-\d{4}-\d{2}-\d{2}\.json$/.test(fileName), 'the backup file name is not sensible');

  const backupPath = path.join(downloadDir, fileName);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert(backup.format === 'sgpa-cgpa-backup', 'the backup does not declare its format');
  assert(backup.version === 1, 'the backup does not declare its version');
  assert(Array.isArray(backup.plan.semesters), 'the backup does not contain a plan');
  assert(
    JSON.stringify(backup).toLowerCase().includes('password') === false,
    'the backup must not contain account material'
  );

  // change the plan, then restore it from the backup
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.subject-row .subject-name');
    input.value = 'Changed after the export';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const changedName = await cdp.evaluate("document.querySelector('.subject-row .subject-name').value");
  assert(changedName === 'Changed after the export', 'the plan could not be changed for the round trip');

  const document_ = await cdp.send('DOM.getDocument');
  const inputNode = await cdp.send('DOM.querySelector', { nodeId: document_.root.nodeId, selector: '#import-backup-input' });
  assert(inputNode.nodeId, 'the import control is missing');
  await cdp.send('DOM.setFileInputFiles', { files: [backupPath], nodeId: inputNode.nodeId });
  await sleep(700);

  const dialog = await cdp.evaluate(`(() => {
    const open = document.querySelector('.dialog-backdrop');
    return { open: Boolean(open && !open.hidden), title: (document.querySelector('.dialog-title') || {}).textContent || '' };
  })()`);
  assert(dialog.open, 'the import did not ask for confirmation');
  assert(/replace/i.test(dialog.title), 'the confirmation does not describe the change');

  await cdp.evaluate("document.querySelector('[data-dialog-action=\"confirm\"]').click(); true");
  await sleep(900);
  const restoredName = await cdp.evaluate("document.querySelector('.subject-row .subject-name').value");
  assert(restoredName === originalName, `the import did not restore the plan (${restoredName})`);

  // a malformed file is rejected and changes nothing
  const brokenPath = path.join(downloadDir, 'broken-backup.json');
  fs.writeFileSync(brokenPath, '{ not valid json', 'utf8');
  const before = await cdp.evaluate("document.querySelector('.subject-row .subject-name').value");

  const document2 = await cdp.send('DOM.getDocument');
  const inputNode2 = await cdp.send('DOM.querySelector', { nodeId: document2.root.nodeId, selector: '#import-backup-input' });
  await cdp.send('DOM.setFileInputFiles', { files: [brokenPath], nodeId: inputNode2.nodeId });
  await sleep(800);

  const after = await cdp.evaluate(`(() => ({
    name: document.querySelector('.subject-row .subject-name').value,
    dialogOpen: Boolean(document.querySelector('.dialog-backdrop') && !document.querySelector('.dialog-backdrop').hidden),
    toasts: [...document.querySelectorAll('.toast')].map((toast) => toast.textContent.replace(/\\s+/g, ' ').trim())
  }))()`);
  assert(after.name === before, 'a rejected import changed the plan');
  assert(after.dialogOpen === false, 'a rejected import still asked for confirmation');
  assert(
    after.toasts.some((toast) => /not valid JSON/i.test(toast)),
    `the rejection was not explained: ${after.toasts.join(' | ')}`
  );

  return { fileName, restored: restoredName, rejectedWithoutChange: after.name === before };
}

/* ------------------------------------------------------------- hero layout */

/**
 * The hero title and its supporting copy must never be painted under the
 * header controls. This compares the rendered text runs of both against the
 * rectangles of the visible controls, and also reports text that overflows
 * its own box, which is how the collision first appeared.
 *
 * @param {number} tolerance sub-pixel tolerance in CSS pixels
 */
async function measureHeroOverlap(cdp, width, tolerance) {
  return cdp.evaluate(`(() => {
    const tolerance = ${tolerance};
    const panel = document.querySelector('.hero-panel');
    const title = document.querySelector('.hero-panel h1');
    const copy = document.querySelector('.hero-copy');
    const actions = document.querySelector('.header-actions');
    if (!panel || !title || !copy || !actions) return { available: false };

    const isVisible = (node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const controls = [...actions.querySelectorAll('button, select, span, a')].filter(isVisible);
    const textRuns = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    };

    const collisions = [];
    for (const [label, node] of [['title', title], ['supporting copy', copy]]) {
      for (const run of textRuns(node)) {
        for (const control of controls) {
          const box = control.getBoundingClientRect();
          const overlapX = Math.min(run.right, box.right) - Math.max(run.left, box.left);
          const overlapY = Math.min(run.bottom, box.bottom) - Math.max(run.top, box.top);
          if (overlapX > tolerance && overlapY > tolerance) {
            collisions.push({
              part: label,
              control: control.id || control.tagName.toLowerCase(),
              overlapPx: Math.round(overlapX)
            });
          }
        }
      }
    }

    const brand = document.querySelector('.hero-brand');
    const brandBox = brand ? brand.getBoundingClientRect() : null;
    const actionBox = actions.getBoundingClientRect();
    // The two blocks only collide when they overlap on both axes. In the
    // stacked layout they share a column but not a row, which is not a
    // collision.
    const boxOverlap = brandBox
      ? Math.min(
          Math.min(brandBox.right, actionBox.right) - Math.max(brandBox.left, actionBox.left),
          Math.min(brandBox.bottom, actionBox.bottom) - Math.max(brandBox.top, actionBox.top)
        )
      : 0;

    return {
      available: true,
      collisions,
      titleOverflowPx: Math.max(0, title.scrollWidth - title.clientWidth),
      copyOverflowPx: Math.max(0, copy.scrollWidth - copy.clientWidth),
      boxOverlapPx: Math.max(0, Math.round(boxOverlap)),
      installVisible: isVisible(document.getElementById('install-btn')),
      controlCount: controls.length
    };
  })()`);
}

async function checkHeroLayoutOverlap(cdp) {
  const tolerance = 1;
  const widths = [320, 375, 900, 920, 960, 1024, 1160, 1280, 1440];
  const problems = [];
  let measurements = 0;
  let installVisibleRuns = 0;

  for (const theme of THEMES) {
    await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(300);

    for (const width of widths) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 760
      });
      await sleep(220);

      const result = await measureHeroOverlap(cdp, width, tolerance);
      if (!result.available) {
        problems.push(`${theme} @ ${width}px: the hero elements were not found`);
        continue;
      }
      measurements += 1;
      if (result.installVisible) installVisibleRuns += 1;

      if (result.collisions.length) {
        const detail = result.collisions.map((c) => `${c.part} over ${c.control} by ${c.overlapPx}px`).join(', ');
        problems.push(`${theme} @ ${width}px: ${detail}`);
      }
      if (result.titleOverflowPx > tolerance) {
        problems.push(`${theme} @ ${width}px: the title text overflows its own box by ${result.titleOverflowPx}px`);
      }
      if (result.copyOverflowPx > tolerance) {
        problems.push(`${theme} @ ${width}px: the supporting copy overflows its own box by ${result.copyOverflowPx}px`);
      }
      if (result.boxOverlapPx > tolerance) {
        problems.push(`${theme} @ ${width}px: the title block overlaps the header controls by ${result.boxOverlapPx}px`);
      }
    }
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(250);

  assert(problems.length === 0, `the hero layout collides in ${problems.length} case(s):\n      ${problems.join('\n      ')}`);

  return {
    themes: THEMES.length,
    widths: widths.length,
    measurements,
    tolerancePx: tolerance,
    installVisibleRuns,
    note: installVisibleRuns
      ? 'the Install App control was visible in these runs, so the widest header state was measured'
      : 'the Install App control was not offered by this browser, so only the narrower header state was measured'
  };
}

/* ------------------------------------------------------------- print report */

/**
 * The printable report must contain every summary metric, every semester and
 * every subject, and the print stylesheet must hide everything that is not
 * part of the report while keeping the report itself visible.
 */
async function checkPrintReport(cdp, appUrl, outDir) {
  // a plan with two semesters, an unsupported grade and an invalid credit
  await cdp.evaluate(`(() => {
    localStorage.setItem('sgpaCgpaPwaState', JSON.stringify({
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [
          { id: 'a1', name: 'Mathematics', grade: 'S', credit: 4 },
          { id: 'a2', name: 'Physics', grade: 'A', credit: 3 }
        ] },
        { id: 's2', title: 'Semester 2', subjects: [
          { id: 'b1', name: 'Chemistry', grade: 'Z', credit: 3 },
          { id: 'b2', name: 'Broken credit', grade: 'A', credit: 'abc' }
        ] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }));
    localStorage.setItem('sgpaCgpaGradingSystem', 'standard-btech');
    return true;
  })()`);
  await cdp.send('Page.navigate', { url: appUrl });
  await sleep(2000);

  // build the report through the real user action
  await cdp.evaluate("document.getElementById('export-btn').click(); true");
  await sleep(700);

  const report = await cdp.evaluate(`(() => {
    const element = document.getElementById('print-report');
    if (!element) return { present: false };
    const text = element.textContent.replace(/\\s+/g, ' ').trim();
    const rows = [...element.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()));
    return {
      present: true,
      text,
      rows,
      sections: element.querySelectorAll('.pdf-section').length,
      hasWarning: Boolean(element.querySelector('.pdf-warning')),
      className: element.className,
      displayOnScreen: getComputedStyle(element).display
    };
  })()`);

  assert(report.present, 'the printable report was not created');
  assert(report.displayOnScreen === 'none', 'the report must be hidden while the application is on screen');
  assert(/print-only/.test(report.className), 'the report is not marked as print only');

  for (const label of [
    'SGPA & CGPA Report',
    'Grading system: Standard B.Tech',
    'Date:',
    'Semesters',
    'CGPA',
    'Percentage',
    'Total Credits',
    'Total Subjects',
    'Latest Semester SGPA',
    'Best SGPA',
    'Lowest SGPA',
    'Semester Average',
    'Performance Note:'
  ]) {
    assert(report.text.includes(label), `the report is missing "${label}"`);
  }

  assert(report.sections === 2, `the report holds ${report.sections} semesters, expected 2`);
  assert(report.hasWarning, 'the report does not carry the incomplete-results warning');
  for (const name of ['Mathematics', 'Physics', 'Chemistry', 'Broken credit']) {
    assert(report.text.includes(name), `the report is missing the subject "${name}"`);
  }
  assert(report.rows.length === 4, `the report holds ${report.rows} subject rows, expected 4`);

  // an unsupported grade is a zero point value, never an inherited member
  const unsupported = report.rows.find((row) => row[0] === 'Chemistry');
  assert(unsupported, 'the unsupported grade row is missing');
  assert(unsupported[3] === '0', `the unsupported grade printed "${unsupported[3]}" instead of 0`);
  assert(!report.text.includes('function Object'), 'the report printed an inherited object member');

  // the print stylesheet hides the application chrome and keeps the report
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(400);
  const printView = await cdp.evaluate(`(() => {
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }).length;
    const report = document.getElementById('print-report');
    return {
      appShell: visible('.app-shell'),
      bottomNav: visible('.bottom-nav'),
      toastContainer: visible('#toast-container'),
      headerActions: visible('.header-actions'),
      reportActions: visible('.report-actions'),
      rowActions: visible('.row-action'),
      dataPanel: visible('.data-panel'),
      reportVisible: report ? getComputedStyle(report).display !== 'none' : false,
      bodyColor: getComputedStyle(document.body).color,
      bodyBackground: getComputedStyle(document.body).backgroundColor
    };
  })()`);

  assert(printView.appShell === 0, 'the dashboard is still printed');
  assert(printView.bottomNav === 0, 'the navigation is still printed');
  assert(printView.toastContainer === 0, 'toasts are still printed');
  assert(printView.headerActions === 0, 'the header controls are still printed');
  assert(printView.reportActions === 0, 'the report buttons are still printed');
  assert(printView.rowActions === 0, 'the row removal buttons are still printed');
  assert(printView.dataPanel === 0, 'the backup panel is still printed');
  assert(printView.reportVisible, 'the report itself is not visible in print');
  assert(printView.bodyColor.startsWith('rgb(1'), `the printed text is not dark (${printView.bodyColor})`);

  // a real PDF through the print pipeline
  const pdf = await cdp.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    marginTop: 0.55,
    marginBottom: 0.55,
    marginLeft: 0.55,
    marginRight: 0.55
  });
  const pdfBuffer = Buffer.from(pdf.data, 'base64');
  fs.writeFileSync(path.join(outDir, 'print-report.pdf'), pdfBuffer);
  const pageCount = (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

  await cdp.send('Emulation.setEmulatedMedia', { media: '' });
  await sleep(200);

  // the report is cleaned up after printing
  await cdp.evaluate("window.dispatchEvent(new Event('afterprint')); true");
  await sleep(300);
  const cleaned = await cdp.evaluate("!document.getElementById('print-report')");
  assert(cleaned, 'the printable report was not removed after printing');

  return {
    semesters: report.sections,
    subjectRows: report.rows.length,
    pdfBytes: pdfBuffer.length,
    pdfPages: pageCount,
    printTextColour: printView.bodyColor
  };
}

/* --------------------------------------------------------- confirmation dialog */

/**
 * The confirmation dialog must be an accessible modal: a real alertdialog
 * with a name and a description, a focus that cannot leave it while Tab is
 * pressed, Escape to cancel, and the focus restored to the control that
 * opened it.
 */
async function checkDialogBehaviour(cdp) {
  await cdp.evaluate("document.getElementById('top-add-semester-btn').click(); true");
  await sleep(600);
  const before = await cdp.evaluate("document.querySelectorAll('#semester-tabs .semester-tab').length");

  // A real pointer click focuses the button before the handler runs, so the
  // dialog can restore the focus to it.
  await cdp.evaluate("document.getElementById('top-delete-semester-btn').focus(); document.getElementById('top-delete-semester-btn').click(); true");
  await sleep(500);

  const opened = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('.dialog');
    const backdrop = document.querySelector('.dialog-backdrop');
    if (!dialog) return { open: false };
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    const title = labelledBy ? document.getElementById(labelledBy) : null;
    const description = describedBy ? document.getElementById(describedBy) : null;
    const active = document.activeElement;
    return {
      open: true,
      role: dialog.getAttribute('role'),
      modal: dialog.getAttribute('aria-modal'),
      titleText: title ? title.textContent.trim() : '',
      descriptionText: description ? description.textContent.trim() : '',
      activeInsideDialog: !!(active && dialog.contains(active)),
      activeText: active ? (active.textContent || '').trim() : '',
      backdropVisible: !!(backdrop && !backdrop.hidden)
    };
  })()`);

  assert(opened.open, 'the delete action did not open the confirmation dialog');
  assert(opened.role === 'alertdialog', `the dialog role is "${opened.role}" instead of alertdialog`);
  assert(opened.modal === 'true', 'the dialog is not marked as modal');
  assert(opened.titleText.length > 0, 'the dialog has no accessible name');
  assert(opened.descriptionText.length > 0, 'the dialog has no accessible description');
  assert(opened.backdropVisible, 'the dim layer behind the dialog is not shown');
  assert(opened.activeInsideDialog, `the focus stayed outside the dialog (on "${opened.activeText}")`);

  const focusTrail = [];
  for (let index = 0; index < 6; index += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(90);
    focusTrail.push(
      await cdp.evaluate(`(() => {
        const dialog = document.querySelector('.dialog');
        const active = document.activeElement;
        return {
          inside: !!(active && dialog && dialog.contains(active)),
          tag: active ? active.tagName.toLowerCase() : ''
        };
      })()`)
    );
  }
  const escaped = focusTrail.filter((step) => !step.inside);
  assert(escaped.length === 0, `Tab left the dialog ${escaped.length} time(s) and reached the page behind it`);

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(500);

  const closed = await cdp.evaluate(`(() => {
    const backdrop = document.querySelector('.dialog-backdrop');
    const active = document.activeElement;
    return {
      hidden: !backdrop || backdrop.hidden,
      focusId: active ? active.id : '',
      semesters: document.querySelectorAll('#semester-tabs .semester-tab').length
    };
  })()`);

  assert(closed.hidden, 'Escape did not close the dialog');
  assert(closed.focusId === 'top-delete-semester-btn', `the focus was not restored (it is on "${closed.focusId}")`);
  assert(closed.semesters === before, 'cancelling the dialog still deleted a semester');

  await cdp.evaluate("document.getElementById('top-delete-semester-btn').focus(); document.getElementById('top-delete-semester-btn').click(); true");
  await sleep(500);
  await cdp.evaluate("document.querySelector('[data-dialog-action=\"confirm\"]').click(); true");
  await sleep(700);
  const after = await cdp.evaluate("document.querySelectorAll('#semester-tabs .semester-tab').length");
  assert(after === before - 1, `the confirmed deletion did not remove the semester (${before} -> ${after})`);

  return {
    tabPressesInsideDialog: focusTrail.length,
    semestersBefore: before,
    semestersAfter: after,
    focusRestoredTo: closed.focusId
  };
}

/* ------------------------------------------------------------ contrast */

/**
 * The toast is a floating surface with its own tinted background, so its text
 * is measured separately from the page. The clipboard is stubbed to produce a
 * deterministic success toast and error toast in every theme.
 */
async function checkToastContrast(cdp) {
  const measurements = [];

  for (const theme of THEMES) {
    await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(350);

    for (const variant of TOAST_VARIANTS) {
      await cdp.evaluate(`(() => {
        const container = document.getElementById('toast-container');
        if (container) container.innerHTML = '';
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: () => ${variant.clipboard} },
          configurable: true,
          writable: true
        });
        document.getElementById('share-btn').click();
        return true;
      })()`);
      await sleep(600);

      const measurement = await measureTextContrast(cdp, theme, 1440, {
        selector: '.toast-message',
        label: `toast ${variant.name} message`
      });
      measurements.push({ ...measurement, variant: variant.name });
    }
  }

  const failures = measurements.filter((item) => item.status === 'fail');
  const unverified = measurements.filter((item) => item.status === 'unverified');
  if (failures.length || unverified.length) {
    const lines = [
      ...failures.map((item) => `${item.label} in ${item.theme}: ${item.ratio}:1`),
      ...unverified.map((item) => `${item.label} in ${item.theme}: UNVERIFIED — ${item.reason}`)
    ];
    throw new Error(
      `${failures.length} measured violation(s) and ${unverified.length} unverified measurement(s) out of ${measurements.length}\n      ${lines.join('\n      ')}`
    );
  }

  const worst = measurements.reduce((lowest, item) => (lowest === null || item.ratio < lowest.ratio ? item : lowest), null);
  return {
    themes: THEMES.length,
    measurements: measurements.length,
    worst: { label: worst.label, theme: worst.theme, ratio: worst.ratio }
  };
}

async function captureRegion(cdp, rect) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 }
  });
  return decodePng(Buffer.from(shot.data, 'base64'));
}

/**
 * The rendered background behind a run of text: the median colour of the
 * pixels that are not the glyph itself. Because the pixels come from a
 * screenshot, gradients, alpha and backdrop filters are already composited.
 */
function analyseBackground(image, labelRgb) {
  const total = image.width * image.height;
  const pixels = [];
  for (let index = 0; index < total; index += 1) {
    const r = image.rgba[index * 4];
    const g = image.rgba[index * 4 + 1];
    const b = image.rgba[index * 4 + 2];
    const distance = Math.hypot(r - labelRgb[0], g - labelRgb[1], b - labelRgb[2]);
    if (distance < 70) continue;
    pixels.push([r, g, b]);
  }
  if (pixels.length < total * 0.12) {
    return { ok: false, reason: `only ${pixels.length} of ${total} pixels could be separated from the glyph` };
  }
  return { ok: true, background: medianColour(pixels), samples: pixels.length };
}

/** The visible boundary of a component, sampled on the straight top edge. */
function analyseBoundary(image, inset) {
  const centre = Math.floor(image.width / 2);
  const rowColours = (y) => {
    const colours = [];
    for (let x = Math.max(0, centre - 10); x <= Math.min(image.width - 1, centre + 10); x += 1) {
      const index = (y * image.width + x) * 4;
      colours.push([image.rgba[index], image.rgba[index + 1], image.rgba[index + 2]]);
    }
    return medianColour(colours);
  };
  const border = rowColours(inset);
  const interior = medianColour([rowColours(inset + 4), rowColours(inset + 5), rowColours(inset + 6)]);
  const exterior = medianColour([rowColours(inset - 3), rowColours(inset - 2), rowColours(inset - 1)]);
  return { border, interior, exterior };
}

/**
 * The pixels that changed when the element received focus, against its
 * surroundings. A control may show more than one cue (a solid border plus a
 * soft ring), so the changed pixels are grouped by colour and the strongest
 * significant group is reported as the indicator.
 */
function analyseFocusChange(before, after, inset) {
  const changed = [];
  const surroundings = [];
  for (let y = 0; y < after.height; y += 1) {
    for (let x = 0; x < after.width; x += 1) {
      const index = (y * after.width + x) * 4;
      const previous = [before.rgba[index], before.rgba[index + 1], before.rgba[index + 2]];
      const current = [after.rgba[index], after.rgba[index + 1], after.rgba[index + 2]];
      const distance = Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]);
      const insideElement = x >= inset && x < after.width - inset && y >= inset && y < after.height - inset;
      if (distance > 24) changed.push(current);
      else if (!insideElement) surroundings.push(current);
    }
  }
  if (changed.length < 8) {
    return { ok: false, reason: `focusing changed only ${changed.length} pixels, so no visible focus indicator was found` };
  }
  if (surroundings.length < 8) {
    return { ok: false, reason: 'not enough surrounding pixels to compare the indicator against' };
  }

  const background = medianColour(surroundings);
  const groups = new Map();
  for (const pixel of changed) {
    const key = `${pixel[0] >> 4}-${pixel[1] >> 4}-${pixel[2] >> 4}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pixel);
  }

  const cues = [];
  for (const pixels of groups.values()) {
    if (pixels.length < changed.length * 0.08) continue;
    const colour = medianColour(pixels);
    cues.push({ colour, pixels: pixels.length, ratio: Number(contrastRatio(colour, background).toFixed(2)) });
  }
  if (!cues.length) return { ok: false, reason: 'no significant focus cue was found among the changed pixels' };

  cues.sort((first, second) => second.ratio - first.ratio);
  return { ok: true, indicator: cues[0].colour, background, cues, changedPixels: changed.length };
}

function isLargeText(fontSize, fontWeight) {
  const size = parseFloat(fontSize);
  const weight = Number(fontWeight);
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

async function measureTextContrast(cdp, theme, width, target) {
  const info = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top + window.scrollY),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30)
    };
  })()`);

  const base = { theme, width, selector: target.selector, label: target.label };
  if (!info || info.w < 2 || info.h < 2) {
    return { ...base, status: 'unverified', reason: 'the element is not rendered at this viewport' };
  }
  const labelRgb = parseColour(info.color);
  if (!labelRgb) {
    return { ...base, status: 'unverified', reason: `the computed colour could not be parsed (${info.color})` };
  }
  const image = await captureRegion(cdp, info);
  if (!image) return { ...base, status: 'unverified', reason: 'the element could not be captured' };

  const analysis = analyseBackground(image, labelRgb);
  if (!analysis.ok) return { ...base, status: 'unverified', reason: analysis.reason };

  const ratio = contrastRatio(labelRgb, analysis.background);
  const large = isLargeText(info.fontSize, info.fontWeight);
  const threshold = large ? 3 : 4.5;
  return {
    ...base,
    status: ratio >= threshold ? 'pass' : 'fail',
    ratio: Number(ratio.toFixed(2)),
    threshold,
    criterion: large ? '1.4.3 large text (3:1)' : '1.4.3 normal text (4.5:1)',
    large,
    color: info.color,
    background: analysis.background,
    fontSize: info.fontSize,
    text: info.text
  };
}

/**
 * Moves the real pointer over a control, confirms :hover is active, then reuses
 * the rendered-pixel text measurement on that hover state.
 */
async function measureHoverTextContrast(cdp, theme, width, target) {
  const base = { theme, width, selector: target.selector, label: target.label, hover: true };
  const prepared = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  if (!prepared) return { ...base, status: 'unverified', reason: 'the element is not rendered' };

  await sleep(180);
  const point = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await sleep(300);

  const hovered = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    return Boolean(el && el.matches(':hover'));
  })()`);
  if (!hovered) return { ...base, status: 'unverified', reason: 'the pointer did not reach the control' };

  return { ...(await measureTextContrast(cdp, theme, width, target)), hover: true };
}

async function measureBoundaryContrast(cdp, theme, target) {
  const info = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left), y: Math.round(rect.top + window.scrollY), w: Math.round(rect.width), h: Math.round(rect.height) };
  })()`);

  const base = { theme, selector: target.selector, label: target.label };
  if (!info || info.w < 6 || info.h < 6) {
    return { ...base, status: 'unverified', reason: 'the element is not rendered' };
  }
  const inset = 6;
  const image = await captureRegion(cdp, { x: info.x - inset, y: info.y - inset, w: info.w + inset * 2, h: info.h + inset * 2 });
  if (!image) return { ...base, status: 'unverified', reason: 'the element could not be captured' };

  const { border, interior, exterior } = analyseBoundary(image, inset);
  if (!border || !interior || !exterior) return { ...base, status: 'unverified', reason: 'the boundary pixels could not be sampled' };

  const against = target.against === 'exterior' ? exterior : interior;
  const ratio = contrastRatio(border, against);
  return {
    ...base,
    status: ratio >= 3 ? 'pass' : 'fail',
    ratio: Number(ratio.toFixed(2)),
    threshold: 3,
    criterion: '1.4.11 non-text contrast (3:1)',
    against: target.against,
    border,
    comparedWith: against
  };
}

async function measureFocusIndicator(cdp, theme, target) {
  const base = { theme, selector: target.selector, label: target.label };

  // Focus indicators are styled with :focus-visible, which only matches after a
  // real keyboard interaction, so the control is reached with Tab key presses.
  const reached = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)});
    return !!el;
  })()`);
  if (!reached) return { ...base, status: 'unverified', reason: 'the element is not rendered' };

  await cdp.evaluate("document.body.focus(); true");
  let focused = false;
  for (let attempt = 0; attempt < 45 && !focused; attempt += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(40);
    focused = await cdp.evaluate(`(() => {
      const el = document.activeElement;
      return !!el && el.matches(${JSON.stringify(target.selector)});
    })()`);
  }
  if (!focused) {
    return { ...base, status: 'unverified', reason: 'the control could not be reached with the keyboard' };
  }
  await sleep(250);

  const info = await cdp.evaluate(`(() => {
    const el = document.activeElement;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left), y: Math.round(rect.top + window.scrollY), w: Math.round(rect.width), h: Math.round(rect.height) };
  })()`);
  if (!info || info.w < 6 || info.h < 6) return { ...base, status: 'unverified', reason: 'the focused element has no measurable box' };

  const inset = 8;
  const region = { x: info.x - inset, y: info.y - inset, w: info.w + inset * 2, h: info.h + inset * 2 };
  const focusedImage = await captureRegion(cdp, region);
  await cdp.evaluate("document.activeElement && document.activeElement.blur(); true");
  await sleep(200);
  const restingImage = await captureRegion(cdp, region);
  if (!focusedImage || !restingImage) return { ...base, status: 'unverified', reason: 'the element could not be captured' };

  const analysis = analyseFocusChange(restingImage, focusedImage, inset);
  if (!analysis.ok) return { ...base, status: 'unverified', reason: analysis.reason };

  const ratio = contrastRatio(analysis.indicator, analysis.background);
  return {
    ...base,
    status: ratio >= 3 ? 'pass' : 'fail',
    ratio: Number(ratio.toFixed(2)),
    threshold: 3,
    criterion: '1.4.11 / 2.4.11 focus indicator (3:1)',
    indicator: analysis.indicator,
    comparedWith: analysis.background
  };
}

async function checkContrast(cdp, appUrl, outDir) {
  // Make sure the app origin is loaded (about:blank has no localStorage), then
  // expose the validation surfaces (invalid credit, unsupported grade).
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForApp(cdp);
  await cdp.evaluate(`localStorage.setItem('sgpaCgpaPwaState', ${JSON.stringify(JSON.stringify(CONTRAST_STATE))}); true`);
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForApp(cdp);
  await sleep(400);

  const text = [];
  const hover = [];
  const boundaries = [];
  const focus = [];

  for (const width of CONTRAST_VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width <= 760
    });
    await sleep(350);

    for (const theme of THEMES) {
      await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(400);

      for (const target of TEXT_TARGETS) {
        text.push(await measureTextContrast(cdp, theme, width, target));
      }
    }
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);

  for (const theme of THEMES) {
    await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(400);

    for (const target of HOVER_TARGETS) {
      hover.push(await measureHoverTextContrast(cdp, theme, 1440, target));
    }
  }

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await cdp.evaluate('window.scrollTo(0, 0); true');
  await sleep(250);

  for (const theme of THEMES) {
    await cdp.evaluate(`(() => { const s = document.getElementById('theme-picker'); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(400);

    for (const target of BOUNDARY_TARGETS) {
      boundaries.push(await measureBoundaryContrast(cdp, theme, target));
    }
    for (const target of FOCUS_TARGETS) {
      focus.push(await measureFocusIndicator(cdp, theme, target));
    }
  }

  const all = [...text, ...hover, ...boundaries, ...focus];
  const failures = all.filter((item) => item.status === 'fail');
  const unverified = all.filter((item) => item.status === 'unverified');

  const summary = {};
  for (const theme of THEMES) {
    const themeItems = all.filter((item) => item.theme === theme);
    const worstText = themeItems
      .filter((item) => item.status !== 'unverified' && item.threshold === 4.5)
      .reduce((lowest, item) => (lowest === null || item.ratio < lowest.ratio ? item : lowest), null);
    summary[theme] = {
      measured: themeItems.filter((item) => item.status !== 'unverified').length,
      failures: themeItems.filter((item) => item.status === 'fail').length,
      unverified: themeItems.filter((item) => item.status === 'unverified').length,
      worstNormalText: worstText ? { label: worstText.label, ratio: worstText.ratio } : null
    };
  }

  fs.writeFileSync(path.join(outDir, 'contrast.json'), JSON.stringify({ text, hover, boundaries, focus, summary }, null, 2));

  if (failures.length || unverified.length) {
    const grouped = new Map();
    for (const item of failures) {
      if (!grouped.has(item.label)) grouped.set(item.label, []);
      grouped.get(item.label).push(`${item.theme} ${item.ratio}:1`);
    }
    const lines = [];
    for (const [label, entries] of grouped) {
      lines.push(`${label}: ${entries.join(', ')} (needs 3:1)`);
    }
    for (const item of unverified.slice(0, 8)) {
      lines.push(`${item.theme} ${item.label}: UNVERIFIED — ${item.reason}`);
    }
    if (unverified.length > 8) lines.push(`and ${unverified.length - 8} further unverified measurements`);
    throw new Error(
      `${failures.length} measured violation(s) and ${unverified.length} unverified measurement(s) out of ${all.length}\n      ${lines.join('\n      ')}`
    );
  }

  return { themes: THEMES.length, measurements: all.length, summary };
}

/* ------------------------------------------------------------------- main */

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (typeof WebSocket !== 'function') {
    console.error('SKIP: this script needs a global WebSocket (Node 22 or newer).');
    process.exit(2);
  }

  const browser = options.browser
    ? (fs.existsSync(options.browser) ? { name: path.basename(options.browser), bin: options.browser } : null)
    : findBrowser();
  if (!browser) {
    console.error('SKIP: no Chromium-family browser was found on this machine (looked for Chrome and Edge).');
    console.error('      Install one locally and re-run, or point at it with --browser <path>.');
    console.error('      The script never downloads anything.');
    process.exit(2);
  }

  fs.mkdirSync(options.out, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgpa-browser-verify-'));
  const appUrl = `http://${HOST}:${options.port}/`;
  let server = null;

  const serverControl = {
    async stop() {
      await stopServer(server);
      server = null;
    },
    async start() {
      server = startServer(options.port);
      await waitForPort(appUrl, 15000);
    }
  };

  let browserProcess = null;

  try {
    if (await waitForPort(appUrl, 400)) {
      throw new Error(`port ${options.port} is already serving something; re-run with --port <n> to pick another`);
    }
    server = startServer(options.port);
    if (!(await waitForPort(appUrl, 20000))) throw new Error('the development server did not start');

    browserProcess = spawn(
      browser.bin,
      [
        '--headless=new',
        `--remote-debugging-port=${options.debugPort}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        '--hide-scrollbars',
        'about:blank'
      ],
      { stdio: 'ignore' }
    );

    const versionUrl = `http://${HOST}:${options.debugPort}/json/version`;
    if (!(await waitForPort(versionUrl, 25000))) throw new Error('the browser did not expose a debugging port');
    const version = await (await fetch(versionUrl)).json();

    const targets = await (await fetch(`http://${HOST}:${options.debugPort}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('the browser exposed no page target');

    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    // Only the local origin may be used; no external request is allowed.
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    // Content Security Policy violations are reported through the log.
    const cspViolations = [];
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (/Content Security Policy|Refused to/i.test(entry.text || '')) {
        cspViolations.push((entry.text || '').slice(0, 200));
      }
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || []).map((arg) => arg.value || arg.description || '').join(' ');
      if (/Content Security Policy|Refused to/i.test(text)) {
        cspViolations.push(text.slice(0, 200));
      }
    });

    const report = {
      browser: version.Browser,
      startedAt: new Date().toISOString(),
      appUrl,
      outputDir: options.out,
      checks: []
    };

    const run = async (name, fn) => {
      try {
        const detail = await fn();
        record(name, 'pass', typeof detail === 'string' ? detail : JSON.stringify(detail));
        report.checks.push({ name, status: 'pass', detail });
        return detail;
      } catch (error) {
        record(name, 'fail', error && error.message ? error.message : String(error));
        report.checks.push({ name, status: 'fail', detail: error && error.message ? error.message : String(error) });
        return null;
      }
    };

    const onlyContrast = options.contrastOnly;
    if (!onlyContrast) {
      await run('startup and critical dashboard rendering', () => checkStartup(cdp, appUrl));
      await run('theme switching and responsive viewports', async () => {
        const perTheme = await checkThemesAndViewports(cdp, options.out);
        return `${perTheme.length} themes × ${VIEWPORTS.join('/')}px, no overflow`;
      });
      await run('hero title never collides with the header controls', () => checkHeroLayoutOverlap(cdp));
      await run('storage write failure recovery', () => checkStorageFailure(cdp, appUrl));
      await run('subject safeguards and save/restore', () => checkSubjectsAndPersistence(cdp, appUrl));
      await run('service worker and offline reload', () => checkServiceWorkerAndOffline(cdp, appUrl, serverControl));
      await run('keyboard focus and accessible names', () => checkKeyboardAndAccessibility(cdp));
      await run('account interface', () => checkAccountInterface(cdp));
      await run('mocked auth callback and sign-out failures', () => checkMockedAuthFailures(cdp));
      await run('confirmation dialog behaviour', () => checkDialogBehaviour(cdp));
      await run('printable report and print stylesheet', () => checkPrintReport(cdp, appUrl, options.out));
      await run('backup export and import round trip', () => checkBackupRoundTrip(cdp, options.out));
      await run('toast contrast in every theme', () => checkToastContrast(cdp));
      await run('content security policy', async () => {
        const policy = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self'",
          "manifest-src 'self'",
          "worker-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'"
        ].join('; ');

        const state = await cdp.evaluate(`(() => {
          const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
          const externals = [...document.querySelectorAll('script[src], link[href]')]
            .map((el) => el.getAttribute('src') || el.getAttribute('href'))
            .filter((value) => /^https?:/i.test(value));
          return {
            hasMeta: Boolean(meta),
            metaContent: meta ? meta.content : '',
            inHead: meta ? Boolean(meta.closest('head')) : false,
            externals,
            worker: 'serviceWorker' in navigator
          };
        })()`);

        assert(state.hasMeta, 'the page does not declare a Content-Security-Policy');
        assert(state.inHead, 'the policy element must be inside the head');
        assert(state.metaContent === policy, 'the delivered policy is not the expected one');
        assert(state.externals.length === 0, 'the page loads an external resource');

        const offline = await cdp.evaluate(`(async () => {
          const response = await fetch('offline.html');
          const html = await response.text();
          const match = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i);
          return { status: response.status, hasMeta: Boolean(match) };
        })()`);
        assert(offline.status === 200, 'the offline page is not served');
        assert(offline.hasMeta, 'the offline page does not declare a policy');

        assert(cspViolations.length === 0, `the browser reported ${cspViolations.length} CSP violation(s): ${cspViolations.slice(0, 3).join(' | ')}`);

        return { policy, violations: cspViolations.length, externals: state.externals.length, offlinePolicy: offline.hasMeta };
      });
    }
    await run('theme contrast (WCAG 1.4.3 / 1.4.11)', () => checkContrast(cdp, appUrl, options.out));

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(options.out, 'report.json'), JSON.stringify(report, null, 2));

    const failed = report.checks.filter((check) => check.status === 'fail');
    console.log('');
    console.log(`browser: ${report.browser}`);
    console.log(`report:  ${path.join(options.out, 'report.json')}`);
    console.log(`result:  ${report.checks.length - failed.length}/${report.checks.length} checks passed`);
    if (failed.length) {
      console.log('failed:  ' + failed.map((check) => check.name).join(', '));
    }
    console.log('note:    this script only reads the application; it changes no source file and installs nothing.');
    process.exitCode = failed.length ? 1 : 0;
  } catch (error) {
    console.error(`FAIL: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    if (browserProcess) {
      try {
        browserProcess.kill();
      } catch (killError) {
        /* already gone */
      }
    }
    await serverControl.stop();
    if (!options.keepArtifacts) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch (error) {
        /* the profile is temporary anyway */
      }
    }
  }
}

main();
