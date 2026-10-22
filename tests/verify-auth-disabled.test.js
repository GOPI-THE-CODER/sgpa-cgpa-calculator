'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const guardSource = path.join(root, 'tools', 'verify-auth-disabled.js');
const baseIndex = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baseOffline = fs.readFileSync(path.join(root, 'offline.html'), 'utf8');

const cspBlock = /[ \t]*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\r?\n/i;
const urlMetaLine = /[ \t]*<meta name="sgpa-supabase-url" content="[^"]*" \/>\r?\n/;
const keyMetaLine = /[ \t]*<meta name="sgpa-supabase-publishable-key" content="[^"]*" \/>\r?\n/;

function cspFrom(html) {
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(match, 'the fixture must contain a Content-Security-Policy meta tag');
  return match[1];
}

const baseCsp = cspFrom(baseOffline);

function setCsp(html, content) {
  return html.replace(/content="default-src[^"]*"/, `content="${content}"`);
}

function removeCsp(html) {
  return html.replace(cspBlock, '');
}

function moveCspToBody(html) {
  const match = html.match(cspBlock);
  assert.ok(match, 'the fixture must contain a CSP meta block');
  return html.replace(cspBlock, '').replace('</body>', `${match[0]}</body>`);
}

function appendToHead(html, snippet) {
  return html.replace('</head>', `${snippet}\n  </head>`);
}

function appendToBody(html, snippet) {
  return html.replace('</body>', `${snippet}\n  </body>`);
}

function removeMeta(html, pattern) {
  return html.replace(pattern, '');
}

function duplicateMeta(html, pattern) {
  return html.replace(pattern, (match) => `${match}${match}`);
}

function replaceMetaContent(html, name, content) {
  return html.replace(
    new RegExp(`name="${name}" content="[^"]*"`),
    `name="${name}" content="${content}"`,
  );
}

function outputOf(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function runRealGuard() {
  return spawnSync(process.execPath, [guardSource], { cwd: root, encoding: 'utf8' });
}

function runFixture({ index = baseIndex, offline = baseOffline } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sgpa-auth-guard-test-'));
  const toolsDirectory = path.join(directory, 'tools');

  try {
    fs.mkdirSync(toolsDirectory);
    fs.copyFileSync(guardSource, path.join(toolsDirectory, 'verify-auth-disabled.js'));
    fs.writeFileSync(path.join(directory, 'index.html'), index);
    fs.writeFileSync(path.join(directory, 'offline.html'), offline);

    return spawnSync(
      process.execPath,
      [path.join(toolsDirectory, 'verify-auth-disabled.js')],
      { cwd: directory, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function assertPasses(files, label = 'fixture') {
  const result = runFixture(files);
  const output = outputOf(result);

  assert.equal(result.status, 0, `${label} should pass:\n${output}`);
  assert.match(output, /Auth-disabled release policy: PASS/, `${label} should report a pass:\n${output}`);
}

function assertFails(files, message, label = 'fixture') {
  const result = runFixture(files);
  const output = outputOf(result);

  assert.equal(result.status, 1, `${label} should fail:\n${output}`);
  assert.match(output, message, `${label} should report ${message}:\n${output}`);
  assert.doesNotMatch(
    output,
    /file is missing|head element is missing|unterminated/i,
    `${label} failed for an unrelated malformed-fixture reason:\n${output}`,
  );
}

function normalizedCsp() {
  return baseCsp
    .split('; ')
    .reverse()
    .map((directive) => {
      const [name, ...sources] = directive.split(' ');
      const normalizedSources = sources
        .reverse()
        .map((source) => (source === "'self'" ? "'SELF'" : source));
      return `${name.toUpperCase()} ${normalizedSources.join(' ')}`;
    })
    .join('; ');
}

test('the real project files satisfy the auth-disabled baseline', () => {
  const result = runRealGuard();
  const output = outputOf(result);

  assert.equal(result.status, 0, output);
  assert.match(output, /Auth-disabled release policy: PASS/);
});

test('missing required Supabase URL meta tag fails', () => {
  assertFails({ index: removeMeta(baseIndex, urlMetaLine) }, /expected exactly one meta\[name="sgpa-supabase-url"\]/);
});

test('duplicate required Supabase URL meta tag fails', () => {
  const index = duplicateMeta(baseIndex, urlMetaLine);
  assert.equal((index.match(/name="sgpa-supabase-url"/g) || []).length, 2);
  assertFails({ index }, /expected exactly one meta\[name="sgpa-supabase-url"\]/);
});

test('non-empty Supabase URL meta tag fails', () => {
  assertFails(
    { index: replaceMetaContent(baseIndex, 'sgpa-supabase-url', 'https://example.supabase.co') },
    /meta\[name="sgpa-supabase-url"\] must have an empty content attribute/,
  );
});

test('missing required Supabase key meta tag fails', () => {
  assertFails({ index: removeMeta(baseIndex, keyMetaLine) }, /expected exactly one meta\[name="sgpa-supabase-publishable-key"\]/);
});

test('duplicate required Supabase key meta tag fails', () => {
  const index = duplicateMeta(baseIndex, keyMetaLine);
  assert.equal((index.match(/name="sgpa-supabase-publishable-key"/g) || []).length, 2);
  assertFails({ index }, /expected exactly one meta\[name="sgpa-supabase-publishable-key"\]/);
});

test('non-empty Supabase key meta tag fails', () => {
  assertFails(
    { index: replaceMetaContent(baseIndex, 'sgpa-supabase-publishable-key', 'pk_test_example') },
    /meta\[name="sgpa-supabase-publishable-key"\] must have an empty content attribute/,
  );
});

test('unexpected auth configuration meta in index fails', () => {
  assertFails(
    { index: appendToHead(baseIndex, '<meta name="supabase-anon-key" content="example" />') },
    /unexpected auth configuration meta\[name="supabase-anon-key"\]/,
  );
});

test('missing CSP meta tag in offline fails', () => {
  assertFails({ offline: removeCsp(baseOffline) }, /expected exactly one Content-Security-Policy meta tag/);
});

test('duplicate CSP meta tag in offline fails', () => {
  const offline = appendToHead(
    baseOffline,
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />',
  );
  assert.equal((offline.match(/http-equiv="Content-Security-Policy"/g) || []).length, 2);
  assertFails({ offline }, /expected exactly one Content-Security-Policy meta tag/);
});

test('missing CSP meta tag in index fails', () => {
  assertFails({ index: removeCsp(baseIndex) }, /expected exactly one Content-Security-Policy meta tag/);
});

test('duplicate CSP meta tag in index fails', () => {
  const index = appendToHead(
    baseIndex,
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />',
  );
  assert.equal((index.match(/http-equiv="Content-Security-Policy"/g) || []).length, 2);
  assertFails({ index }, /expected exactly one Content-Security-Policy meta tag/);
});

test('CSP outside the head fails', () => {
  assertFails(
    { offline: moveCspToBody(baseOffline) },
    /Content-Security-Policy meta tag must appear exactly once in the head/,
  );
});

test('duplicate CSP directive fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("default-src 'self'", "default-src 'self'; default-src 'self'")) },
    /duplicate default-src CSP directive/,
  );
});

test('malformed CSP directive fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("script-src 'self'", 'script-src')) },
    /script-src CSP directive has no source expressions/,
  );
});

test('malformed CSP source expression fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("script-src 'self'", "script-src 'self")) },
    /malformed CSP source expression/,
  );
});

test('missing CSP directive fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("; connect-src 'self'", '')) },
    /missing connect-src CSP directive/,
  );
});

test('unexpected CSP directive fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, `${baseCsp}; report-uri https://example.com/report`) },
    /unexpected report-uri CSP directive/,
  );
});

test('broadened script-src fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")) },
    /script-src must be exactly/,
  );
});

test('broadened default-src fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("default-src 'self'", "default-src 'self' https:")) },
    /default-src must be exactly/,
  );
});

test('broadened connect-src fails', () => {
  assertFails(
    {
      offline: setCsp(
        baseOffline,
        baseCsp.replace("connect-src 'self'", "connect-src 'self' https://example.supabase.co"),
      ),
    },
    /connect-src must be exactly/,
  );
});

test('broadened form-action fails', () => {
  assertFails(
    {
      offline: setCsp(
        baseOffline,
        baseCsp.replace("form-action 'self'", "form-action 'self' https://example.com"),
      ),
    },
    /form-action must be exactly/,
  );
});

test('broadened base-uri fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("base-uri 'none'", "base-uri 'self'")) },
    /base-uri must be exactly/,
  );
});

test('broadened object-src fails', () => {
  assertFails(
    { offline: setCsp(baseOffline, baseCsp.replace("object-src 'none'", "object-src 'self'")) },
    /object-src must be exactly/,
  );
});

test('normalized directive ordering, source ordering and case are accepted', () => {
  assertPasses(
    {
      index: setCsp(baseIndex, normalizedCsp()),
      offline: setCsp(baseOffline, normalizedCsp()),
    },
    'normalized CSP',
  );
});

test('offline inline script fails', () => {
  assertFails(
    { offline: appendToBody(baseOffline, '<script>window.auth = true;</script>') },
    /inline scripts are not allowed/,
  );
});

test('offline external script with an unrelated filename fails', () => {
  assertFails(
    { offline: appendToBody(baseOffline, '<script src="runtime.js"></script>') },
    /script elements are not allowed in the offline page/,
  );
});

test('offline inline event handler fails', () => {
  assertFails(
    { offline: baseOffline.replace('<body>', '<body onload="window.auth = true">') },
    /inline event handler "onload" is not allowed/,
  );
});

test('offline javascript: URL fails', () => {
  assertFails(
    { offline: baseOffline.replace('href="index.html"', 'href="javascript:window.auth=true"') },
    /javascript: URLs are not allowed/,
  );
});

test('offline auth-related resource URL fails', () => {
  assertFails(
    { offline: appendToHead(baseOffline, '<link rel="preconnect" href="https://example.supabase.co" />') },
    /unexpected auth-related resource/,
  );
});

test('offline auth configuration in a data-* attribute name fails', () => {
  assertFails(
    { offline: appendToBody(baseOffline, '<div data-supabase-url="https://example.supabase.co"></div>') },
    /unexpected auth configuration attribute "data-supabase-url"/,
  );
});

test('offline auth configuration in a data-* value fails', () => {
  assertFails(
    {
      offline: appendToBody(
        baseOffline,
        '<div data-config=\'{"supabaseUrl":"https://example.supabase.co"}\'></div>',
      ),
    },
    /unexpected auth configuration attribute "data-config"/,
  );
});

test('offline auth configuration in an id attribute fails', () => {
  assertFails(
    { offline: appendToBody(baseOffline, '<div id="auth-config"></div>') },
    /unexpected auth configuration id="auth-config"/,
  );
});

test('offline auth configuration in a name attribute fails', () => {
  assertFails(
    { offline: appendToBody(baseOffline, '<div name="supabase-config"></div>') },
    /unexpected auth configuration name="supabase-config"/,
  );
});

test('offline auth configuration meta fails', () => {
  assertFails(
    { offline: appendToHead(baseOffline, '<meta name="client-auth-config" content="enabled" />') },
    /unexpected auth configuration meta\[name="client-auth-config"\]/,
  );
});

test('offline auth meta with > inside a quoted attribute fails', () => {
  assertFails(
    {
      offline: appendToHead(
        baseOffline,
        '<meta data-note="a>b" name="sgpa-supabase-url" content="" />',
      ),
    },
    /unexpected auth configuration meta\[name="sgpa-supabase-url"\]/,
  );
});

test('ordinary valid attributes containing > are accepted', () => {
  assertPasses(
    {
      offline: baseOffline.replace(
        'content="width=device-width, initial-scale=1.0"',
        'content="width=device-width, initial-scale=1.0 > test"',
      ),
    },
    'ordinary attribute with >',
  );
});
