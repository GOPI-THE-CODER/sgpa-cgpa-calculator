'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../auth-provider.js');
const { startServer, HOST, DEFAULT_PORT, PROJECT_ROOT } = require('../server.js');

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

function expectedPolicyFromIndex() {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
  const projectUrl = metaContent(html, 'sgpa-supabase-url');
  const publishableKey = metaContent(html, 'sgpa-supabase-publishable-key');
  if (!projectUrl && !publishableKey) return policyWith("'self'");

  assert.ok(projectUrl && publishableKey, 'both authentication meta tags must be configured together');
  const project = auth.validateProjectUrl(projectUrl);
  assert.equal(project.ok, true, 'the configured project URL must be valid');
  assert.equal(auth.validatePublishableKey(publishableKey).ok, true, 'the configured key must be publishable');
  return policyWith(`'self' ${project.url}`);
}

let server;
let port;

before(async () => {
  server = startServer(0);
  await new Promise((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', resolve);
  });
  port = server.address().port;
});

after(async () => {
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
});

function request(requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: requestPath, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

test('binds the development server to localhost only', () => {
  assert.equal(HOST, '127.0.0.1');
  assert.equal(DEFAULT_PORT, 8080);
  assert.equal(server.address().address, '127.0.0.1');
});

test('serves normal local assets', async () => {
  const routes = [
    ['/', /text\/html/, /SGPA & CGPA Calculator/],
    ['/index.html', /text\/html/, /Semester Tracker/],
    ['/calculator.js', /text\/javascript/, /SgpaCalculator/],
    ['/styles.css?v=10', /text\/css/, /\.validation-banner/],
    ['/script.js?v=7', /text\/javascript/, /sanitizeSavedState/],
    ['/manifest.json', /application\/json/, /"name"/],
    ['/offline.html', /text\/html/, /You're offline/]
  ];

  for (const [requestPath, contentType, marker] of routes) {
    const response = await request(requestPath);
    assert.equal(response.status, 200, requestPath);
    assert.match(response.headers['content-type'], contentType, requestPath);
    assert.match(response.body, marker, requestPath);
  }
});

test('serves SVG icons with the correct MIME type', async () => {
  const response = await request('/icons/icon-192.svg');

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'image/svg+xml');
  assert.match(response.body, /<svg/);
});

test('delivers the content security policy with HTML documents only', async () => {
  const indexExpected = expectedPolicyFromIndex();
  const offlineExpected = policyWith("'self'");

  for (const requestPath of ['/', '/index.html']) {
    const response = await request(requestPath);
    assert.equal(response.status, 200, requestPath);
    assert.equal(response.headers['content-security-policy'], indexExpected, requestPath);
  }

  const offline = await request('/offline.html');
  assert.equal(offline.status, 200);
  assert.equal(
    offline.headers['content-security-policy'],
    offlineExpected,
    'offline.html stays auth-free even when index.html is configured'
  );

  for (const requestPath of ['/styles.css?v=10', '/script.js?v=10', '/manifest.json']) {
    const response = await request(requestPath);
    assert.equal(response.status, 200, requestPath);
    assert.equal(response.headers['content-security-policy'], undefined, requestPath);
  }

  const missing = await request('/does-not-exist.html');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-security-policy'], offlineExpected, 'the error document is protected too');
});

test('rejects traversal and encoded traversal attempts', async () => {
  const attempts = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2fpackage.json'];

  for (const attempt of attempts) {
    const response = await request(attempt);
    assert.equal(response.status, 403, attempt);
    assert.equal(response.body.includes('"name"'), false, attempt);
  }
});

test('returns 400 for malformed percent-encoding and null bytes', async () => {
  const attempts = ['/%', '/%E0%A4%A', '/%ZZ', '/%00'];

  for (const attempt of attempts) {
    const response = await request(attempt);
    assert.equal(response.status, 400, attempt);
  }
});

test('returns 404 for missing local assets', async () => {
  const response = await request('/missing-file.js');

  assert.equal(response.status, 404);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /404 Not Found/);
});

test('server source binds with the explicit localhost constant', () => {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');

  assert.match(source, /const HOST = '127\.0\.0\.1';/);
  assert.match(source, /server\.listen\(currentPort, HOST,/);
  assert.equal(/server\.listen\(currentPort\)/.test(source), false);
});
