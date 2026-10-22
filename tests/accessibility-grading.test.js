'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const calc = require('../calculator.js');
const auth = require('../auth-provider.js');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'script.js');
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
        // Look for a real child first so list lookups behave like the browser.
        // The cached generic element stays the fallback for markup that only
        // exists as an innerHTML string in the stub.
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

  const scheduledTimeouts = [];
  const clearedTimeouts = [];
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
    setTimeout: (callback, delay) => {
      scheduledTimeouts.push({ callback, delay });
      return scheduledTimeouts.length;
    },
    clearTimeout: (id) => {
      clearedTimeouts.push(id);
    },
    console
  };

  if (options.legacyOnly) {
    // Reproduces a browser that only has the legacy grading-system key left.
    storage.set('sgpaCgpaGradingSystem', options.legacySystem || state.selectedGradingSystem || 'standard-btech');
  } else {
    storage.set('sgpaCgpaPwaState', JSON.stringify(state));
    storage.set('sgpaCgpaGradingSystem', state.selectedGradingSystem || 'standard-btech');
  }
  if (options.savedTheme !== undefined) {
    storage.set('sgpaCgpaTheme', options.savedTheme);
  }

  if (options.printAvailable === false) {
    delete window.print;
  }

  vm.createContext(context);
  vm.runInContext(instrumentedSource, context, { filename: 'script.js' });

  const harness = context.__testHarness;

  // By default the confirmation is answered without a pointer so the existing
  // behaviour can be asserted. `dialog: true` keeps the real dialog open so
  // its accessibility wiring can be exercised.
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
    dispatchWindowEvent(type, event = {}) {
      const handlers = windowListeners.get(type) || [];
      let result;
      handlers.forEach((handler) => {
        result = handler(event);
      });
      return result;
    },
    printCalls,
    scheduledTimeouts,
    clearedTimeouts,
    storage,
    toasts() {
      return harness.appElements.toastContainer.children.map((toast) => ({
        className: toast.className,
        message: toast._queries.get('.toast-message')?.textContent || ''
      }));
    }
  };
}

function extractControlIds(html) {
  return [...html.matchAll(/<(?:input|select) id="([^"]*)"/g)].map((match) => match[1]);
}

function extractErrorIds(html) {
  return [...html.matchAll(/<p class="field-error[^"]*" id="([^"]*)"/g)].map((match) => match[1]);
}

function renderRows(app, semester) {
  const card = app.harness.createSemesterCard(semester);
  return card.querySelector('.subject-list').children;
}

test('subject rows associate Subject, Grade, and Credits labels with unique IDs (executed DOM stub)', () => {
  const app = createApp();
  const allIds = [];

  app.harness.appState.semesters.forEach((semester) => {
    const rows = renderRows(app, semester);

    rows.forEach((row) => {
      const html = row.innerHTML;
      const labels = [...html.matchAll(/<label for="([^"]*)">(Subject|Grade|Credits)<\/label>/g)];
      const controlIds = extractControlIds(html);
      const describedBy = [...html.matchAll(/aria-describedby="([^"]*)"/g)].map((match) => match[1]);
      const errorIds = extractErrorIds(html);

      assert.equal(labels.length, 3, 'each row has three associated labels');
      assert.equal(controlIds.length, 3, 'each row has three controls with IDs');
      assert.equal(describedBy.length, 2, 'grade and credit controls keep aria-describedby');
      assert.equal(errorIds.length, 2, 'each row keeps two validation messages with IDs');

      labels.forEach((match) => {
        const forId = match[1];
        const label = match[2];
        assert.ok(controlIds.includes(forId), `${label} label points at its control`);
      });

      describedBy.forEach((referencedId) => {
        assert.ok(errorIds.includes(referencedId), `aria-describedby ${referencedId} resolves to a message`);
      });

      allIds.push(...controlIds, ...errorIds);
    });
  });

  assert.equal(allIds.length, 15, 'three subjects produce fifteen generated IDs');
  assert.equal(new Set(allIds).size, allIds.length, 'IDs are unique across subjects and semesters');

  allIds.forEach((id) => {
    assert.match(id, /^[^\s"'<>]+$/, `ID must be a usable token: ${id}`);
  });
});

test('control IDs stay stable and unique after adding and removing subjects (executed DOM stub)', () => {
  const app = createApp();
  const semester = JSON.parse(JSON.stringify(app.harness.appState.semesters[0]));

  const collect = (value) =>
    renderRows(app, value).map((row) => ({
      controlIds: extractControlIds(row.innerHTML),
      allIds: [...extractControlIds(row.innerHTML), ...extractErrorIds(row.innerHTML)]
    }));

  const initial = collect(semester);
  const afterRemove = collect({ ...semester, subjects: semester.subjects.slice(1) });
  const afterAdd = collect({
    ...semester,
    subjects: [...semester.subjects, { id: 'sub-new', name: 'New Subject', grade: 'S', credit: 2 }]
  });

  assert.deepEqual(afterRemove[0].controlIds, initial[1].controlIds, 'remaining subject keeps its IDs');
  assert.deepEqual(afterAdd[0].controlIds, initial[0].controlIds, 'existing subject keeps its IDs');
  assert.deepEqual(afterAdd[1].controlIds, initial[1].controlIds, 'existing subject keeps its IDs after adding');

  afterAdd.forEach((row) => {
    assert.equal(new Set(row.allIds).size, row.allIds.length, 're-rendered rows have unique IDs');
  });
});

test('createSubjectControlIds deterministically uniquifies colliding IDs (executed helper)', () => {
  const first = calc.createSubjectControlIds('sem/1', 'sub 1', new Set());
  const used = new Set(Object.values(first));
  const second = calc.createSubjectControlIds('sem/1', 'sub 1', used);
  const repeat = calc.createSubjectControlIds('sem/1', 'sub 1', new Set());

  assert.deepEqual(repeat, first, 'same inputs produce the same IDs');
  assert.equal(second.name, `${first.name}-2`);
  assert.equal(second.grade, `${first.grade}-2`);
  assert.equal(second.credit, `${first.credit}-2`);
  assert.equal(second.gradeError, `${first.gradeError}-2`);
  assert.equal(second.creditError, `${first.creditError}-2`);

  const allIds = [...Object.values(first), ...Object.values(second)];
  assert.equal(new Set(allIds).size, 10, 'colliding renders still produce unique IDs');
  allIds.forEach((id) => assert.equal(/\s/.test(id), false, `no whitespace in ${id}`));
});

test('subject-row template keeps label/for/id and aria-describedby wiring (static source guard)', () => {
  assert.ok(scriptSource.includes('const usedControlIds = new Set();'));
  assert.ok(scriptSource.includes('createSubjectControlIds(semester.id, subject.id, usedControlIds)'));

  assert.ok(scriptSource.includes('for="${escapeHtml(controlIds.name)}">Subject</label>'));
  assert.ok(scriptSource.includes('id="${escapeHtml(controlIds.name)}" class="subject-name"'));
  assert.ok(scriptSource.includes('for="${escapeHtml(controlIds.grade)}">Grade</label>'));
  assert.ok(scriptSource.includes('id="${escapeHtml(controlIds.grade)}" class="subject-grade"'));
  assert.ok(scriptSource.includes('for="${escapeHtml(controlIds.credit)}">Credits</label>'));
  assert.ok(scriptSource.includes('id="${escapeHtml(controlIds.credit)}" class="subject-credit"'));

  assert.ok(scriptSource.includes('aria-describedby="${escapeHtml(controlIds.gradeError)}"'));
  assert.ok(scriptSource.includes('aria-describedby="${escapeHtml(controlIds.creditError)}"'));
  assert.ok(scriptSource.includes('id="${escapeHtml(controlIds.gradeError)}"'));
  assert.ok(scriptSource.includes('id="${escapeHtml(controlIds.creditError)}"'));

  assert.equal(scriptSource.includes('<label>Subject</label>'), false);
  assert.equal(scriptSource.includes('<label>Grade</label>'), false);
  assert.equal(scriptSource.includes('<label>Credits</label>'), false);
});

test('applyGradingSystem reports applied and persists the selection (executed script)', async () => {
  const app = createApp({ confirm: true });
  const gradesBefore = JSON.stringify(app.harness.appState.semesters);

  assert.equal(await app.harness.applyGradingSystem('anna-university'), 'applied');
  assert.equal(app.harness.appState.selectedGradingSystem, 'anna-university');
  assert.equal(app.picker.value, 'anna-university');
  assert.equal(JSON.parse(app.storage.get('sgpaCgpaPwaState')).selectedGradingSystem, 'anna-university');
  assert.equal(JSON.stringify(app.harness.appState.semesters), gradesBefore, 'grades are not remapped');
});

test('a success toast appears only after the change is applied (executed script)', async () => {
  const app = createApp({ confirm: true });
  app.picker.value = 'anna-university';
  await app.picker.dispatch('change');

  const toasts = app.toasts();
  assert.equal(app.harness.appState.selectedGradingSystem, 'anna-university');
  assert.equal(app.picker.value, 'anna-university');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].className, /toast-success/);
  assert.match(toasts[0].message, /Anna University/);
});

test('cancelling restores the picker, keeps state, and shows no toast (executed script)', async () => {
  const app = createApp({ confirm: false });
  const savedBefore = app.storage.get('sgpaCgpaPwaState');
  const gradesBefore = JSON.stringify(app.harness.appState.semesters);

  app.picker.value = 'anna-university';
  await app.picker.dispatch('change');

  assert.equal(app.harness.appState.selectedGradingSystem, 'standard-btech');
  assert.equal(app.picker.value, 'standard-btech');
  assert.equal(app.storage.get('sgpaCgpaPwaState'), savedBefore);
  assert.equal(JSON.stringify(app.harness.appState.semesters), gradesBefore);
  assert.equal(app.toasts().length, 0, 'cancellation is silent');

  assert.equal(await app.harness.applyGradingSystem('anna-university'), 'cancelled');
  assert.equal(app.toasts().length, 0);
});

test('invalid grading selections are rejected safely without a success toast (executed script)', async () => {
  const app = createApp({ confirm: true });
  const gradesBefore = JSON.stringify(app.harness.appState.semesters);

  app.picker.value = 'bogus';
  let dispatchError = null;
  try {
    await app.picker.dispatch('change');
  } catch (error) {
    dispatchError = error;
  }
  assert.equal(dispatchError, null, 'an invalid selection does not throw');

  assert.equal(app.harness.appState.selectedGradingSystem, 'standard-btech');
  assert.equal(app.picker.value, 'standard-btech');
  assert.equal(JSON.stringify(app.harness.appState.semesters), gradesBefore);

  const toasts = app.toasts();
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].className, /toast-error/);
  assert.doesNotMatch(toasts[0].message, /set to/i);

  assert.equal(await app.harness.applyGradingSystem('bogus'), 'rejected');
  assert.equal(app.toasts().length, 1, 'direct rejection does not add a toast');
});

test('the printable report holds every summary metric, every semester and every subject (executed handler)', () => {
  const state = defaultState();
  const app = createApp({ state });
  const report = app.harness.buildReportElement();
  const html = report.innerHTML;

  assert.match(html, /SGPA &amp; CGPA Report/);
  assert.match(html, /Grading system: Standard B\.Tech/);
  assert.match(html, /Date: /);

  const summary = calc.computeSummary(state.semesters, state.selectedGradingSystem);
  const expected = [
    ['Semesters', String(summary.semesterCount)],
    ['CGPA', summary.overallCgpa.toFixed(2)],
    ['Percentage', summary.overallPercent.toFixed(2) + '%'],
    ['Total Credits', String(summary.totalCredits)],
    ['Total Subjects', String(summary.totalSubjects)],
    ['Latest Semester SGPA', summary.currentSgpa.toFixed(2)],
    ['Best SGPA', summary.bestSgpa.toFixed(2)],
    ['Lowest SGPA', summary.worstSgpa.toFixed(2)],
    ['Semester Average', summary.averageSgpa.toFixed(2)]
  ];

  for (const [label, value] of expected) {
    const expected = '<strong>' + label + '</strong><span>' + value + '</span>';
    assert.ok(html.includes(expected), label + ' is missing or wrong in the report');
  }

  assert.match(html, /Performance Note:/);
  assert.ok(
    html.includes(calc.determineAward(summary.overallCgpa, { hasSemesterData: true, incomplete: false })),
    'the performance note matches the award the calculator shows'
  );

  // every semester, not only the selected one
  assert.match(html, /Semester 1/);
  assert.match(html, /Semester 2/);
  const sectionCount = (html.match(/class="pdf-section"/g) || []).length;
  assert.equal(sectionCount, state.semesters.length, 'every semester has a section');

  // every subject of every semester
  for (const semester of state.semesters) {
    for (const subject of semester.subjects) {
      assert.ok(html.includes(subject.name), subject.name + ' is missing from the report');
    }
  }
  const rowCount = (html.match(/<tr>/g) || []).length;
  const subjectCount = state.semesters.reduce((total, semester) => total + semester.subjects.length, 0);
  assert.equal(rowCount, subjectCount + state.semesters.length, 'one row per subject plus one heading row per semester');
});

test('the report keeps the incomplete-results warning and never replaces the dashboard (executed handler)', () => {
  const state = defaultState();
  state.semesters[0].subjects[0].credit = 'abc';

  const app = createApp({ state });
  const before = JSON.stringify(app.harness.appState.semesters);

  const result = app.harness.printReport();

  assert.equal(result.ok, true);
  assert.equal(app.printCalls.count, 1, 'the print dialog is opened once');

  const report = app.document.body.children.find((child) => String(child.className).includes('pdf-report'));
  assert.ok(report, 'the report is in the document while printing');
  assert.match(report.className, /print-only/, 'the report is hidden on screen');
  assert.match(report.innerHTML, /class="pdf-warning"/);
  assert.match(report.innerHTML, /Incomplete results/);
  assert.match(report.innerHTML, /invalid credit value/);

  // the dashboard is untouched
  assert.equal(app.appElements.semesterList.children.length >= 1, true);
  assert.equal(JSON.stringify(app.harness.appState.semesters), before, 'the plan is unchanged');

  const toasts = app.toasts();
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].message, /print dialog is open/i);
  assert.match(toasts[0].message, /Save as PDF/);
  assert.doesNotMatch(toasts[0].message, /success|downloaded|saved/i, 'no false success is reported');
});

test('the report is removed after printing and never duplicated (executed handler)', () => {
  const app = createApp();

  app.harness.printReport();
  assert.equal(app.document.body.children.filter((child) => String(child.className).includes('pdf-report')).length, 1);

  // printing again replaces the previous report instead of adding a second one
  app.harness.printReport();
  assert.equal(
    app.document.body.children.filter((child) => String(child.className).includes('pdf-report')).length,
    1,
    'only one report exists at a time'
  );

  app.dispatchWindowEvent('afterprint');
  assert.equal(
    app.document.body.children.some((child) => String(child.className).includes('pdf-report')),
    false,
    'the report is removed after printing'
  );
});

test('the print cleanup uses a long fallback and clears it when afterprint arrives (executed handler)', () => {
  const app = createApp();

  app.harness.printReport();

  const fallbackTimers = app.scheduledTimeouts.filter((entry) => entry.delay >= 60 * 1000);
  assert.equal(fallbackTimers.length, 1, 'one long fallback timer is scheduled');
  assert.equal(
    fallbackTimers[0].delay >= 60 * 1000,
    true,
    'the fallback must not remove the report while a print dialog is still open'
  );
  assert.equal(app.clearedTimeouts.length, 0, 'the fallback stays pending while the dialog is open');

  app.dispatchWindowEvent('afterprint');

  assert.equal(
    app.document.body.children.some((child) => String(child.className).includes('pdf-report')),
    false,
    'the report is removed when printing ends'
  );
  assert.equal(app.clearedTimeouts.length, 1, 'the fallback timer is cancelled when afterprint arrives');
});

test('a report that cannot be attached reports the failure and leaves nothing behind (executed handler)', () => {
  const app = createApp();
  app.document.body.appendChild = () => {
    throw new Error('the body refused the report');
  };

  const result = app.harness.printReport();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'append');
  assert.equal(app.printCalls.count, 0);
  assert.equal(
    app.document.body.children.some((child) => String(child.className).includes('pdf-report')),
    false
  );
  assert.ok(app.toasts().some((toast) => /could not be prepared/i.test(toast.message)));
});

test('printing without a print function reports the failure and leaves no report behind (executed handler)', () => {
  const app = createApp({ printAvailable: false });

  const result = app.harness.printReport();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
  assert.equal(app.printCalls.count, 0);
  assert.equal(
    app.document.body.children.some((child) => String(child.className).includes('pdf-report')),
    false,
    'no report is left behind'
  );

  const toasts = app.toasts();
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].className, /toast-error/);
  assert.match(toasts[0].message, /not available/i);
  assert.doesNotMatch(toasts[0].message, /success|downloaded|saved/i);
});

test('a grade label that is an inherited object member is never printed as a point value (executed handler)', () => {
  const inherited = ['constructor', 'toString', 'valueOf', '__proto__'];
  const state = defaultState();
  state.semesters[0].subjects = inherited.map((label, index) => ({
    id: 'x' + index,
    name: 'Edge ' + label,
    grade: label,
    credit: 3
  }));

  const app = createApp({ state });
  const html = app.harness.buildReportElement().innerHTML;

  for (const label of inherited) {
    assert.ok(!html.includes('function Object'), label + ' must not print an inherited function');
    assert.ok(!html.includes('[native code]'), label + ' must not print native code');
  }

  // every value cell is a plain number
  const valueCells = [...html.matchAll(/<td>([^<]*)<\/td>/g)].map((match) => match[1]);
  const numbers = valueCells.filter((value) => /^-?\d+(\.\d+)?$/.test(value));
  assert.ok(numbers.length >= inherited.length, 'the edge rows are present with numeric values');
  assert.ok(html.includes('(unsupported)'), 'an unsupported grade is marked in the report');
});

test('the report agrees with the calculator for valid and unsupported grades (executed handler)', () => {
  const state = defaultState();
  state.semesters[0].subjects = [
    { id: 'v1', name: 'Valid', grade: 'S', credit: 4 },
    { id: 'v2', name: 'Unsupported', grade: 'Z', credit: 4 }
  ];

  const app = createApp({ state });
  const html = app.harness.buildReportElement().innerHTML;
  const metrics = calc.computeSemesterMetrics(state.semesters[0].subjects, state.selectedGradingSystem);

  // S is worth 10 points, the unsupported grade counts as zero
  assert.equal(metrics.totalPoints, 40);
  assert.ok(html.includes('<td>10</td>'), 'the valid grade prints its point value');
  assert.ok(html.includes('<td>0</td>'), 'the unsupported grade prints zero points');
  assert.ok(html.includes('Z (unsupported)'), 'the unsupported grade is labelled');
  assert.ok(!html.includes('function Object'), 'no inherited member is printed');
});

test('latest SGPA shows N/A with no semesters or no usable credits (executed UI)', () => {
  const empty = createApp();
  empty.harness.appState.semesters = [];
  empty.harness.updateSummaryPanel();
  assert.equal(empty.appElements.summaryCurrentSgpa.textContent, 'N/A');

  const zeroCredit = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'zero', name: 'Zero Credit', grade: 'S', credit: 0 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });
  assert.equal(zeroCredit.appElements.summaryCurrentSgpa.textContent, 'N/A');

  const invalidCredit = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'bad', name: 'Bad Credit', grade: 'S', credit: 'abc' }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });
  assert.equal(invalidCredit.appElements.summaryCurrentSgpa.textContent, 'N/A');

  const banner = invalidCredit.document.getElementById('validation-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Results incomplete/);
});

test('a valid-credit all-F semester still shows 0.00 (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'failed', name: 'Failed', grade: 'F', credit: 4 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.appElements.summaryCurrentSgpa.textContent, '0.00');
  assert.equal(app.appElements.bestSgpa.textContent, '0.00');
  assert.equal(app.appElements.worstSgpa.textContent, '0.00');
  assert.equal(app.appElements.avgSgpa.textContent, '0.00');
});

test('a normal latest semester shows its SGPA (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'math', name: 'Mathematics', grade: 'S', credit: 4 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.appElements.summaryCurrentSgpa.textContent, '10.00');
});

test('the card follows the latest semester, not the selected tab (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 'first', title: 'Semester 1', subjects: [{ id: 'first-subject', name: 'First', grade: 'S', credit: 4 }] },
        { id: 'latest', title: 'Semester 2', subjects: [{ id: 'latest-subject', name: 'Latest', grade: 'A', credit: 4 }] }
      ],
      selectedSemesterId: 'first',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.harness.appState.selectedSemesterId, 'first');
  assert.equal(app.appElements.summaryCurrentSgpa.textContent, '9.00');
});

test('the SGPA card names the latest semester in its label and text (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, />Latest Semester SGPA</);
  assert.match(html, /latest semester in your plan, even when a different semester tab is selected/);
  assert.match(html, /id="summary-current-sgpa">N\/A</);
});

test('performance note uses the no-data message only when no semesters exist (executed UI)', () => {
  const app = createApp();
  app.harness.appState.semesters = [];
  app.harness.updateSummaryPanel();

  assert.equal(app.appElements.awardLabel.textContent, 'Start adding semester data');
});

test('an all-F semester gets a zero-CGPA note, not the no-data message (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'failed', name: 'Failed', grade: 'F', credit: 4 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.appElements.awardLabel.textContent, 'No points earned yet — review your subjects');
  assert.notEqual(app.appElements.awardLabel.textContent, 'Start adding semester data');
});

test('incomplete results get an incomplete note, not the no-data message (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'bad', name: 'Bad Credit', grade: 'S', credit: 'abc' }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.appElements.awardLabel.textContent, 'Results incomplete — review flagged subjects');
  assert.notEqual(app.appElements.awardLabel.textContent, 'Start adding semester data');

  const banner = app.document.getElementById('validation-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Results incomplete/);
});

test('the performance note label is non-official (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /<span>Performance Note<\/span>/);
  assert.equal(html.includes('<span>Award</span>'), false);
});

test('bottom navigation marks the clicked section active (executed UI)', () => {
  const app = createApp();
  const [overview, semesters, report] = app.navLinks;

  assert.equal(overview.getAttribute('aria-current'), 'location');
  assert.equal(overview.classList.contains('active'), true);

  semesters.dispatch('click');
  assert.equal(semesters.classList.contains('active'), true);
  assert.equal(semesters.getAttribute('aria-current'), 'location');
  assert.equal(overview.classList.contains('active'), false);
  assert.equal(overview.getAttribute('aria-current'), undefined);

  report.dispatch('click');
  assert.equal(report.classList.contains('active'), true);
  assert.equal(report.getAttribute('aria-current'), 'location');
  assert.equal(semesters.classList.contains('active'), false);
  assert.equal(semesters.getAttribute('aria-current'), undefined);
});

test('bottom navigation starts from the current hash on load (executed UI)', () => {
  const app = createApp({ hash: '#semesters' });
  const [overview, semesters] = app.navLinks;

  assert.equal(semesters.classList.contains('active'), true);
  assert.equal(semesters.getAttribute('aria-current'), 'location');
  assert.equal(overview.classList.contains('active'), false);
  assert.equal(overview.getAttribute('aria-current'), undefined);
});

test('bottom navigation follows hash changes (executed UI)', () => {
  const app = createApp();
  app.window.location.hash = '#report';
  app.dispatchWindowEvent('hashchange');

  const [overview, semesters, report] = app.navLinks;
  assert.equal(report.classList.contains('active'), true);
  assert.equal(report.getAttribute('aria-current'), 'location');
  assert.equal(overview.classList.contains('active'), false);
  assert.equal(semesters.classList.contains('active'), false);
});

test('an unknown hash does not mark any destination active (executed UI)', () => {
  const app = createApp({ hash: '#missing' });

  assert.equal(app.navLinks.every((link) => !link.classList.contains('active')), true);
  assert.equal(app.navLinks.every((link) => link.getAttribute('aria-current') === undefined), true);
});

test('bottom navigation points at existing page sections (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /<nav class="bottom-nav" aria-label="Page sections">/);
  assert.match(html, /<a class="nav-pill active" href="#overview" aria-current="location">[\s\S]*?Overview<\/a>/);
  assert.match(html, /<a class="nav-pill" href="#semesters">[\s\S]*?Semesters<\/a>/);
  assert.match(html, /<a class="nav-pill" href="#report">[\s\S]*?Report<\/a>/);
  assert.equal((html.match(/class="nav-icon" aria-hidden="true" focusable="false"/g) || []).length, 3);
  assert.match(html, /<section class="summary-grid" id="overview">/);
  assert.match(html, /<section class="panel card card-panel" id="semesters">/);
  assert.match(html, /<aside class="panel card side-panel" id="report">/);
  assert.equal(html.includes('<button type="button" class="nav-pill'), false);
});

test('bottom navigation uses tokens, surfaces and focus rings (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.bottom-nav\s*\{[^}]*border-radius:\s*var\(--radius-pill/s);
  assert.match(css, /\.bottom-nav\s*\{[^}]*backdrop-filter:\s*var\(--glass-blur/s);
  assert.match(css, /\.nav-pill\.active\s*\{[^}]*var\(--accent-strong/s);
  assert.match(css, /\.nav-pill:hover\s*\{/);
  assert.match(css, /\.nav-icon\s*\{/);
});

test('responsive polish guards overflow, scrolling tabs and touch targets (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.card-top > div\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.hero-panel h1\s*\{[^}]*clamp\(1\.9rem/s);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[^}]*\.hero-panel\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.trend-canvas\s*\{[^}]*max-width:\s*480px/s);
  assert.match(css, /\.summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.semester-tabs\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.nav-pill\s*\{[^}]*min-height:\s*44px/s);
});

test('bottom navigation has anchor and keyboard focus styling (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.nav-pill\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.nav-pill\s*\{[^}]*text-decoration:\s*none/s);
  assert.match(css, /\.nav-pill:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring/s);
});

test('no saved theme falls back to premium-navy (executed script)', () => {
  const app = createApp();

  assert.equal(app.document.documentElement.dataset.theme, 'premium-navy');
  assert.equal(app.appElements.themePicker.value, 'premium-navy');
  assert.equal(app.harness.appState.theme, 'premium-navy');
});

test('a valid saved theme keeps precedence over premium-navy (executed script)', () => {
  const app = createApp({ savedTheme: 'electric-blue' });

  assert.equal(app.document.documentElement.dataset.theme, 'electric-blue');
  assert.equal(app.appElements.themePicker.value, 'electric-blue');
  assert.equal(app.harness.appState.theme, 'electric-blue');
});

test('an invalid saved theme falls back to premium-navy (executed script)', () => {
  const app = createApp({ savedTheme: 'bogus-theme' });

  assert.equal(app.document.documentElement.dataset.theme, 'premium-navy');
  assert.equal(app.appElements.themePicker.value, 'premium-navy');
});

test('semester editor keeps its anchors and JavaScript hooks (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  for (const id of ['semesters', 'semester-tabs', 'semester-list', 'top-add-semester-btn', 'top-add-subject-btn', 'top-delete-semester-btn']) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing`);
  }

  assert.ok(scriptSource.includes("card.className = 'semester-card'"));
  assert.ok(scriptSource.includes("row.className = 'subject-row'"));
  assert.ok(scriptSource.includes("card.querySelector('.subject-list')"));
  assert.ok(scriptSource.includes("row.querySelector('.subject-name')"));
  assert.ok(scriptSource.includes("row.querySelector('.subject-grade')"));
  assert.ok(scriptSource.includes("row.querySelector('.subject-credit')"));
  assert.ok(scriptSource.includes("row.querySelector('.row-action')"));
  assert.ok(scriptSource.includes('appElements.semesterTabs'));
  assert.ok(scriptSource.includes('appElements.semesterList'));
});

test('semester editor styling uses tokens and keyboard focus states (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.semester-tab:focus-visible\s*\{/);
  assert.match(css, /\.subject-row input:focus-visible/);
  assert.match(css, /\.row-action:focus-visible\s*\{/);
  assert.match(css, /\.semester-card::before\s*\{/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.4fr\)\s*minmax\(0,\s*1\.6fr\)\s*auto/);
  assert.match(css, /\.metric-pill strong\s*\{[^}]*tabular-nums/s);
  assert.match(css, /#semesters \.panel-header\s*\{/);
});

test('header and KPI cards keep their hooks and use inline SVG icons (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /<div class="hero-brand">/);
  assert.match(html, /<span class="hero-badge" aria-hidden="true">/);
  assert.equal((html.match(/<article class="summary-card glass-card">/g) || []).length, 5);
  assert.equal((html.match(/<span class="stat-icon" aria-hidden="true">/g) || []).length, 5);
  assert.equal(/[🧮📊🎓🧠📈]/.test(html), false);

  for (const id of [
    'overview',
    'summary-subjects',
    'summary-current-sgpa',
    'overall-cgpa',
    'summary-credits',
    'summary-percent'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing`);
  }

  const externals = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(externals, [], 'the application loads no external resource');
});

test('premium header and KPI styling uses tokens with theme fallbacks (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.hero-panel::before\s*\{/);
  assert.match(css, /\.hero-badge\s*\{/);
  assert.match(css, /\.summary-card::before\s*\{/);
  assert.match(css, /\.summary-card:hover\s*\{/);
  assert.match(css, /\.stat-icon svg\s*\{/);
  assert.match(css, /border-radius:\s*var\(--radius,\s*20px\)/);
  assert.match(css, /backdrop-filter:\s*var\(--glass-blur,\s*blur\(28px\)\)/);
});

test('premium-navy is registered and existing theme ids are preserved (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const existingIds = ['light', 'red-black', 'electric-blue', 'cyber-magenta', 'acid-green', 'violet-grid', 'orange-pulse'];

  assert.match(scriptSource, /const DEFAULT_THEME = 'premium-navy';/);
  for (const id of [...existingIds, 'premium-navy']) {
    assert.ok(scriptSource.includes(`'${id}'`), `${id} missing from themeList`);
  }
  assert.match(html, /<option value="premium-navy">Premium Navy<\/option>/);
  for (const id of existingIds) {
    assert.ok(html.includes(`<option value="${id}">`), `${id} picker option removed`);
  }
  assert.match(css, /html\[data-theme="premium-navy"\]\s*\{/);
  assert.match(css, /--accent:\s*#6366f1/);
  assert.match(css, /--accent-2:\s*#22d3ee/);
  assert.match(css, /--radius:\s*20px/);
  assert.match(css, /--focus-ring:\s*2px solid/);
  assert.match(css, /@supports not \(\(backdrop-filter/);
});

test('report panel writes best, lowest, average and the performance note (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'a', name: 'Alpha', grade: 'S', credit: 4 }] },
        { id: 's2', title: 'Semester 2', subjects: [{ id: 'b', name: 'Beta', grade: 'A', credit: 4 }] }
      ],
      selectedSemesterId: 's2',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(app.appElements.bestSgpa.textContent, '10.00');
  assert.equal(app.appElements.worstSgpa.textContent, '9.00');
  assert.equal(app.appElements.avgSgpa.textContent, '9.50');
  assert.ok(app.appElements.awardLabel.textContent.length > 0);
  assert.notEqual(app.appElements.awardLabel.textContent, 'Start adding semester data');
});

test('report panel keeps its ids, metric rows and action hooks (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  for (const id of ['best-sgpa', 'worst-sgpa', 'avg-sgpa', 'award-label', 'export-btn', 'share-btn', 'reset-all-btn']) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing`);
  }

  assert.equal((html.match(/class="metric-row"/g) || []).length, 3);
  assert.match(html, /class="metric-row wide"/);
  assert.match(html, /<span>Performance Note<\/span>/);
  assert.equal(html.includes('<span>Award</span>'), false);
  assert.match(html, /<div class="report-actions">/);
  assert.match(html, /<aside class="panel card side-panel" id="report">/);

  const reportPanel = html.slice(html.indexOf('<aside class="panel card side-panel" id="report">'));
  const reportPanelHtml = reportPanel.slice(0, reportPanel.indexOf('</aside>'));
  assert.equal((reportPanelHtml.match(/class="btn-icon" aria-hidden="true" focusable="false"/g) || []).length, 3);
});

test('report panel styling uses tokens and accent hierarchy (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.metric-row::before\s*\{/);
  assert.match(css, /\.metric-row\.wide\s*\{/);
  assert.match(css, /\.metric-row\.wide strong\s*\{/);
  assert.match(css, /\.metric-row strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(css, /\.report-actions \.btn \.btn-icon\s*\{/);
  assert.match(css, /#report \.panel-header\s*\{/);
  assert.match(css, /\.pdf-report/);
});

test('trend chart plots actual per-semester SGPA with a connecting line (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'a', name: 'Alpha', grade: 'S', credit: 4 }] },
        { id: 's2', title: 'Semester 2', subjects: [{ id: 'b', name: 'Beta', grade: 'A', credit: 4 }] }
      ],
      selectedSemesterId: 's2',
      selectedGradingSystem: 'standard-btech'
    }
  });
  app.harness.updateSummaryPanel();

  const chart = app.appElements.trendChart.innerHTML;
  assert.equal((chart.match(/class="trend-point"/g) || []).length, 2);
  assert.equal((chart.match(/class="trend-line"/g) || []).length, 1);
  assert.match(chart, /<title>Semester 1: 10\.00<\/title>/);
  assert.match(chart, /<title>Semester 2: 9\.00<\/title>/);
  assert.ok(chart.includes('aria-hidden="true"'));

  const table = app.appElements.trendTableBody.innerHTML;
  assert.match(table, /<th scope="row">Semester 1<\/th><td>10\.00<\/td>/);
  assert.match(table, /<th scope="row">Semester 2<\/th><td>9\.00<\/td>/);
});

test('trend chart shows an empty state without fabricating points (executed UI)', () => {
  const empty = createApp();
  empty.harness.appState.semesters = [];
  empty.harness.updateSummaryPanel();

  assert.match(empty.appElements.trendChart.innerHTML, /Add a semester to see your SGPA trend\./);
  assert.equal(empty.appElements.trendChart.innerHTML.includes('trend-point'), false);
  assert.equal(empty.appElements.trendTableBody.innerHTML, '');

  const unusable = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'bad', name: 'Bad Credit', grade: 'S', credit: 'abc' }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.match(unusable.appElements.trendChart.innerHTML, /No usable SGPA yet/);
  assert.equal(unusable.appElements.trendChart.innerHTML.includes('trend-point'), false);
  assert.match(unusable.appElements.trendTableBody.innerHTML, /<th scope="row">Semester 1<\/th><td>N\/A<\/td>/);
});

test('trend chart leaves a gap and marks N/A for an unusable semester (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'a', name: 'Alpha', grade: 'S', credit: 4 }] },
        { id: 's2', title: 'Semester 2', subjects: [{ id: 'bad', name: 'Bad Credit', grade: 'S', credit: 'abc' }] },
        { id: 's3', title: 'Semester 3', subjects: [{ id: 'c', name: 'Gamma', grade: 'A', credit: 4 }] }
      ],
      selectedSemesterId: 's3',
      selectedGradingSystem: 'standard-btech'
    }
  });
  app.harness.updateSummaryPanel();

  const chart = app.appElements.trendChart.innerHTML;
  assert.equal((chart.match(/class="trend-point"/g) || []).length, 2);
  assert.equal((chart.match(/class="trend-line"/g) || []).length, 0);
  assert.match(app.appElements.trendTableBody.innerHTML, /<th scope="row">Semester 2<\/th><td>N\/A<\/td>/);
});

test('trend chart uses a single point and a note when only one SGPA exists (executed UI)', () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'a', name: 'Alpha', grade: 'S', credit: 4 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });
  app.harness.updateSummaryPanel();

  const chart = app.appElements.trendChart.innerHTML;
  assert.equal((chart.match(/class="trend-point"/g) || []).length, 1);
  assert.equal((chart.match(/class="trend-line"/g) || []).length, 0);
  assert.match(chart, /Add another semester to see a trend line\./);
});

test('trend chart provides an accessible title and hidden data table (static source guard)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(html, /<figure class="trend-panel" id="trend-figure"/);
  assert.match(html, /<figure class="trend-panel" id="trend-figure" aria-labelledby="trend-chart-title">/);
  assert.match(html, /<h3 class="trend-title" id="trend-chart-title">SGPA Trend<\/h3>/);
  assert.match(html, /<div class="trend-canvas" id="trend-chart">/);
  assert.match(html, /<table class="visually-hidden" id="trend-table">/);
  assert.match(html, /<caption>SGPA by semester<\/caption>/);
  assert.match(html, /<tbody id="trend-table-body">/);

  assert.match(css, /\.visually-hidden\s*\{[^}]*clip-path:\s*inset\(50%\)/s);
  assert.match(css, /\.trend-svg\s*\{/);
  assert.match(css, /\.trend-line\s*\{[^}]*stroke:\s*var\(--accent-strong/s);
  assert.match(css, /\.trend-point\s*\{[^}]*fill:\s*var\(--accent-2/s);
});

test('every theme exposes an AA-safe accent gradient, danger colour and focus ring (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const themeIds = [
    'light',
    'red-black',
    'electric-blue',
    'cyber-magenta',
    'acid-green',
    'violet-grid',
    'orange-pulse',
    'premium-navy'
  ];

  for (const id of themeIds) {
    const block = css.match(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{[^}]*\\}`));
    assert.ok(block, `${id} theme block is missing`);
    assert.match(block[0], /--accent-gradient:\s*linear-gradient\(/, `${id} must define --accent-gradient`);
    assert.match(block[0], /--danger:\s*#[0-9a-f]{3,6};/i, `${id} must define a readable --danger`);
    assert.match(block[0], /--focus-ring:\s*2px solid/, `${id} must define a --focus-ring`);
  }

  assert.match(css, /:root\s*\{[^}]*--accent-gradient:/s);
  assert.match(css, /\.btn-primary,\s*\.btn-primary:focus\s*\{[^}]*background:\s*var\(--accent-gradient/s);
  assert.match(css, /\.nav-pill\.active\s*\{[^}]*background:\s*var\(--accent-gradient/s);
  assert.match(css, /\.semester-tab\.active\s*\{[^}]*background:\s*var\(--accent-gradient/s);
});

test('button hover states keep each variant surface and its label readable (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  const genericHover = css.match(/\.btn:hover\s*\{([^}]*)\}/);
  assert.ok(genericHover, 'the generic button hover rule is missing');
  assert.doesNotMatch(
    genericHover[1],
    /background(?:-image|-color)?\s*:/,
    'the generic hover rule must not paint over a variant surface (the light-theme primary button became blank)'
  );

  assert.match(css, /\.btn-primary:hover\s*\{[^}]*background:\s*var\(--accent-gradient/s);
  assert.match(css, /\.btn-primary:hover\s*\{[^}]*color:\s*#f8fafc/s);
  assert.match(
    css,
    /\.btn-secondary:hover,\s*\.btn-tertiary:hover,\s*\.btn-outline:hover\s*\{[^}]*background:\s*var\(--button-hover\)/s
  );
  assert.match(css, /\.btn-danger:hover\s*\{[^}]*background:\s*var\(--danger-hover\)/s);
});

test('theme affordances stay legible, focusable and reduced-motion aware (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.btn:focus\s*\{[^}]*outline:\s*var\(--focus-ring/s);
  assert.match(css, /\.btn-outline,\s*\.btn-outline:focus\s*\{[^}]*border-color:\s*var\(--btn-border/s);
  assert.match(css, /\.btn-secondary,\s*\.btn-secondary:focus\s*\{[^}]*border-color:\s*var\(--btn-border/s);
  assert.match(css, /\.subject-row input\[aria-invalid="true"\],\s*\.subject-row select\[aria-invalid="true"\]\s*\{/);
  assert.match(css, /html\[data-theme="light"\] \.subject-row input\[aria-invalid="true"\],\s*html\[data-theme="light"\] \.subject-row select\[aria-invalid="true"\]\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*animation-duration:\s*0\.01ms\s*!important/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?transform:\s*none/);
  assert.match(css, /\.summary-card,\s*\.card,\s*\.offline-card\s*\{[^}]*backdrop-filter:\s*var\(--glass-blur/s);
  assert.match(css, /\.summary-card,\s*\.card,\s*\.offline-card\s*\{[^}]*-webkit-backdrop-filter:\s*var\(--glass-blur/s);
  assert.match(
    css,
    /@supports not \(\(backdrop-filter[\s\S]*?html\[data-theme="premium-navy"\] \.hero-panel[\s\S]*?html\[data-theme="premium-navy"\] \.bottom-nav/
  );
});

test('theme backgrounds, toast semantics, trend naming and validation accents stay theme aware (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const themeIds = [
    'light',
    'red-black',
    'electric-blue',
    'cyber-magenta',
    'acid-green',
    'violet-grid',
    'orange-pulse',
    'premium-navy'
  ];

  // C1 - the body must not paint over the themed html background
  assert.match(css, /body\s*\{[^}]*background:\s*transparent/s);
  for (const id of themeIds) {
    const block = css.match(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{[^}]*\\}`));
    assert.ok(block, `${id} theme block is missing`);
    assert.match(block[0], /background:\s*(radial-gradient|linear-gradient)/, `${id} must define its own background`);
  }

  // C2 - decorative toast glyph is hidden from assistive tech but still styled
  assert.match(scriptSource, /<span class="toast-icon" aria-hidden="true">/);
  assert.match(css, /\.toast-icon\s*\{/);
  assert.match(css, /\.toast\.visible\s*\{/);
  assert.match(css, /\.toast-message\s*\{/);

  // C3 - the trend figure is named by the existing chart title
  assert.match(html, /<figure class="trend-panel" id="trend-figure" aria-labelledby="trend-chart-title">/);
  assert.match(html, /<h3 class="trend-title" id="trend-chart-title">SGPA Trend<\/h3>/);

  // C4 - the light theme no longer uses the sub-AA secondary text colour
  assert.doesNotMatch(css, /#64748b/, 'the light theme must not use the 4.29:1 secondary text colour');
  const lightBlock = css.match(/html\[data-theme="light"\]\s*\{[^}]*\}/);
  assert.match(lightBlock[0], /--text-secondary:\s*#[0-9a-f]{6};/i);

  // C5 - every theme owns its danger accents and the validation rules use them
  for (const id of themeIds) {
    const block = css.match(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{[^}]*\\}`));
    assert.match(block[0], /--danger-border:\s*rgba\(/, `${id} must define --danger-border`);
    assert.match(block[0], /--danger-ring:\s*rgba\(/, `${id} must define --danger-ring`);
  }
  assert.match(css, /\.validation-banner\s*\{[^}]*border:\s*1px solid var\(--danger-border/s);
  assert.match(css, /\.summary-grid\.results-incomplete \.summary-card\s*\{[^}]*border-color:\s*var\(--danger-border/s);
  assert.match(css, /\.field-error\s*\{[^}]*color:\s*var\(--danger/s);
  assert.match(css, /\.subject-row input\[aria-invalid="true"\],\s*\.subject-row select\[aria-invalid="true"\]\s*\{[^}]*border-color:\s*var\(--danger/s);
});

test('the glass design system is defined for every theme (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const themeIds = [
    'light',
    'red-black',
    'electric-blue',
    'cyber-magenta',
    'acid-green',
    'violet-grid',
    'orange-pulse',
    'premium-navy'
  ];

  assert.match(css, /--glass-blur:\s*blur\(28px\) saturate\(140%\)/);
  assert.match(css, /--glass-rim:\s*rgba\(/);
  assert.match(css, /--glass-sheen:\s*rgba\(/);
  assert.match(css, /--card-nested:\s*rgba\(/);
  assert.match(css, /\.glass-surface\s*\{[^}]*backdrop-filter:\s*var\(--glass-blur/s);
  assert.match(css, /\.glass-surface--nested\s*\{/);
  assert.match(css, /\.glass-surface--overlay\s*\{/);
  assert.match(css, /\.summary-card,\s*\.card,\s*\.offline-card\s*\{[^}]*border-top-color:\s*var\(--glass-rim/s);
  assert.match(css, /\.hero-panel\s*\{[^}]*border-top-color:\s*var\(--glass-rim/s);
  assert.match(css, /\.bottom-nav\s*\{[^}]*border-top-color:\s*var\(--glass-rim/s);
  assert.match(css, /\.toast\s*\{[^}]*backdrop-filter:\s*var\(--glass-blur/s);

  assert.match(css, /:root\s*\{[^}]*--card:\s*rgba\(/s);

  for (const id of themeIds) {
    const block = css.match(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{[^}]*\\}`));
    assert.ok(block, `${id} theme block is missing`);
    const own = block[0].match(/--card:\s*([^;]+);/);
    if (own) {
      assert.match(own[1], /^rgba\(/, `${id} must define a translucent --card`);
    }
  }
  assert.match(css, /\.subject-row input\[aria-invalid="true"\],\s*\.subject-row select\[aria-invalid="true"\]\s*\{[^}]*var\(--danger-ring/s);
});

test('the hero layout keeps the title in its own column (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  // The title column keeps at least its min-content width, so a long word can
  // never be pushed out of its box, and the control column may shrink below
  // its content width, which makes the controls wrap instead of overlapping.
  assert.match(
    css,
    /\.hero-panel\s*\{[\s\S]*?grid-template-columns:\s*minmax\(min-content,\s*1fr\)\s+minmax\(0,\s*max-content\);/,
    'the hero grid must keep a min-content floor for the title column'
  );
  assert.match(css, /\.header-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/, 'the header controls must be able to wrap');
});

test('premium motion, version alignment and unique field names stay wired (static source guard)', () => {  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

  // motion: one continuous effect per icon, all transform/opacity based
  assert.match(css, /@keyframes brandHalo\s*\{/);
  assert.match(css, /@keyframes statIconBreathe\s*\{/);
  assert.match(css, /@keyframes navIconBreathe\s*\{/);
  assert.match(css, /\.hero-badge svg\s*\{[^}]*animation:\s*brandHalo/s);
  assert.match(css, /\.summary-card:hover \.stat-icon svg,\s*\.summary-card:focus-within \.stat-icon svg\s*\{[^}]*animation:\s*statIconBreathe/s);
  assert.match(css, /\.nav-pill\.active \.nav-icon\s*\{[^}]*animation:\s*navIconBreathe/s);
  assert.match(css, /\.btn:hover \.btn-icon,\s*\.btn:focus-visible \.btn-icon[^{]*\{[^}]*transform:\s*scale/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.hero-badge svg,\s*\.stat-icon svg,\s*\.nav-pill\.active \.nav-icon\s*\{\s*animation:\s*none\s*!important/);
  assert.doesNotMatch(css, /\.summary-card\s*\{[^}]*animation:/s, 'the KPI card itself must not animate');

  // version alignment across html, script and service worker
  assert.match(html, /styles\.css\?v=11/);
  assert.match(html, /calculator\.js\?v=11/);
  assert.match(html, /script\.js\?v=11/);
  assert.match(scriptSource, /const swUrl = 'sw\.js\?v=11';/);
  assert.match(sw, /const CACHE_VERSION = 'v11';/);

  // unique accessible names for the repeated subject controls
  assert.ok(scriptSource.includes('function subjectControlLabel(label, subject)'));
  assert.ok(scriptSource.includes('aria-label="${escapeHtml(subjectControlLabel(\'Subject name\', subject))}"'));
  assert.ok(scriptSource.includes('aria-label="${escapeHtml(subjectControlLabel(\'Grade\', subject))}"'));
  assert.ok(scriptSource.includes('aria-label="${escapeHtml(subjectControlLabel(\'Credits\', subject))}"'));
  assert.ok(scriptSource.includes("nameInput.setAttribute('aria-label', subjectControlLabel('Subject name', subject));"));

  // responsive maintenance
  assert.match(css, /\.summary-grid\s*\{[^}]*minmax\(190px,\s*1fr\)/s);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.nav-pill\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(css, /@media \(max-width: 360px\)\s*\{[\s\S]*?\.nav-pill\s*\{[^}]*flex:\s*1 1 100%/s);

  // dead rules removed
  for (const removed of ['.subject-table', '.card-controls', '.icon-btn', '.btn-sm', '.semester-actions']) {
    assert.equal(css.includes(removed + ' '), false, `${removed} rules must be removed`);
  }
});

test('a fresh plan uses the default grade of the selected grading system (executed DOM stub)', () => {
  const cases = [
    ['standard-btech', 'S'],
    ['vtu', 'S'],
    ['jntu', 'A+'],
    ['anna-university', 'O'],
    ['custom-7point', 'A']
  ];

  for (const [system, expectedGrade] of cases) {
    const app = createApp({ legacyOnly: true, legacySystem: system });

    assert.equal(app.harness.appState.selectedGradingSystem, system, `${system} is the active system`);
    const grades = app.harness.appState.semesters[0].subjects.map((subject) => subject.grade);
    // The arrays are created inside the VM realm, so they are compared as text.
    assert.equal(
      grades.join(','),
      [expectedGrade, expectedGrade, expectedGrade, expectedGrade].join(','),
      `${system} default plan grades`
    );
    assert.equal(
      calc.getUnsupportedGrades(app.harness.appState.semesters, system).length,
      0,
      `${system} default plan reports no unsupported grade`
    );
  }
});

test('a genuinely unsupported grade is kept, reported and never replaced (executed DOM stub)', async () => {
  const app = createApp({
    state: {
      semesters: [
        { id: 's1', title: 'Semester 1', subjects: [{ id: 'a1', name: 'Mathematics', grade: 'S', credit: 4 }] }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    }
  });

  assert.equal(await app.harness.applyGradingSystem('jntu'), 'applied', 'the switch is applied after confirmation');
  assert.equal(app.harness.appState.selectedGradingSystem, 'jntu', 'the new system is active');
  assert.equal(app.harness.appState.semesters[0].subjects[0].grade, 'S', 'the stored grade is never replaced');
  assert.equal(
    calc.getUnsupportedGrades(app.harness.appState.semesters, 'jntu').length,
    1,
    'the grade is still reported as unsupported in the new system'
  );
  assert.equal(
    calc.getUnsupportedGrades(app.harness.appState.semesters, 'vtu').length,
    0,
    'the same grade is valid in VTU'
  );

  assert.equal(await app.harness.applyGradingSystem('vtu'), 'applied', 'switching again is applied');
  assert.equal(app.harness.appState.semesters[0].subjects[0].grade, 'S', 'switching never rewrites the grade');
  assert.equal(
    calc.getUnsupportedGrades(app.harness.appState.semesters, 'anna-university').length,
    1,
    'the grade is unsupported in a third system as well'
  );
});

test('the app survives browser storage refusing writes (executed DOM stub)', () => {  const app = createApp({ storageFails: true });

  assert.equal(app.document.documentElement.dataset.theme, 'premium-navy', 'the theme is still applied');
  assert.ok(app.harness.appState.semesters.length >= 1, 'a plan is available in memory');
  assert.ok(app.appElements.semesterTabs.children.length >= 1, 'the semester tabs still render');
  assert.ok(app.appElements.semesterList.children.length >= 1, 'the semester editor still renders');

  const warnings = app.toasts();
  assert.equal(warnings.length, 1, 'the storage failure is reported once');
  assert.match(warnings[0].message, /storage/i);
  assert.match(warnings[0].className, /toast-warn/);

  const before = app.harness.appState.semesters[0].subjects.length;
  app.appElements.addSubjectBtn.dispatch('click');
  assert.equal(app.harness.appState.semesters[0].subjects.length, before + 1, 'the editor still works');
  assert.equal(app.toasts().filter((toast) => /storage/i.test(toast.message)).length, 1, 'the warning is not repeated');
});

test('all direct browser storage access is confined to the guarded helpers (static source guard)', () => {
  assert.ok(scriptSource.includes('function readStoredValue(key)'));
  assert.ok(scriptSource.includes('function persistStoredValue(key, value)'));
  assert.ok(scriptSource.includes('catch (error)'));
  assert.ok(scriptSource.includes("showToast('Browser storage is unavailable, so changes cannot be saved in this session.', 'warn')"));

  const directAccess = scriptSource.match(/localStorage\.(getItem|setItem|removeItem)/g) || [];
  assert.equal(directAccess.length, 2, 'only the two helpers may touch localStorage directly');
  assert.ok(scriptSource.includes('return localStorage.getItem(key);'));
  assert.ok(scriptSource.includes('localStorage.setItem(key, value);'));
});

test('resetting all data restores a single fresh plan and announces it (executed DOM stub)', async () => {
  const app = createApp();

  assert.equal(app.harness.appState.semesters.length, 2, 'the seeded plan has two semesters');
  app.appElements.addSemesterBtn.dispatch('click');
  assert.equal(app.harness.appState.semesters.length, 3, 'a third semester was added');

  await app.appElements.resetAllBtn.dispatch('click');

  assert.equal(app.harness.appState.semesters.length, 1, 'reset keeps exactly one semester');
  assert.equal(app.harness.appState.semesters[0].subjects.length, 4, 'the fresh semester has the default subjects');
  assert.equal(app.appElements.semesterTabs.children.length, 1, 'the tab strip shows a single tab');
  assert.ok(app.appElements.semesterList.children.length >= 1, 'a semester card is rendered');

  const toasts = app.toasts();
  const resetToasts = toasts.filter((toast) => /All data cleared/.test(toast.message));
  assert.equal(resetToasts.length, 1, 'the reset is announced exactly once');
  assert.match(resetToasts[0].message, /fresh academic plan/);
  assert.equal(app.appElements.semesterList.children.length, 1, 'the reset leaves exactly one semester card');
});

test('adding and removing subjects updates the plan and refuses to empty a semester (executed DOM stub)', () => {
  const app = createApp();
  const currentSemester = () => {
    const state = app.harness.appState;
    return state.semesters.find((semester) => semester.id === state.selectedSemesterId) || state.semesters[0];
  };
  const renderedRow = () =>
    app.appElements.semesterList.querySelector('.semester-card').querySelector('.subject-list').children[0];

  const start = currentSemester().subjects.length;
  assert.ok(start >= 2, 'the seeded semester has more than one subject');

  app.appElements.addSubjectBtn.dispatch('click');
  assert.equal(currentSemester().subjects.length, start + 1, 'the subject was added');
  assert.ok(app.toasts().some((toast) => /Subject added/.test(toast.message)), 'the addition is announced');
  assert.equal(app.appElements.semesterList.children.length, 1, 're-rendering does not duplicate the semester card');

  renderedRow().querySelector('.row-action').dispatch('click');
  assert.equal(currentSemester().subjects.length, start, 'the subject was removed');
  assert.ok(app.toasts().some((toast) => /Subject removed/.test(toast.message)), 'the removal is announced');
  assert.equal(app.appElements.semesterList.children.length, 1, 're-rendering does not duplicate the semester card');

  while (currentSemester().subjects.length > 1) {
    renderedRow().querySelector('.row-action').dispatch('click');
  }
  assert.equal(currentSemester().subjects.length, 1, 'one subject remains');

  renderedRow().querySelector('.row-action').dispatch('click');
  assert.equal(currentSemester().subjects.length, 1, 'the last subject is never removed');
  assert.ok(
    app.toasts().some((toast) => /at least one subject/i.test(toast.message)),
    'the safeguard is announced'
  );
});

test('a saved plan is restored on load and edits are written back to storage (executed DOM stub)', () => {
  const seeded = {
    semesters: [
      { id: 's1', title: 'Semester 1', subjects: [{ id: 'a1', name: 'Restored Subject', grade: 'S', credit: 4 }] }
    ],
    selectedSemesterId: 's1',
    selectedGradingSystem: 'standard-btech'
  };
  const app = createApp({ state: seeded });

  const card = app.appElements.semesterList.querySelector('.semester-card');
  assert.ok(card, 'the restored plan renders a semester card');
  // The stub models markup only through the elements the app itself queries,
  // so the row is reached through the subject list the app populated.
  const row = card.querySelector('.subject-list').children[0];
  const nameInput = row.querySelector('.subject-name');
  assert.equal(nameInput.value, 'Restored Subject', 'the saved subject name is restored into the editor');
  assert.equal(Number(row.querySelector('.subject-credit').value), 4, 'the saved credit is restored into the editor');

  nameInput.value = 'Renamed Subject';
  nameInput.dispatch('input');

  const persisted = JSON.parse(app.storage.get('sgpaCgpaPwaState'));
  assert.equal(persisted.semesters[0].subjects[0].name, 'Renamed Subject', 'the edit is persisted');
  assert.equal(persisted.semesters[0].subjects[0].credit, 4, 'the untouched credit is persisted as a number');
  assert.equal(persisted.selectedSemesterId, 's1', 'the selection is persisted');

  const restored = createApp({ state: persisted });
  const restoredCard = restored.appElements.semesterList.querySelector('.semester-card');
  const restoredRow = restoredCard.querySelector('.subject-list').children[0];
  assert.equal(restoredRow.querySelector('.subject-name').value, 'Renamed Subject', 'a second load restores the edit');
});

test('the trend table and chart never duplicate rows (executed DOM stub)', () => {
  const app = createApp();
  const semesters = app.harness.appState.semesters.length;

  app.harness.updateSummaryPanel();
  app.harness.updateSummaryPanel();
  app.harness.updateSummaryPanel();

  const tableRows = (app.appElements.trendTableBody.innerHTML.match(/<tr>/g) || []).length;
  const chartPoints = (app.appElements.trendChart.innerHTML.match(/class="trend-point"/g) || []).length;

  assert.equal(tableRows, semesters, 'the accessible table holds one row per semester');
  assert.equal(chartPoints, semesters, 'the chart holds one point per semester');
});

test('the displayed percentage applies the 9.5 rule to the overall CGPA (executed DOM stub)', () => {
  const app = createApp();

  // default seed: A(4) + S(3) + B(3) -> 90 points over 10 credits -> 9.00 CGPA -> 85.50 %
  assert.equal(app.appElements.overallCgpa.textContent, '9.00');
  assert.equal(app.appElements.summaryPercent.textContent, '85.50%');
  assert.equal(
    Number(app.appElements.summaryPercent.textContent.replace('%', '')),
    Number((Number(app.appElements.overallCgpa.textContent) * 9.5).toFixed(2))
  );
});

/* ------------------------------------------------ notification stack cap */

test('the notification stack never shows more than three toasts (executed DOM stub)', () => {
  const app = createApp();

  app.appElements.addSemesterBtn.dispatch('click');
  app.appElements.addSemesterBtn.dispatch('click');
  app.appElements.addSubjectBtn.dispatch('click');
  app.appElements.addSubjectBtn.dispatch('click');

  const toasts = app.toasts();
  assert.equal(toasts.length, 3, 'the stack is capped at three toasts');
  assert.match(toasts[0].message, /Semester added/, 'the oldest toast is the one that was dropped');
  assert.match(toasts[1].message, /Subject added/);
  assert.match(toasts[2].message, /Subject added/);
});

/* ------------------------------------------------------ confirmation dialog */

test('the confirmation dialog is an accessible alertdialog that traps the focus (executed DOM stub)', async () => {
  const app = createApp({ dialog: true });
  app.picker.focus();
  const trigger = app.picker;

  app.picker.value = 'anna-university';
  const opening = app.picker.dispatch('change');

  const elements = app.harness.confirmDialog.getElements();
  assert.ok(elements, 'the dialog builds its own elements');
  assert.equal(elements.dialog.getAttribute('role'), 'alertdialog');
  assert.equal(elements.dialog.getAttribute('aria-modal'), 'true');
  assert.equal(elements.dialog.getAttribute('aria-labelledby'), elements.title.id);
  assert.equal(elements.dialog.getAttribute('aria-describedby'), elements.description.id);
  assert.match(elements.title.textContent, /Switch to Anna University\?/);
  assert.ok(elements.description.textContent.length > 0, 'the dialog describes the consequence');
  assert.equal(elements.backdrop.hidden, false, 'the dialog is shown');
  assert.equal(app.document.activeElement, elements.confirmButton, 'the confirm button takes the focus');

  app.dispatchWindowEvent('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, elements.cancelButton, 'Tab moves to the cancel button');
  app.dispatchWindowEvent('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, elements.confirmButton, 'Tab wraps back to the confirm button');
  app.dispatchWindowEvent('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, elements.cancelButton, 'Shift+Tab wraps to the cancel button');

  app.dispatchWindowEvent('keydown', { key: 'Escape' });
  assert.equal(app.harness.confirmDialog.isOpen(), false, 'Escape closes the dialog');
  assert.equal(app.document.activeElement, trigger, 'the focus returns to the control that opened the dialog');

  await opening;
  assert.equal(app.harness.appState.selectedGradingSystem, 'standard-btech', 'cancelling keeps the current system');
  assert.equal(app.picker.value, 'standard-btech', 'the picker is restored');
  assert.equal(app.toasts().length, 0, 'cancelling is silent');
});

test('confirming the dialog applies the change and returns the focus (executed DOM stub)', async () => {
  const app = createApp({ dialog: true });
  app.picker.focus();

  app.picker.value = 'anna-university';
  const opening = app.picker.dispatch('change');
  assert.equal(app.harness.confirmDialog.isOpen(), true, 'the dialog asks before the change');

  app.harness.confirmDialog.accept();
  await opening;

  assert.equal(app.harness.appState.selectedGradingSystem, 'anna-university');
  assert.equal(app.picker.value, 'anna-university');
  assert.equal(app.document.activeElement, app.picker, 'the focus returns to the picker');
  assert.equal(app.toasts().length, 1);
  assert.match(app.toasts()[0].className, /toast-success/);
});

test('deleting a semester asks for confirmation in the dialog (executed DOM stub)', async () => {
  const app = createApp({ dialog: true });

  app.appElements.deleteSemesterBtn.dispatch('click');
  const elements = app.harness.confirmDialog.getElements();
  assert.ok(elements, 'the delete action opens the dialog');
  assert.match(elements.title.textContent, /Delete Semester 1\?/);
  assert.match(elements.description.textContent, /cannot be undone/);

  app.harness.confirmDialog.cancel();
  assert.equal(app.harness.appState.semesters.length, 2, 'cancelling keeps every semester');
});

test('the application no longer uses the native confirm dialog (static source guard)', () => {
  assert.equal(/(^|[^.\w])confirm\s*\(/.test(scriptSource), false, 'window.confirm must not be used');
  assert.ok(/'alertdialog'/.test(scriptSource), 'the dialog uses the alertdialog role');
  assert.ok(/'aria-modal'/.test(scriptSource), 'the dialog is marked as modal');
  assert.ok(/'aria-labelledby'/.test(scriptSource), 'the dialog title is linked');
  assert.ok(/'aria-describedby'/.test(scriptSource), 'the dialog description is linked');
  assert.ok(/addEventListener\('keydown'/.test(scriptSource), 'a global key listener handles Escape and Tab');
});

function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/g) || [];
  for (const tag of tags) {
    if (!tag.includes(`name="${name}"`)) continue;
    const content = tag.match(/\bcontent="([^"]*)"/);
    return content ? content[1] : '';
  }
  return '';
}

function policyWith(connectSource) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSource}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
}

function expectedIndexPolicy(html) {
  const projectUrl = metaContent(html, 'sgpa-supabase-url');
  const publishableKey = metaContent(html, 'sgpa-supabase-publishable-key');
  if (!projectUrl && !publishableKey) return policyWith("'self'");

  assert.ok(projectUrl && publishableKey, 'both authentication meta tags must be configured together');
  const project = auth.validateProjectUrl(projectUrl);
  assert.equal(project.ok, true, 'the configured project URL must be a valid Supabase origin');
  assert.equal(auth.validatePublishableKey(publishableKey).ok, true, 'the configured key must be publishable');
  return policyWith(`'self' ${project.url}`);
}

function cspFromHtml(html, name) {
  const head = html.slice(0, html.indexOf('</head>'));
  const match = head.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/);
  assert.ok(match, name + ' must declare a policy inside the head');
  return match[1];
}

test('the content security policy follows the auth configuration without weakening offline (static source guard)', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const offlineHtml = fs.readFileSync(path.join(ROOT, 'offline.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const indexPolicy = expectedIndexPolicy(indexHtml);

  assert.equal(cspFromHtml(indexHtml, 'index.html'), indexPolicy);
  assert.equal(cspFromHtml(offlineHtml, 'offline.html'), policyWith("'self'"), 'offline stays auth-free');
  assert.equal(/unsafe-eval|unsafe-inline/.test(indexPolicy), false, 'the policy stays restrictive');
  assert.equal(/script-src[^;]*https?:/.test(indexPolicy), false, 'no remote script source is allowed');
  assert.equal(/file:/.test(indexPolicy), false, 'no file source is allowed');

  const serverMatch = serverSource.match(/const CONTENT_SECURITY_POLICY =\s*"([^"]+)"/);
  assert.ok(serverMatch, 'server.js must declare its default policy');
  assert.equal(serverMatch[1], policyWith("'self'"), 'the server default stays auth-free');
  assert.match(serverSource, /readIndexContentSecurityPolicy/);
  assert.match(serverSource, /INDEX_CONTENT_SECURITY_POLICY/);

  const configuredIndex = indexHtml
    .replace(/(<meta name="sgpa-supabase-url" content=")[^"]*(")/, '$1https://demo.supabase.co$2')
    .replace(/(<meta name="sgpa-supabase-publishable-key" content=")[^"]*(")/, '$1sb_publishable_test$2')
    .replace("connect-src 'self'", "connect-src 'self' https://demo.supabase.co");
  const configuredPolicy = expectedIndexPolicy(configuredIndex);

  assert.equal(configuredPolicy, cspFromHtml(configuredIndex, 'configured index.html'));
  assert.match(configuredPolicy, /connect-src 'self' https:\/\/demo\.supabase\.co/);
  assert.doesNotMatch(configuredPolicy, /\*/);
});

test('the print stylesheet produces a readable report and hides the interface (static source guard)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(css, /\.print-only\s*\{\s*display: none;/, 'the report is hidden on screen');
  assert.match(css, /@media print\s*\{/);
  assert.match(css, /@page\s*\{\s*size: A4 portrait;/, 'the print page size is A4 portrait');

  const printBlock = css.slice(css.indexOf('@media print {'));
  for (const selector of [
    '.app-shell',
    '.bottom-nav',
    '.toast-container',
    '.dialog-backdrop',
    '.account-view',
    '.header-actions',
    '.panel-actions',
    '.report-actions',
    '.row-action',
    '.data-panel'
  ]) {
    assert.ok(printBlock.includes(selector), selector + ' must be hidden in print');
  }

  assert.match(printBlock, /\.print-only\s*\{\s*display: block !important;/, 'the report stays visible in print');
  assert.match(printBlock, /background: #fff !important;/, 'the printed page is white');
  assert.match(printBlock, /color: #111 !important;/, 'the printed text is dark');
  assert.match(printBlock, /\.pdf-table thead\s*\{\s*display: table-header-group;/, 'the table heading repeats across pages');
  assert.match(printBlock, /\.pdf-table tr\s*\{\s*break-inside: avoid;/, 'a subject row is not split across pages');
});
