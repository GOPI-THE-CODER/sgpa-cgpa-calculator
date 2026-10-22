'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

const BASE_URL = 'https://app.local/';

function pathnameOf(reference) {
  return new URL(reference, BASE_URL).pathname;
}

function htmlLocalReferences() {
  const references = [];
  const attribute = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = attribute.exec(html)) !== null) {
    const reference = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
    references.push(reference);
  }
  return references;
}

function precachedPaths() {
  const paths = new Set();
  const entry = /new URL\('([^']*)',\s*scopeUrl\)\.pathname/g;
  let match;
  while ((match = entry.exec(sw)) !== null) {
    paths.add(pathnameOf(match[1]));
  }
  return paths;
}

function functionBody(name) {
  const match = sw.match(new RegExp(`async function ${name}\\(request\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test('every local asset referenced by index.html is precached by pathname', () => {
  const precached = precachedPaths();
  const references = htmlLocalReferences();

  assert.ok(references.some((reference) => reference.includes('?')), 'expected query-versioned asset references');
  assert.ok(precached.has('/'), 'the app shell root must be precached');
  assert.ok(precached.has('/index.html'), 'index.html must be precached');

  for (const reference of references) {
    const pathname = pathnameOf(reference);
    assert.ok(precached.has(pathname), `${reference} (${pathname}) is not covered by staticAssetPaths`);
  }
});

test('every manifest icon is precached by pathname', () => {
  const precached = precachedPaths();

  for (const icon of manifest.icons) {
    const pathname = pathnameOf(icon.src);
    assert.ok(precached.has(pathname), `manifest icon ${icon.src} is not covered by staticAssetPaths`);
  }
});

test('the offline fallback is precached and served cache-first', () => {
  assert.ok(precachedPaths().has('/offline.html'), 'offline.html must be precached');
  assert.match(sw, /requestUrl\.pathname === OFFLINE_PATH[\s\S]{0,120}handleCacheFirst\(event\.request\)/);
  assert.match(functionBody('handleCacheFirst'), /ignoreSearch:\s*true/);
});

test('static assets stay network-first and cache lookups ignore query versions', () => {
  assert.match(functionBody('handleNetworkFirst'), /caches\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/);
  assert.match(
    sw,
    /staticAssetPaths\.includes\(requestUrl\.pathname\)[\s\S]{0,160}handleNetworkFirst\(event\.request\)/
  );
});

test('the html asset versions, the service worker registration and the cache version agree', () => {
  const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

  const htmlVersions = [...html.matchAll(/(?:styles\.css|calculator\.js|script\.js)\?v=(\d+)/g)].map((match) => match[1]);
  assert.ok(htmlVersions.length >= 3, 'the html references versioned local assets');
  assert.equal(new Set(htmlVersions).size, 1, 'every versioned html asset reference uses the same version');

  const registration = script.match(/sw\.js\?v=(\d+)/);
  assert.ok(registration, 'the service worker is registered with a version');

  const cacheVersion = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
  assert.ok(cacheVersion, 'the service worker declares a cache version');

  assert.equal(registration[1], cacheVersion[1], 'the registration version matches the cache version');
  assert.equal(htmlVersions[0], cacheVersion[1], 'the asset version matches the cache version');
});

test('the service worker is only used on an http(s) origin (file:// guard)', () => {
  const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

  // The app is opened from the file system by the Electron wrapper, where the
  // Cache API cannot store the local files. The worker must not be registered
  // there, and the worker itself must not attempt to cache or to claim
  // clients, so the renderer never shows an unhandled rejection.
  assert.match(
    script,
    /window\.location\s*&&\s*window\.location\.protocol\s*===\s*'file:'/,
    'the registration must be skipped for a file:// origin'
  );
  assert.match(sw, /const SUPPORTS_CACHE = self\.location\.protocol !== 'file:';/);
  assert.match(sw, /if \(SUPPORTS_CACHE\) \{[\s\S]*?self\.clients\.claim\(\)\.catch\(/);
  assert.match(sw, /self\.addEventListener\('install',[\s\S]*?if \(!SUPPORTS_CACHE\) \{[\s\S]*?return;[\s\S]*?caches\.open\(CACHE_NAME\)/);

  // The normal path keeps its behaviour: the precache still runs and the
  // failure of a real precache is still reported by the browser.
  assert.match(sw, /caches\.open\(CACHE_NAME\)\.then\(\(cache\) => cache\.addAll\(staticAssetPaths\)\)/);
});

test('the auth runtime is precached and auth callbacks never enter the cache', () => {
  const precached = precachedPaths();

  assert.ok(precached.has('/auth-provider.js'));
  assert.ok(precached.has('/vendor/supabase.js'));
  assert.match(sw, /AUTH_QUERY_KEYS\s*=\s*\[[^\]]*'code'[^\]]*'error'/);
  assert.match(sw, /AUTH_QUERY_KEYS\.some\(\(key\) => requestUrl\.searchParams\.has\(key\)\)[\s\S]{0,40}return;/);
  assert.match(sw, /requestUrl\.hostname\.endsWith\('\.supabase\.co'\)[\s\S]{0,40}return;/);

  const authBranch = sw.slice(sw.indexOf('AUTH_QUERY_KEYS.some'));
  const beforeRespond = authBranch.slice(0, authBranch.indexOf('event.respondWith'));
  assert.ok(beforeRespond.includes('return;'), 'auth URLs must bypass the service worker');
});
