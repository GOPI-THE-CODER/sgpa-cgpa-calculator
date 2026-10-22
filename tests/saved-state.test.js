'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../calculator.js');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function createIdFactory() {
  let counter = 0;
  return () => `generated-${++counter}`;
}

function sanitize(saved, fallbackSystem = 'standard-btech') {
  return calc.sanitizeSavedState(saved, { createId: createIdFactory(), fallbackSystem });
}

test('valid saved data is preserved exactly', () => {
  const saved = {
    semesters: [
      {
        id: 'sem-1',
        title: 'Semester One',
        subjects: [
          { id: 'sub-1', name: 'Mathematics', grade: 'E', credit: 'abc' },
          { id: 'sub-2', name: 'Physics', grade: 'S', credit: -1 },
          { id: 'sub-3', name: 'Chemistry — 日本語', grade: 'A+', credit: 0 },
          { id: 'sub-4', name: 'Elective', grade: 'D', credit: 3.5 }
        ]
      }
    ],
    selectedSemesterId: 'sem-1',
    selectedGradingSystem: 'jntu'
  };
  const snapshot = JSON.stringify(saved);
  const result = sanitize(saved);

  assert.equal(result.unrecoverable, false);
  assert.equal(result.repaired, false);
  assert.deepEqual(result.semesters, saved.semesters);
  assert.equal(result.selectedSemesterId, 'sem-1');
  assert.equal(result.selectedGradingSystem, 'jntu');
  assert.equal(JSON.stringify(saved), snapshot);
});

test('malformed top-level data is unrecoverable and keeps system selection safe', () => {
  const badValues = [null, undefined, 'text', 42, [], {}, { semesters: null }, { semesters: 'nope' }];

  for (const bad of badValues) {
    const result = sanitize(bad, 'vtu');
    assert.equal(result.unrecoverable, true, `expected unrecoverable for ${String(bad)}`);
    assert.deepEqual(result.semesters, []);
    assert.equal(result.selectedSemesterId, null);
    assert.equal(result.selectedGradingSystem, 'vtu');
  }

  const unknownSavedSystem = sanitize({ semesters: [], selectedGradingSystem: 'bogus' }, 'vtu');
  assert.equal(unknownSavedSystem.selectedGradingSystem, 'standard-btech');
});

test('a semester without subjects is repaired to an empty subject list', () => {
  const result = sanitize({
    semesters: [{ id: 'sem-1', title: 'Semester One' }],
    selectedSemesterId: 'sem-1',
    selectedGradingSystem: 'standard-btech'
  });

  assert.equal(result.unrecoverable, false);
  assert.equal(result.repaired, true);
  assert.deepEqual(result.semesters, [{ id: 'sem-1', title: 'Semester One', subjects: [] }]);
  assert.equal(result.selectedSemesterId, 'sem-1');
});

test('invalid entries are dropped and missing fields are filled safely', () => {
  const result = sanitize({
    semesters: [
      null,
      'bad',
      7,
      { id: 'good', title: 'Good', subjects: [null, 'x', 7, { id: 'subject-1' }] },
      { id: 'no-title', subjects: 'nope' }
    ],
    selectedSemesterId: 'good',
    selectedGradingSystem: 'standard-btech'
  });

  assert.equal(result.unrecoverable, false);
  assert.equal(result.repaired, true);
  assert.equal(result.semesters.length, 2);
  assert.deepEqual(result.semesters[0], {
    id: 'good',
    title: 'Good',
    subjects: [{ id: 'subject-1', name: '', grade: '', credit: '' }]
  });
  assert.deepEqual(result.semesters[1], { id: 'no-title', title: 'Semester 2', subjects: [] });
  assert.equal(result.selectedSemesterId, 'good');

  const nonStringTitle = sanitize({
    semesters: [{ id: 'x', title: 42, subjects: [] }],
    selectedSemesterId: 'x',
    selectedGradingSystem: 'standard-btech'
  });
  assert.equal(nonStringTitle.semesters[0].title, 'Semester 1');
});

test('duplicate and missing IDs are repaired while stable references are kept', () => {
  const result = sanitize({
    semesters: [
      {
        id: 'dup',
        title: 'First',
        subjects: [
          { id: 'same', name: 'A', grade: 'S', credit: 3 },
          { name: 'No Id', grade: 'A', credit: 4 }
        ]
      },
      {
        id: 'dup',
        title: 'Second',
        subjects: [
          { id: 'same', name: 'B', grade: 'B', credit: 5 },
          { id: '', name: 'Empty Id', grade: 'C', credit: 6 }
        ]
      }
    ],
    selectedSemesterId: 'dup',
    selectedGradingSystem: 'standard-btech'
  });

  assert.equal(result.repaired, true);
  assert.equal(result.selectedSemesterId, 'dup');
  assert.equal(result.semesters[0].id, 'dup');
  assert.notEqual(result.semesters[1].id, 'dup');

  const semesterIds = result.semesters.map((semester) => semester.id);
  const subjectIds = result.semesters.flatMap((semester) => semester.subjects.map((subject) => subject.id));

  assert.equal(new Set(semesterIds).size, 2);
  assert.equal(new Set(subjectIds).size, 4);
  assert.ok(semesterIds.every((id) => typeof id === 'string' && id !== ''));
  assert.ok(subjectIds.every((id) => typeof id === 'string' && id !== ''));
  assert.equal(subjectIds[0], 'same');
  assert.equal(result.semesters[0].subjects[1].name, 'No Id');
  assert.equal(result.semesters[1].subjects[1].credit, 6);
});

test('unsupported and missing grades are never replaced with a supported grade', () => {
  const result = sanitize({
    semesters: [
      {
        id: 'sem-1',
        title: 'Semester One',
        subjects: [
          { id: 'sub-1', name: 'A', grade: 'E', credit: 1 },
          { id: 'sub-2', name: 'B', grade: 'custom', credit: 2 },
          { id: 'sub-3', name: 'C', grade: '', credit: 3 },
          { id: 'sub-4', name: 'D', credit: 4 }
        ]
      }
    ],
    selectedSemesterId: 'sem-1',
    selectedGradingSystem: 'jntu'
  });

  assert.equal(result.semesters[0].subjects[0].grade, 'E');
  assert.equal(result.semesters[0].subjects[1].grade, 'custom');
  assert.equal(result.semesters[0].subjects[2].grade, '');
  assert.equal(result.semesters[0].subjects[3].grade, '');
  assert.equal(result.semesters[0].subjects[3].id, 'sub-4');
  assert.equal(result.repaired, true);
});

test('grading-system selection mirrors the existing fallback rules', () => {
  const base = {
    semesters: [{ id: 'sem-1', title: 'Semester One', subjects: [] }],
    selectedSemesterId: 'sem-1'
  };

  assert.equal(sanitize({ ...base, selectedGradingSystem: 'jntu' }, 'vtu').selectedGradingSystem, 'jntu');
  assert.equal(sanitize({ ...base, selectedGradingSystem: '' }, 'vtu').selectedGradingSystem, 'vtu');
  assert.equal(sanitize({ ...base, selectedGradingSystem: 'bogus' }, 'vtu').selectedGradingSystem, 'standard-btech');
  assert.equal(sanitize(base, 'bogus').selectedGradingSystem, 'standard-btech');
});

test('loadState delegates to the sanitizer and records a recovery notice', () => {
  const match = scriptSource.match(/function loadState\([\s\S]*?\n}/);
  assert.ok(match, 'loadState must exist');
  const body = match[0];
  assert.ok(body.includes('sanitizeSavedState'));
  assert.ok(body.includes('stateRecoveryNotice'));
  assert.ok(body.includes('buildInitialState'));
});

test('initializeApp persists and announces a recovered state', () => {
  const match = scriptSource.match(/function initializeApp\([\s\S]*?\n}/);
  assert.ok(match, 'initializeApp must exist');
  const body = match[0];
  assert.ok(/stateRecoveryNotice/.test(body));
  assert.ok(/saveState\(\)/.test(body));
  assert.ok(/showToast\(/.test(body));
});

test('buildInitialState validates the legacy grading-system key', () => {
  const match = scriptSource.match(/function buildInitialState\([\s\S]*?\n}/);
  assert.ok(match, 'buildInitialState must exist');
  assert.ok(/gradingSystems\[legacySystem\]/.test(match[0]));
});
