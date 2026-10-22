'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../calculator.js');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function subject(grade, credit) {
  return { id: `s-${grade}-${credit}`, name: `Subject ${grade}`, grade, credit };
}

function semester(subs) {
  return { id: 'semester-1', title: 'Semester 1', subjects: subs };
}

test('no invalid entries reports complete results', () => {
  const sem = semester([subject('S', 4), subject('A', 3), subject('F', 2)]);
  const report = calc.getIncompleteReport([sem], 'standard-btech');
  assert.deepEqual(report, { invalidCreditCount: 0, unsupportedGradeCount: 0, incomplete: false });
});

test('invalid credits only are counted and flagged', () => {
  const sem = semester([subject('S', 4), subject('A', -1), subject('B', 'abc')]);
  const report = calc.getIncompleteReport([sem], 'standard-btech');
  assert.equal(report.invalidCreditCount, 2);
  assert.equal(report.unsupportedGradeCount, 0);
  assert.equal(report.incomplete, true);
});

test('unsupported grades only are counted and flagged', () => {
  const sem = semester([subject('A', 4), subject('E', 3)]);
  const report = calc.getIncompleteReport([sem], 'jntu');
  assert.equal(report.invalidCreditCount, 0);
  assert.equal(report.unsupportedGradeCount, 1);
  assert.equal(report.incomplete, true);
});

test('both issue types are counted separately', () => {
  const sem = semester([subject('E', ''), subject('A', 4)]);
  const report = calc.getIncompleteReport([sem], 'jntu');
  assert.equal(report.invalidCreditCount, 1);
  assert.equal(report.unsupportedGradeCount, 1);
  assert.equal(report.incomplete, true);
});

test('unknown grading-system ids are handled safely via the default fallback', () => {
  const sem = semester([subject('S', 4), subject('F', 3)]);
  let report;
  assert.doesNotThrow(() => {
    report = calc.getIncompleteReport([sem], 'not-a-system');
  });
  assert.equal(report.invalidCreditCount, 0);
  assert.equal(report.unsupportedGradeCount, 0);
  assert.equal(report.incomplete, false);
});

test('a valid F grade is distinct from an unsupported grade', () => {
  const compatible = calc.getIncompleteReport([semester([subject('F', 3)])], 'standard-btech');
  assert.equal(compatible.unsupportedGradeCount, 0);
  assert.equal(compatible.incomplete, false);

  const incompatible = calc.getIncompleteReport([semester([subject('F', 3)])], 'jntu');
  assert.equal(incompatible.unsupportedGradeCount, 0);
  assert.equal(incompatible.incomplete, false);

  const jntuMissing = calc.getIncompleteReport([semester([subject('E', 3)])], 'jntu');
  assert.equal(jntuMissing.unsupportedGradeCount, 1);
  assert.equal(jntuMissing.incomplete, true);
});

test('the validation banner reuses getIncompleteReport (no duplicate counting)', () => {
  const match = scriptSource.match(/function updateValidationBanner\([\s\S]*?\n}/);
  assert.ok(match, 'updateValidationBanner must exist');
  assert.ok(match[0].includes('getIncompleteReport'));
  assert.equal(/getInvalidCreditCount/.test(match[0]), false);
  assert.equal(/getUnsupportedGrades/.test(match[0]), false);
});

test('the printable report includes an incomplete-results warning path', () => {
  const match = scriptSource.match(/function buildReportElement\([\s\S]*?\n}/);
  assert.ok(match, 'buildReportElement must exist');
  const body = match[0];
  assert.ok(body.includes('getIncompleteReport'));
  assert.ok(body.includes('pdf-warning'));
  assert.ok(/incomplete\.invalidCreditCount/.test(body));
  assert.ok(/incomplete\.unsupportedGradeCount/.test(body));
  assert.ok(/escapeHtml\(/.test(body));
});

test('the clipboard summary includes an incomplete-results warning path', () => {
  const match = scriptSource.match(/function copySummary\([\s\S]*?\n}/);
  assert.ok(match, 'copySummary must exist');
  const body = match[0];
  assert.ok(body.includes('getIncompleteReport'));
  assert.ok(/WARNING/i.test(body));
  assert.ok(/invalidCreditCount/.test(body));
  assert.ok(/unsupportedGradeCount/.test(body));
});
