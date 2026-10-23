'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer, HOST, PROJECT_ROOT, loadLocalAuthConfig } = require('../server.js');

const PROJECT_URL = 'https://demo.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_local_test';
const SECRET_KEY = 'sb_secret_do_not_use';

let temporaryDirectory;
let configPath;

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

function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/g) || [];
  for (const tag of tags) {
    if (!tag.includes(`name="${name}"`)) continue;
    const content = tag.match(/\bcontent="([^"]*)"/);
    return content ? content[1] : '';
  }
  return '';
}

function cspFromHtml(html) {
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(match, 'the served page must declare a Content-Security-Policy');
  return match[1];
}

function closeServer(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function withServer(options, callback) {
  const server = startServer(0, options);
  await new Promise((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', resolve);
  });

  try {
    return await callback(server.address().port);
  } finally {
    await closeServer(server);
  }
}

function request(port, requestPath) {
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

function writeConfig(name, value) {
  const file = path.join(temporaryDirectory, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function serviceRoleJwt() {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

before(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sgpa-local-auth-'));
  configPath = writeConfig('supabase.local.json', {
    url: PROJECT_URL,
    publishableKey: PUBLISHABLE_KEY
  });
});

after(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('default server responses remain auth-disabled', async () => {
  await withServer({}, async (port) => {
    for (const requestPath of ['/', '/index.html']) {
      const response = await request(port, requestPath);

      assert.equal(response.status, 200, requestPath);
      assert.equal(metaContent(response.body, 'sgpa-supabase-url'), '', requestPath);
      assert.equal(metaContent(response.body, 'sgpa-supabase-publishable-key'), '', requestPath);
      assert.equal(response.headers['content-security-policy'], policyWith("'self'"), requestPath);
      assert.equal(response.headers['cache-control'], undefined, requestPath);
    }
  });
});

test('local auth mode injects configuration only into index responses', async () => {
  await withServer({ localAuthFile: configPath }, async (port) => {
    const expectedPolicy = policyWith(`'self' ${PROJECT_URL}`);

    for (const requestPath of ['/', '/index.html']) {
      const response = await request(port, requestPath);

      assert.equal(response.status, 200, requestPath);
      assert.equal(metaContent(response.body, 'sgpa-supabase-url'), PROJECT_URL, requestPath);
      assert.equal(metaContent(response.body, 'sgpa-supabase-publishable-key'), PUBLISHABLE_KEY, requestPath);
      assert.equal(cspFromHtml(response.body), expectedPolicy, requestPath);
      assert.equal(response.headers['content-security-policy'], expectedPolicy, requestPath);
      assert.equal(response.headers['cache-control'], 'no-store', requestPath);
    }

    const offline = await request(port, '/offline.html');
    assert.equal(offline.status, 200);
    assert.equal(offline.headers['content-security-policy'], policyWith("'self'"));
    assert.equal(offline.headers['cache-control'], undefined);
    assert.doesNotMatch(offline.body, /supabase|publishable|demo\.supabase/i);

    for (const requestPath of ['/script.js', '/styles.css?v=11', '/manifest.json']) {
      const response = await request(port, requestPath);
      assert.equal(response.status, 200, requestPath);
      assert.equal(response.headers['content-security-policy'], undefined, requestPath);
      assert.equal(response.headers['cache-control'], undefined, requestPath);
      assert.doesNotMatch(response.body, /demo\.supabase|sb_publishable_local_test/, requestPath);
    }
  });
});

test('local auth configuration rejects secret and service-role keys', () => {
  const secretPath = writeConfig('secret.json', { url: PROJECT_URL, publishableKey: SECRET_KEY });
  const serviceRolePath = writeConfig('service-role.json', {
    url: PROJECT_URL,
    publishableKey: serviceRoleJwt()
  });

  assert.throws(() => loadLocalAuthConfig(secretPath), /must not contain a secret or service-role key/);
  assert.throws(() => loadLocalAuthConfig(serviceRolePath), /must not contain a secret or service-role key/);
});

test('local auth configuration rejects invalid values and repository paths', () => {
  assert.throws(
    () => loadLocalAuthConfig(writeConfig('bad-url.json', { url: 'http://example.com', publishableKey: PUBLISHABLE_KEY })),
    /invalid Supabase URL/
  );
  assert.throws(
    () => loadLocalAuthConfig(writeConfig('bad-key.json', { url: PROJECT_URL, publishableKey: 'not-a-key' })),
    /invalid publishable key/
  );
  assert.throws(
    () => loadLocalAuthConfig(writeConfig('missing-key.json', { url: PROJECT_URL })),
    /invalid publishable key/
  );
  assert.throws(
    () => loadLocalAuthConfig(writeConfig('bad-json.json', '{')),
    /not valid JSON/
  );
  assert.throws(
    () => loadLocalAuthConfig(path.join(PROJECT_ROOT, 'package.json')),
    /must be stored outside the repository/
  );
});

test('the --local-auth command fails before serving an invalid configuration', () => {
  const invalidPath = writeConfig('cli-secret.json', {
    url: PROJECT_URL,
    publishableKey: SECRET_KEY
  });
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'server.js'), '--local-auth', invalidPath], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /must not contain a secret or service-role key/);
  assert.doesNotMatch(output, new RegExp(SECRET_KEY));
});
