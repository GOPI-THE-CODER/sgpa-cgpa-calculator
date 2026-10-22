'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const calc = require('../calculator.js');

const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function reEsc(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TEMPLATE_SINKS = [...scriptSource.matchAll(/\.innerHTML\s*=\s*`([\s\S]*?)`/g)].map((match) => match[1]);
const TAINTED_FIELDS = ['subject.name', 'subject.credit', 'subject.grade', 'semester.title', 'subject.id'];

test('escapeHtml neutralizes angle brackets, quotes and ampersands', () => {
  assert.equal(calc.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(calc.escapeHtml('"><script>alert(1)</script>'), '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(calc.escapeHtml('a & b'), 'a &amp; b');
  assert.equal(calc.escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(calc.escapeHtml("O'Brien"), 'O&#39;Brien');
  assert.equal(calc.escapeHtml('</td><td>x'), '&lt;/td&gt;&lt;td&gt;x');
});

test('escapeHtml encodes ampersand before other entities (no double-decoding)', () => {
  assert.equal(calc.escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(calc.escapeHtml('&amp;'), '&amp;amp;');
});

test('escapeHtml leaves non-dangerous text and Unicode intact', () => {
  assert.equal(calc.escapeHtml('café — 日本語 😀 100%'), 'café — 日本語 😀 100%');
  assert.equal(calc.escapeHtml('C++ & "Java"'), 'C++ &amp; &quot;Java&quot;');
});

test('escapeHtml handles non-string and empty input safely', () => {
  assert.equal(calc.escapeHtml(null), '');
  assert.equal(calc.escapeHtml(undefined), '');
  assert.equal(calc.escapeHtml(''), '');
  assert.equal(calc.escapeHtml(0), '0');
  assert.equal(calc.escapeHtml(4), '4');
  assert.equal(calc.escapeHtml(1.5), '1.5');
});

test('escaped payload contains no executable angle brackets', () => {
  const payload = '<svg/onload=alert(document.domain)>';
  const escaped = calc.escapeHtml(payload);
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
});

test('innerHTML templates never emit a tainted field as raw, unescaped output', () => {
  assert.ok(TEMPLATE_SINKS.length > 0, 'expected at least one innerHTML template to scan');
  for (const template of TEMPLATE_SINKS) {
    for (const field of TAINTED_FIELDS) {
      const rawOutput = new RegExp('\\$\\{\\s*' + reEsc(field) + '\\s*\\}');
      assert.equal(rawOutput.test(template), false, `raw unescaped output of ${field} inside an innerHTML template`);
    }
  }
});

test('tainted fields rendered as text are wrapped in escapeHtml', () => {
  for (const field of TAINTED_FIELDS) {
    if (field === 'subject.id') continue;
    const escaped = new RegExp('escapeHtml\\s*\\(\\s*' + reEsc(field) + '\\s*\\)');
    assert.ok(escaped.test(scriptSource), `expected escapeHtml(${field})`);
  }

  assert.ok(
    /createSubjectControlIds\s*\(\s*semester\.id\s*,\s*subject\.id\s*,/.test(scriptSource),
    'subject.id must be encoded into control IDs rather than rendered raw'
  );
  for (const key of ['name', 'grade', 'credit', 'gradeError', 'creditError']) {
    assert.ok(
      new RegExp('escapeHtml\\s*\\(\\s*controlIds\\.' + key + '\\s*\\)').test(scriptSource),
      `expected escapeHtml(controlIds.${key})`
    );
  }
});

test('subject name and credit are assigned through DOM properties, not value attributes', () => {
  assert.ok(/nameInput\.value\s*=\s*subject\.name/.test(scriptSource));
  assert.ok(/creditInput\.value\s*=\s*subject\.credit/.test(scriptSource));
  assert.equal(/value\s*=\s*"\$\{\s*subject\.(name|credit)/.test(scriptSource), false);
});

test('toast messages are rendered through textContent instead of interpolation', () => {
  assert.ok(/toast-message[\s\S]{0,120}?textContent\s*=\s*message/.test(scriptSource));
  assert.equal(scriptSource.includes('${message}'), false);
});

test('semester title is escaped in HTML sinks but allowed raw in the dialog text fields', () => {
  const rawTitle = /\$\{\s*semester\.title\s*\}/;
  for (const template of TEMPLATE_SINKS) {
    assert.equal(rawTitle.test(template), false, 'raw semester.title inside an innerHTML template');
  }
  assert.ok(
    /title:\s*`Delete \$\{\s*semester\.title\s*\}\?`/.test(scriptSource),
    'the dialog carries the raw title in a text field'
  );
  assert.equal(
    /body:[^}]*semester\.title/.test(scriptSource),
    false,
    'the dialog body must never receive the raw title'
  );
  assert.ok(/elements\.title\.textContent\s*=/.test(scriptSource), 'the dialog title is written as text, not markup');
});

test('the confirmation dialog body escapes every value it renders as markup', () => {
  const details = scriptSource.match(/const details = \[\];[\s\S]*?const confirmed = await confirmDialog\.open\(/);
  assert.ok(details, 'the dialog details must be built in one place');
  const source = details[0];

  assert.equal(/\$\{\s*change\.name\s*\}/.test(source), false, 'raw subject name inside the dialog body');
  assert.equal(/\$\{\s*change\.label\s*\}/.test(source), false, 'raw grade label inside the dialog body');
  assert.ok(/escapeHtml\(\s*change\.name\s*\)/.test(source), 'the subject name must be escaped');
  assert.ok(/escapeHtml\(\s*change\.label\s*\)/.test(source), 'the grade label must be escaped');
  assert.ok(/escapeHtml\(\s*formatGradeValue\(/.test(source), 'the grade values must be escaped');
  assert.ok(/escapeHtml\(\s*gradingSystems\[systemId\]\.name\s*\)/.test(source), 'the grading system name must be escaped');
});

test('no alternate HTML-parsing sink is present without manual review', () => {
  const sinks = [
    ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/],
    ['outerHTML assignment', /\.outerHTML\s*=/],
    ['document.write', /document\.write\s*\(/],
    ['innerHTML +=', /\.innerHTML\s*\+=/]
  ];
  for (const [name, re] of sinks) {
    assert.equal(re.test(scriptSource), false, `new HTML sink requires manual review: ${name}`);
  }
});

test('no innerHTML template injects a script element', () => {
  for (const template of TEMPLATE_SINKS) {
    assert.equal(/<script/i.test(template), false, 'innerHTML template must not contain <script>');
  }
});
