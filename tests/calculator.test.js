'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calculator.js');

function subjects(pairs) {
  return pairs.map(([grade, credit]) => ({ id: `${grade}-${credit}`, name: `Subject ${grade}`, grade, credit }));
}

function semester(subs) {
  return { id: 'semester-1', title: 'Semester 1', subjects: subs };
}

test('T1 standard mapping: all-S semester', () => {
  const m = calc.computeSemesterMetrics(subjects([['S', 4], ['S', 3], ['S', 3], ['S', 2]]), 'standard-btech');
  assert.equal(m.totalCredits, 12);
  assert.equal(m.totalPoints, 120);
  assert.equal(m.sgpa, 10);
  assert.equal(m.percent, 95);
  assert.equal(m.sgpa.toFixed(2), '10.00');
  assert.equal(m.percent.toFixed(2), '95.00');
  assert.equal(m.gradePointAverage, 10);
});

test('T2a standard grade mapping values', () => {
  const expected = { S: 10, A: 9, B: 8, C: 7, D: 6, E: 5, F: 0 };
  for (const [grade, value] of Object.entries(expected)) {
    const m = calc.computeSemesterMetrics(subjects([[grade, 1]]), 'standard-btech');
    assert.equal(m.totalPoints, value, `standard grade ${grade}`);
  }
});

test('T2b JNTU grade mapping values', () => {
  const expected = { 'A+': 10, A: 9, 'B+': 8, B: 7, C: 6, D: 5, F: 0 };
  for (const [grade, value] of Object.entries(expected)) {
    const m = calc.computeSemesterMetrics(subjects([[grade, 1]]), 'jntu');
    assert.equal(m.totalPoints, value, `jntu grade ${grade}`);
  }
});

test('T3 F grades contribute zero points while credits still count', () => {
  const m = calc.computeSemesterMetrics(subjects([['F', 4], ['S', 3], ['S', 3]]), 'standard-btech');
  assert.equal(m.totalCredits, 10);
  assert.equal(m.totalPoints, 60);
  assert.equal(m.sgpa.toFixed(2), '6.00');
  assert.equal(m.percent.toFixed(2), '57.00');
});

test('T4 mixed weighted semester', () => {
  const m = calc.computeSemesterMetrics(subjects([['A', 4], ['S', 3], ['C', 3], ['F', 2]]), 'standard-btech');
  assert.equal(m.totalCredits, 12);
  assert.equal(m.totalPoints, 87);
  assert.equal(m.sgpa, 7.25);
  assert.equal(m.percent, 68.875);
});

test('T5 zero-credit subject and zero-credit semester', () => {
  const zero = calc.computeSemesterMetrics(subjects([['S', 0]]), 'standard-btech');
  assert.equal(zero.totalCredits, 0);
  assert.equal(zero.sgpa, 0);
  assert.equal(zero.percent, 0);

  const summary = calc.computeSummary(
    [semester(subjects([['S', 4]])), semester(subjects([['S', 0]]))],
    'standard-btech'
  );
  assert.equal(summary.totalCredits, 4);
  assert.equal(summary.overallCgpa, 10);
  assert.equal(summary.currentSgpa, 0);
  assert.equal(summary.bestSgpa, 10);
  assert.equal(summary.worstSgpa, 10);
  assert.equal(summary.averageSgpa, 10);
  assert.equal(summary.semesterCount, 2);
  assert.equal(summary.totalSubjects, 2);
});

test('T6 unknown grade contributes zero points but counts credits (current behavior)', () => {
  const m = calc.computeSemesterMetrics(subjects([['X', 3]]), 'standard-btech');
  assert.equal(m.totalCredits, 3);
  assert.equal(m.totalPoints, 0);
  assert.equal(m.sgpa, 0);
  assert.equal(m.percent, 0);
});

test('T7 decimal credits', () => {
  const m = calc.computeSemesterMetrics(subjects([['S', 1.5], ['A', 2.5]]), 'standard-btech');
  assert.equal(m.totalCredits, 4);
  assert.equal(m.totalPoints, 37.5);
  assert.equal(m.sgpa, 9.375);
  assert.equal(m.percent, 89.0625);
});

test('T8 weighted CGPA is not the arithmetic mean of SGPAs', () => {
  const summary = calc.computeSummary(
    [semester(subjects([['S', 4]])), semester(subjects([['F', 3]]))],
    'standard-btech'
  );
  assert.equal(summary.totalCredits, 7);
  assert.equal(summary.overallCgpa, 40 / 7);
  assert.equal(summary.overallCgpa.toFixed(2), '5.71');
  assert.notEqual(summary.overallCgpa.toFixed(2), '5.00');
  assert.equal(summary.overallPercent.toFixed(2), '54.29');
  assert.equal(summary.currentSgpa, 0);
  assert.equal(summary.bestSgpa, 10);
  assert.equal(summary.worstSgpa, 0);
  assert.equal(summary.averageSgpa, 5);
});

test('T8b 0.00 SGPA semesters with credits count; zero-credit semesters stay excluded', () => {
  const summary = calc.computeSummary(
    [
      semester(subjects([['S', 4]])),
      semester(subjects([['F', 3]])),
      semester(subjects([['C', 2]])),
      semester(subjects([['S', 0]]))
    ],
    'standard-btech'
  );

  assert.equal(summary.bestSgpa, 10);
  assert.equal(summary.worstSgpa, 0);
  assert.equal(summary.averageSgpa, 17 / 3);
});

test('T9 display rounding matches the UI toFixed(2) formatting', () => {
  const mixed = calc.computeSemesterMetrics(subjects([['A', 4], ['S', 3], ['C', 3], ['F', 2]]), 'standard-btech');
  assert.equal(mixed.sgpa.toFixed(2), '7.25');
  assert.equal(mixed.percent.toFixed(2), '68.88');

  const decimal = calc.computeSemesterMetrics(subjects([['S', 1.5], ['A', 2.5]]), 'standard-btech');
  assert.equal(decimal.sgpa.toFixed(2), '9.38');
  assert.equal(decimal.percent.toFixed(2), '89.06');

  const summary = calc.computeSummary(
    [semester(subjects([['S', 4]])), semester(subjects([['F', 3]]))],
    'standard-btech'
  );
  assert.equal(summary.overallCgpa.toFixed(2), '5.71');
  assert.equal(summary.overallPercent.toFixed(2), '54.29');
});

test('T10 invalid negative credits are excluded and reported (no contamination)', () => {
  const solo = calc.computeSemesterMetrics(subjects([['S', -2]]), 'standard-btech');
  assert.equal(solo.totalCredits, 0);
  assert.equal(solo.totalPoints, 0);
  assert.equal(solo.sgpa, 0);
  assert.equal(calc.getInvalidCreditCount([semester(subjects([['S', -2]]))]), 1);

  const mixed = calc.computeSemesterMetrics(subjects([['S', -2], ['S', 3]]), 'standard-btech');
  assert.equal(mixed.totalCredits, 3);
  assert.equal(mixed.totalPoints, 30);
  assert.equal(mixed.sgpa.toFixed(2), '10.00');
});

test('T11 non-finite and malformed credits are excluded and counted invalid', () => {
  for (const bad of [Infinity, -Infinity, NaN, 'abc', '', '   ', '3cr']) {
    const m = calc.computeSemesterMetrics(subjects([['S', bad]]), 'standard-btech');
    assert.equal(m.totalCredits, 0, `credits for ${String(bad)}`);
    assert.equal(m.totalPoints, 0, `points for ${String(bad)}`);
    assert.equal(m.sgpa, 0, `sgpa for ${String(bad)}`);
    assert.equal(m.percent, 0, `percent for ${String(bad)}`);
    assert.equal(calc.getInvalidCreditCount([semester(subjects([['S', bad]]))]), 1, `invalid count for ${String(bad)}`);
  }

  const validZero = calc.computeSemesterMetrics(subjects([['S', 0]]), 'standard-btech');
  assert.equal(validZero.totalCredits, 0);
  assert.equal(calc.getInvalidCreditCount([semester(subjects([['S', 0]]))]), 0);
});

test('T12 grading-system switches are planned without silent grade mutation', () => {
  const subs = subjects([['S', 3], ['A', 3], ['B', 3], ['C', 3], ['D', 3], ['E', 3], ['F', 3]]);
  const originalLabels = subs.map((subject) => subject.grade);

  const plan = calc.planGradingSystemChange(subs, 'jntu', 'standard-btech');
  assert.equal(plan.known, true);
  assert.equal(plan.requiresConfirmation, true);
  assert.deepEqual(plan.unknown.map((change) => change.label).sort(), ['E', 'S']);
  assert.deepEqual(plan.valueChanges.map((change) => change.label).sort(), ['B', 'C', 'D']);
  assert.deepEqual(subs.map((subject) => subject.grade), originalLabels);
});

test('T12b remapping ignores an unknown grading system', () => {
  const subs = subjects([['S', 3], ['F', 3]]);
  calc.remapGradesForSystem(subs, 'bogus');
  assert.deepEqual(subs.map((subject) => subject.grade), ['S', 'F']);
});

test('T13 scale lookup fallback and default grade label', () => {
  assert.equal(calc.DEFAULT_GRADING_SYSTEM, 'standard-btech');
  assert.deepEqual(calc.getCurrentGradeScale('bogus'), calc.getCurrentGradeScale('standard-btech'));
  assert.equal(calc.getCurrentGradeScale().S, 10);
  assert.equal(calc.getCurrentGradeScale('jntu')['A+'], 10);
  assert.equal(calc.getDefaultGradeLabel('jntu'), 'A+');
  assert.equal(calc.getDefaultGradeLabel('standard-btech'), 'S');
  assert.equal(calc.getDefaultGradeLabel('bogus'), 'S');
});

test('T14 empty input does not throw and return shapes stay stable', () => {
  const summary = calc.computeSummary([], 'standard-btech');
  assert.equal(summary.semesterCount, 0);
  assert.equal(summary.overallCgpa, 0);
  assert.equal(summary.currentSgpa, 0);
  assert.deepEqual(
    Object.keys(summary).sort(),
    [
      'averageSgpa',
      'bestSgpa',
      'currentSgpa',
      'overallCgpa',
      'overallPercent',
      'semesterCount',
      'totalCredits',
      'totalSubjects',
      'worstSgpa'
    ].sort()
  );

  const m = calc.computeSemesterMetrics([], 'standard-btech');
  assert.deepEqual(
    Object.keys(m).sort(),
    ['gradePointAverage', 'percent', 'sgpa', 'totalCredits', 'totalPoints'].sort()
  );
});

test('T15 performance note thresholds', () => {
  assert.equal(calc.determineAward(9), 'Outstanding performance');
  assert.equal(calc.determineAward(8.99), 'Excellent trajectory');
  assert.equal(calc.determineAward(8), 'Excellent trajectory');
  assert.equal(calc.determineAward(7), 'Strong progress');
  assert.equal(calc.determineAward(0.01), 'Keep improving');
  assert.equal(calc.determineAward(0, { hasSemesterData: false }), 'Start adding semester data');
});

test('T15b performance note distinguishes no data, zero CGPA, and incomplete results', () => {
  const none = calc.computeSummary([], 'standard-btech');
  assert.equal(calc.determineAward(none.overallCgpa), 'Start adding semester data');

  const allFSubjects = [semester(subjects([['F', 4]]))];
  const allF = calc.computeSummary(allFSubjects, 'standard-btech');
  const allFReport = calc.getIncompleteReport(allFSubjects, 'standard-btech');
  assert.equal(allF.overallCgpa, 0);
  assert.equal(allFReport.incomplete, false);
  assert.equal(
    calc.determineAward(allF.overallCgpa, { hasSemesterData: true, incomplete: allFReport.incomplete }),
    'No points earned yet — review your subjects'
  );
  assert.notEqual(
    calc.determineAward(allF.overallCgpa, { hasSemesterData: true, incomplete: allFReport.incomplete }),
    'Start adding semester data'
  );

  const invalidCreditSubjects = [semester(subjects([['S', 'abc']]))];
  const invalidCredit = calc.computeSummary(invalidCreditSubjects, 'standard-btech');
  const invalidCreditReport = calc.getIncompleteReport(invalidCreditSubjects, 'standard-btech');
  assert.equal(invalidCredit.overallCgpa, 0);
  assert.equal(invalidCreditReport.incomplete, true);
  assert.equal(
    calc.determineAward(invalidCredit.overallCgpa, { hasSemesterData: true, incomplete: invalidCreditReport.incomplete }),
    'Results incomplete — review flagged subjects'
  );

  const unsupportedSubjects = [semester(subjects([['E', 4]]))];
  const unsupported = calc.computeSummary(unsupportedSubjects, 'jntu');
  const unsupportedReport = calc.getIncompleteReport(unsupportedSubjects, 'jntu');
  assert.equal(unsupported.overallCgpa, 0);
  assert.equal(unsupportedReport.incomplete, true);
  assert.equal(
    calc.determineAward(unsupported.overallCgpa, { hasSemesterData: true, incomplete: unsupportedReport.incomplete }),
    'Results incomplete — review flagged subjects'
  );
});

test('T16 custom 7-point mapping values and default grade', () => {
  const expected = { A: 7, B: 6, C: 5, D: 4, E: 3, F: 0 };
  for (const [grade, value] of Object.entries(expected)) {
    const m = calc.computeSemesterMetrics(subjects([[grade, 1]]), 'custom-7point');
    assert.equal(m.totalPoints, value, `custom 7-point grade ${grade}`);
  }
  assert.equal(calc.getDefaultGradeLabel('custom-7point'), 'A', 'the default grade is the first scale entry');

  const weighted = calc.computeSemesterMetrics(subjects([['A', 4], ['C', 4]]), 'custom-7point');
  assert.equal(weighted.totalCredits, 8);
  assert.equal(weighted.totalPoints, 48);
  assert.equal(weighted.sgpa, 6);
  assert.equal(weighted.percent, 57);
});

test('T17 Anna University mapping values and default grade', () => {
  const expected = { O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, F: 0 };
  for (const [grade, value] of Object.entries(expected)) {
    const m = calc.computeSemesterMetrics(subjects([[grade, 1]]), 'anna-university');
    assert.equal(m.totalPoints, value, `anna university grade ${grade}`);
  }
  assert.equal(calc.getDefaultGradeLabel('anna-university'), 'O', 'the default grade is the first scale entry');

  const weighted = calc.computeSemesterMetrics(subjects([['O', 3], ['A+', 3]]), 'anna-university');
  assert.equal(weighted.totalCredits, 6);
  assert.equal(weighted.totalPoints, 57);
  assert.equal(weighted.sgpa, 9.5);
  assert.equal(weighted.percent, 90.25);

  // grades that only exist in another scale stay unsupported instead of being remapped
  const report = calc.getIncompleteReport([semester(subjects([['S', 4]]))], 'anna-university');
  assert.equal(report.unsupportedGradeCount, 1, 'a standard grade is unsupported under Anna University');
  assert.equal(report.incomplete, true);
});

test('T15 an inherited object member is never treated as a grade value', () => {
  // "constructor", "toString" and friends exist on every object. A label like
  // that must count as an unsupported grade worth zero points, never as a
  // function that turns every total into NaN.
  for (const label of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const metrics = calc.computeSemesterMetrics(subjects([[label, 3]]), 'standard-btech');
    assert.equal(metrics.totalCredits, 3, `${label} still counts its credits`);
    assert.equal(metrics.totalPoints, 0, `${label} must contribute zero points`);
    assert.equal(metrics.sgpa, 0, `${label} must not produce NaN`);
    assert.ok(Number.isFinite(metrics.percent), `${label} must not produce a NaN percentage`);
  }

  const summary = calc.computeSummary([semester(subjects([['constructor', 3], ['S', 3]]))], 'standard-btech');
  assert.ok(Number.isFinite(summary.overallCgpa), 'the summary stays a finite number');
  assert.equal(summary.overallCgpa, 5);
  assert.ok(Number.isFinite(summary.averageSgpa));
  assert.ok(Number.isFinite(summary.bestSgpa));
  assert.ok(Number.isFinite(summary.worstSgpa));
  assert.ok(Number.isFinite(summary.overallPercent));
});

test('T16 a grade that exists in the scale keeps its exact value', () => {
  const metrics = calc.computeSemesterMetrics(subjects([['S', 4], ['A', 4], ['F', 4]]), 'standard-btech');
  assert.equal(metrics.totalCredits, 12);
  assert.equal(metrics.totalPoints, 76);
  assert.equal(metrics.sgpa, 76 / 12);
});

test('T17 the legacy remapper no longer rewrites the subjects it is given', () => {
  const subs = subjects([['S', 3], ['F', 3]]);
  const remapped = calc.remapGradesForSystem(subs, 'jntu');

  assert.deepEqual(subs.map((subject) => subject.grade), ['S', 'F'], 'the input is untouched');
  assert.notEqual(remapped, subs, 'a new list is returned');
  assert.deepEqual(remapped.map((subject) => subject.grade), ['A+', 'F'], 'only the grade the target system lacks is replaced');
});
