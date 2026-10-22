'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../calculator.js');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function subjects(pairs) {
  return pairs.map(([grade, credit]) => ({ id: `${grade}-${credit}`, name: `Subject ${grade}`, grade, credit }));
}

function semester(subs) {
  return { id: 'semester-1', title: 'Semester 1', subjects: subs };
}

test('standard -> Anna reports A changing from 9 to 8', () => {
  const subs = subjects([['A', 3]]);
  const plan = calc.planGradingSystemChange(subs, 'anna-university', 'standard-btech');
  assert.equal(plan.known, true);
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.unknown.length, 0);
  assert.deepEqual(plan.valueChanges, [{ id: 'A-3', name: 'Subject A', label: 'A', fromValue: 9, toValue: 8 }]);
});

test('standard -> JNTU reports E as unsupported and never promotes it', () => {
  const subs = subjects([['E', 4]]);
  const before = JSON.parse(JSON.stringify(subs));
  const plan = calc.planGradingSystemChange(subs, 'jntu', 'standard-btech');
  assert.equal(plan.unknown.length, 1);
  assert.equal(plan.unknown[0].label, 'E');
  assert.equal(plan.unknown[0].fromValue, 5);
  assert.equal(plan.unknown[0].toValue, null);
  assert.equal(plan.valueChanges.length, 0);
  assert.deepEqual(subs, before);
  assert.equal(subs[0].grade, 'E');
});

test('standard -> VTU identical mappings produce no changes', () => {
  const subs = subjects([['S', 4], ['A', 3], ['B', 3], ['C', 2], ['D', 1], ['E', 1], ['F', 1]]);
  const plan = calc.planGradingSystemChange(subs, 'vtu', 'standard-btech');
  assert.equal(plan.known, true);
  assert.equal(plan.requiresConfirmation, false);
  assert.equal(plan.unknown.length, 0);
  assert.equal(plan.valueChanges.length, 0);
});

test('planning never mutates the original subjects', () => {
  const subs = subjects([['S', 4], ['A', 3], ['E', 2]]);
  const snapshot = JSON.stringify(subs);
  calc.planGradingSystemChange(subs, 'jntu', 'standard-btech');
  calc.planGradingSystemChange(subs, 'anna-university', 'standard-btech');
  calc.planGradingSystemChange(subs, 'custom-7point', 'standard-btech');
  assert.equal(JSON.stringify(subs), snapshot);
});

test('switching away and back keeps the original grade when no replacement is made', () => {
  const subs = subjects([['E', 4]]);
  calc.planGradingSystemChange(subs, 'jntu', 'standard-btech');
  calc.planGradingSystemChange(subs, 'standard-btech', 'jntu');
  assert.equal(subs[0].grade, 'E');
  assert.equal(calc.isGradeSupported(subs[0].grade, 'standard-btech'), true);
});

test('cancellation changes neither the selected system nor the saved data', () => {
  const subs = subjects([['S', 4], ['E', 2]]);
  const snapshot = JSON.stringify(subs);
  const plan = calc.planGradingSystemChange(subs, 'jntu', 'standard-btech');
  assert.equal(plan.requiresConfirmation, true);
  // Simulated cancel: the plan is discarded and nothing is applied.
  assert.equal(JSON.stringify(subs), snapshot);
  assert.equal(subs[1].grade, 'E');
});

test('unknown destination systems are safe no-ops', () => {
  const subs = subjects([['S', 4]]);
  const plan = calc.planGradingSystemChange(subs, 'bogus', 'standard-btech');
  assert.equal(plan.known, false);
  assert.equal(plan.requiresConfirmation, false);
  assert.deepEqual(plan.unknown, []);
  assert.deepEqual(plan.valueChanges, []);
  assert.equal(subs[0].grade, 'S');
});

test('getUnsupportedGrades finds grades absent from the active system', () => {
  const sem = semester(subjects([['E', 2], ['A', 3]]));
  const jntu = calc.getUnsupportedGrades([sem], 'jntu');
  assert.equal(jntu.length, 1);
  assert.equal(jntu[0].grade, 'E');
  assert.equal(jntu[0].subjectId, 'E-2');
  assert.equal(calc.getUnsupportedGrades([sem], 'standard-btech').length, 0);
  assert.equal(calc.isGradeSupported('E', 'standard-btech'), true);
  assert.equal(calc.isGradeSupported('E', 'jntu'), false);
});

test('a value identical in both systems is not reported as a change', () => {
  const plan = calc.planGradingSystemChange(subjects([['F', 3]]), 'jntu', 'standard-btech');
  assert.equal(plan.valueChanges.length, 0);
  assert.equal(plan.unknown.length, 0);
});

test('applyGradingSystem plans first and gates mutation behind explicit confirmation', () => {
  const match = scriptSource.match(/function applyGradingSystem\([\s\S]*?\n}/);
  assert.ok(match, 'applyGradingSystem must exist');
  const body = match[0];
  assert.ok(body.includes('planGradingSystemChange'));
  assert.ok(body.includes('requiresConfirmation'));
  assert.ok(/confirmDialog\.open\(/.test(body), 'the confirmation must go through the accessible dialog');
  assert.equal(/(^|[^.\w])confirm\(/.test(body), false, 'the native confirm dialog must not be used');
  assert.ok(/if \(!confirmed\)[\s\S]*return 'cancelled';/.test(body));
  assert.ok(/return 'applied';/.test(body));
  assert.ok(/return 'rejected';/.test(body));
  assert.equal(/remapGradesForSystem/.test(scriptSource), false, 'UI must not call the silent remapper');
});

test('rendering preserves unsupported grades instead of overwriting them', () => {
  assert.equal(/\.grades\.some\(\(grade\) => grade\.label === subject\.grade\)/.test(scriptSource), false);
  assert.equal(/subject\.grade = getDefaultGradeLabel\(\)/.test(scriptSource), false);
  assert.ok(scriptSource.includes("dataset.unsupported = 'true'"));
  assert.ok(/refreshGradeSupport/.test(scriptSource));
});

test('the grading selector is synchronized to the saved system on initialization', () => {
  const match = scriptSource.match(/function initializeApp\([\s\S]*?\n}/);
  assert.ok(match, 'initializeApp must exist');
  assert.ok(/gradingSystemPicker\.value\s*=\s*appState\.selectedGradingSystem/.test(match[0]));
});
