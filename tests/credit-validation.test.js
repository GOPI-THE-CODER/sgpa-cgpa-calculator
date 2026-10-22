'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calculator.js');

function subject(grade, credit) {
  return { id: `s-${grade}-${credit}`, name: `Subject ${grade}`, grade, credit };
}

function semester(subs) {
  return { id: 'semester-1', title: 'Semester 1', subjects: subs };
}

test('parseCredit rejects empty, malformed, negative and non-finite values', () => {
  const invalid = ['', '   ', '-2', '-0.5', '-', '.', 'abc', '3cr', '1,5', 'e3', 'Infinity', '-Infinity', 'NaN', null, undefined, NaN, Infinity, -Infinity];
  for (const raw of invalid) {
    assert.equal(calc.parseCredit(raw).valid, false, `should reject ${String(raw)}`);
  }
});

test('parseCredit accepts zero, integers and decimals (no maximum)', () => {
  const valid = [
    ['0', 0],
    ['0.0', 0],
    [0, 0],
    ['4', 4],
    [4, 4],
    ['1.5', 1.5],
    [1.5, 1.5],
    ['.5', 0.5],
    ['2.75', 2.75],
    ['3e2', 300],
    [' 7 ', 7]
  ];
  for (const [raw, expected] of valid) {
    const result = calc.parseCredit(raw);
    assert.equal(result.valid, true, `should accept ${String(raw)}`);
    assert.equal(result.value, expected, `value for ${String(raw)}`);
  }
});

test('invalid credits are excluded from metrics and still counted as invalid', () => {
  const sem = semester([subject('S', -2), subject('S', 'abc'), subject('S', 4)]);
  const m = calc.computeSemesterMetrics(sem.subjects, 'standard-btech');
  assert.equal(m.totalCredits, 4);
  assert.equal(m.totalPoints, 40);
  assert.equal(m.sgpa, 10);
  assert.equal(m.percent, 95);
  assert.equal(calc.getInvalidCreditCount([sem]), 2);
});

test('invalid credits are excluded from the overall summary without hiding the subjects', () => {
  const sem = semester([subject('S', -2), subject('S', 'abc'), subject('S', 4)]);
  const summary = calc.computeSummary([sem], 'standard-btech');
  assert.equal(summary.totalCredits, 4);
  assert.equal(summary.overallCgpa, 10);
  assert.equal(summary.totalSubjects, 3);
});

test('correcting an invalid credit restores normal calculation', () => {
  const s = subject('S', -2);
  let m = calc.computeSemesterMetrics([s], 'standard-btech');
  assert.equal(m.totalCredits, 0);
  assert.equal(m.sgpa, 0);
  assert.equal(calc.getInvalidCreditCount([semester([s])]), 1);

  s.credit = 4;
  m = calc.computeSemesterMetrics([s], 'standard-btech');
  assert.equal(m.totalCredits, 4);
  assert.equal(m.totalPoints, 40);
  assert.equal(m.sgpa, 10);
  assert.equal(calc.getInvalidCreditCount([semester([s])]), 0);
});

test('zero credit remains valid and preserves existing behavior', () => {
  const m = calc.computeSemesterMetrics([subject('S', 0), subject('A', 3)], 'standard-btech');
  assert.equal(m.totalCredits, 3);
  assert.equal(m.totalPoints, 27);
  assert.equal(m.sgpa, 9);
  assert.equal(calc.getInvalidCreditCount([semester([subject('S', 0)])]), 0);
});

test('empty string is invalid and never silently stored as zero', () => {
  assert.equal(calc.parseCredit('').valid, false);
  const m = calc.computeSemesterMetrics([subject('S', '')], 'standard-btech');
  assert.equal(m.totalCredits, 0);
  assert.equal(calc.getInvalidCreditCount([semester([subject('S', '')])]), 1);
});

test('decimal credits stay valid and calculate as before', () => {
  const m = calc.computeSemesterMetrics([subject('S', 1.5), subject('A', 2.5)], 'standard-btech');
  assert.equal(m.totalCredits, 4);
  assert.equal(m.totalPoints, 37.5);
  assert.equal(m.sgpa, 9.375);
  assert.equal(calc.getInvalidCreditCount([semester([subject('S', 1.5), subject('A', 2.5)])]), 0);
});

test('getInvalidCreditCount spans multiple semesters and stays read-only', () => {
  const a = { id: 'a', title: 'A', subjects: [subject('S', -1), subject('S', 3)] };
  const b = { id: 'b', title: 'B', subjects: [subject('S', 4), subject('S', Infinity)] };
  assert.equal(calc.getInvalidCreditCount([a, b]), 2);
  assert.equal(calc.getInvalidCreditCount([]), 0);
});
