'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calculator.js');

/* The backup format is pure data, so it is tested without a browser. */

function plan(overrides) {
  return Object.assign(
    {
      semesters: [
        {
          id: 's1',
          title: 'Semester 1',
          subjects: [
            { id: 'a1', name: 'Mathematics', grade: 'S', credit: 4 },
            { id: 'a2', name: 'Physics', grade: 'A', credit: 3 }
          ]
        }
      ],
      selectedSemesterId: 's1',
      selectedGradingSystem: 'standard-btech'
    },
    overrides || {}
  );
}

test('a backup keeps the saved plan shape and adds only format metadata', () => {
  const backup = calc.createBackup(plan(), { exportedAt: '2026-01-02T03:04:05.000Z' });

  assert.equal(backup.format, 'sgpa-cgpa-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(Object.keys(backup).sort(), ['exportedAt', 'format', 'plan', 'version']);
  assert.deepEqual(Object.keys(backup.plan).sort(), ['selectedGradingSystem', 'selectedSemesterId', 'semesters']);
  assert.deepEqual(backup.plan.semesters, plan().semesters);
  assert.equal(backup.plan.selectedSemesterId, 's1');
  assert.equal(backup.plan.selectedGradingSystem, 'standard-btech');
});

test('a backup never carries anything but the plan', () => {
  const backup = calc.createBackup(plan());
  const text = JSON.stringify(backup);

  assert.equal(/password/i.test(text), false);
  assert.equal(/token/i.test(text), false);
  assert.equal(/secret/i.test(text), false);
  assert.equal(/cookie/i.test(text), false);
  assert.equal(/"theme"/.test(text), false, 'unrelated browser data is not included');
});

test('a backup is a copy, so later edits cannot change it', () => {
  const source = plan();
  const backup = calc.createBackup(source);
  source.semesters[0].subjects[0].grade = 'F';
  source.semesters[0].title = 'Changed';

  assert.equal(backup.plan.semesters[0].subjects[0].grade, 'S');
  assert.equal(backup.plan.semesters[0].title, 'Semester 1');
});

test('a valid backup is parsed and summarised', () => {
  const backup = calc.createBackup(plan());
  const parsed = calc.parseBackup(JSON.stringify(backup));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.backup.format, 'sgpa-cgpa-backup');

  const summary = calc.summarizeBackup(parsed.backup);
  assert.equal(summary.semesters, 1);
  assert.equal(summary.subjects, 2);
  assert.equal(summary.gradingSystem, 'standard-btech');
  assert.equal(summary.gradingSystemName, 'Standard B.Tech');
});

test('an empty or non-JSON file is rejected without a partial result', () => {
  for (const text of ['', '   ', 'not json at all', '{oops', '[1,2,3]', 'null', '"a string"']) {
    const parsed = calc.parseBackup(text);
    assert.equal(parsed.ok, false, `expected "${text}" to be rejected`);
    assert.ok(parsed.error.code, 'a rejection always carries a code');
    assert.ok(parsed.error.message.length > 0, 'a rejection always explains itself');
  }
});

test('a file that is not a backup is rejected', () => {
  const parsed = calc.parseBackup(JSON.stringify({ format: 'something-else', version: 1, plan: plan() }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'format');
});

test('an unsupported backup version is rejected', () => {
  const backup = calc.createBackup(plan());
  backup.version = 99;
  const parsed = calc.parseBackup(JSON.stringify(backup));

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'version');
  assert.match(parsed.error.message, /99/);
});

test('a broken plan shape is rejected with a specific reason', () => {
  const cases = [
    [{ semesters: 'nope' }, 'schema'],
    [{ semesters: [] }, 'empty-plan'],
    [{ semesters: [{ title: 'x', subjects: [] }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 'x' }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 'x', subjects: [{ name: 'n', grade: 'S', credit: 1 }] }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 'x', subjects: [{ id: 'a', name: 'n', grade: 'S', credit: {} }] }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 'x', subjects: [{ id: 'a', name: 'n', grade: 'S', credit: 1 }] }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 5, subjects: [] }] }, 'schema'],
    [{ semesters: [{ id: 's1', title: 'x', subjects: [] }], selectedGradingSystem: 'nope' }, 'schema']
  ];

  for (const [brokenPlan, expectedCode] of cases) {
    const parsed = calc.parseBackup(JSON.stringify({ format: 'sgpa-cgpa-backup', version: 1, plan: brokenPlan }));
    assert.equal(parsed.ok, false, `expected ${JSON.stringify(brokenPlan)} to be rejected`);
    assert.equal(parsed.error.code, expectedCode);
  }
});

test('legitimate zero values and empty subject lists survive a round trip', () => {
  const source = plan({
    semesters: [
      { id: 's1', title: 'Semester 1', subjects: [] },
      {
        id: 's2',
        title: 'Semester 2',
        subjects: [
          { id: 'a1', name: 'Zero credit', grade: 'F', credit: 0 },
          { id: 'a2', name: 'Zero credit string', grade: 'S', credit: '0' }
        ]
      }
    ],
    selectedSemesterId: 's2'
  });

  const parsed = calc.parseBackup(JSON.stringify(calc.createBackup(source)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.backup.plan.semesters[0].subjects, []);
  assert.equal(parsed.backup.plan.semesters[1].subjects[0].credit, 0);
  assert.equal(parsed.backup.plan.semesters[1].subjects[1].credit, '0');
  assert.equal(parsed.backup.plan.selectedSemesterId, 's2');
});

test('a backup keeps text that looks like markup as plain text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const source = plan({
    semesters: [
      { id: 's1', title: '<script>alert(2)</script>', subjects: [{ id: 'a1', name: payload, grade: 'S', credit: 3 }] }
    ]
  });

  const parsed = calc.parseBackup(JSON.stringify(calc.createBackup(source)));
  assert.equal(parsed.ok, true, 'a subject name is data, not a reason to reject a backup');
  assert.equal(parsed.backup.plan.semesters[0].subjects[0].name, payload);
  assert.equal(calc.escapeHtml(parsed.backup.plan.semesters[0].subjects[0].name), '&lt;img src=x onerror=alert(1)&gt;');
});

test('a restored plan is accepted by the saved-state sanitiser', () => {
  const backup = calc.createBackup(plan());
  const parsed = calc.parseBackup(JSON.stringify(backup));
  const sanitised = calc.sanitizeSavedState(parsed.backup.plan);

  assert.equal(sanitised.unrecoverable, false);
  assert.equal(sanitised.semesters.length, 1);
  assert.equal(sanitised.semesters[0].subjects.length, 2);
  assert.equal(sanitised.selectedGradingSystem, 'standard-btech');
});
