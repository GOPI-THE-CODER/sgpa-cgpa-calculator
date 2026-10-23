'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('../auth-provider.js');

const ROOT = path.join(__dirname, '..');
const LOCATION = { href: 'https://app.test/', protocol: 'https:' };
const REDIRECT = 'https://app.test/';
const CONFIG = { url: 'https://demo.supabase.co', redirectTo: REDIRECT };

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function createHistory(href) {
  return {
    state: { key: 'state' },
    replaced: null,
    replaceState(state, title, url) {
      this.replaced = url;
    }
  };
}

function createFakeClient(options = {}) {
  const calls = {
    order: [],
    signIn: [],
    signUp: [],
    signOut: [],
    initialize: 0,
    getSession: 0,
    getUser: 0,
    unsubscribed: false
  };
  let callback = null;
  let session = options.session || null;
  const user = options.user !== undefined ? options.user : (session && session.user) || null;

  const client = {
    auth: {
      onAuthStateChange(handler) {
        calls.order.push('onAuthStateChange');
        callback = handler;
        return {
          data: {
            subscription: {
              unsubscribe() {
                calls.unsubscribed = true;
              }
            }
          }
        };
      },
      async initialize() {
        calls.order.push('initialize');
        calls.initialize += 1;
        return options.initializeResult || { error: null };
      },
      async getSession() {
        calls.order.push('getSession');
        calls.getSession += 1;
        return { data: { session }, error: options.getSessionError || null };
      },
      async getUser() {
        calls.order.push('getUser');
        calls.getUser += 1;
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user }, error: null };
      },
      async signInWithPassword(payload) {
        calls.order.push('signInWithPassword');
        calls.signIn.push(payload);
        if (options.signInError) return { data: { user: null, session: null }, error: options.signInError };
        session = options.signInSession === undefined ? { user } : options.signInSession;
        if (options.emitSignIn && callback) callback('SIGNED_IN', session);
        return { data: { user, session }, error: null };
      },
      async signUp(payload) {
        calls.order.push('signUp');
        calls.signUp.push(payload);
        if (options.signUpError) return { data: { user: null, session: null }, error: options.signUpError };
        if (options.signUpSession) return { data: { user, session: options.signUpSession }, error: null };
        return { data: { user, session: null }, error: null };
      },
      async signOut(payload) {
        calls.order.push('signOut');
        calls.signOut.push(payload);
        if (options.signOutError) throw options.signOutError;
        if (options.signOutResponseError) return { error: options.signOutResponseError };
        session = null;
        return { error: null };
      }
    }
  };

  return {
    client,
    calls,
    emit(event, nextSession) {
      if (callback) callback(event, nextSession);
    }
  };
}

function createProvider(options = {}) {
  const fake = options.fake || createFakeClient();
  const location = options.location || LOCATION;
  const history = options.history || createHistory(location.href);
  const navigatorObject = options.navigator || { onLine: true };
  const windowObject = options.window || { addEventListener() {}, removeEventListener() {} };
  const provider = auth.createAuthProvider({
    client: fake.client,
    config: options.config || CONFIG,
    location,
    history,
    navigator: navigatorObject,
    window: windowObject
  });
  return { provider, fake, history, location, navigator: navigatorObject, window: windowObject };
}

function documentWith(values) {
  return {
    querySelector(selector) {
      const match = /^meta\[name="([^"]+)"\]$/.exec(selector);
      if (!match || !(match[1] in values)) return null;
      return { getAttribute: () => values[match[1]] };
    }
  };
}

test('configuration accepts only hosted Supabase origins, publishable keys and the exact app redirect', () => {
  const valid = auth.readConfig(null, {
    url: 'https://demo.supabase.co',
    publishableKey: 'sb_publishable_abc123',
    redirectTo: REDIRECT,
    location: LOCATION
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.configured, true);
  assert.equal(valid.config.url, 'https://demo.supabase.co');
  assert.equal(valid.config.redirectTo, REDIRECT);

  const legacy = auth.readConfig(null, {
    url: 'https://demo.supabase.co',
    publishableKey: jwt({ role: 'anon' }),
    location: LOCATION
  });
  assert.equal(legacy.ok, true);

  const missing = auth.readConfig(null, { location: LOCATION });
  assert.equal(missing.configured, false);

  const cases = [
    ['https://demo.supabase.co.evil.example', 'sb_publishable_abc123', 'invalid-url'],
    ['https://demo.supabase.co/rest/v1', 'sb_publishable_abc123', 'invalid-url'],
    ['http://demo.supabase.co', 'sb_publishable_abc123', 'invalid-url'],
    ['https://user:pass@demo.supabase.co', 'sb_publishable_abc123', 'invalid-url'],
    ['https://demo.supabase.co', 'sb_secret_abc123', 'secret-key'],
    ['https://demo.supabase.co', jwt({ role: 'service_role' }), 'secret-key'],
    ['https://demo.supabase.co', jwt({ role: 'authenticated' }), 'invalid-key'],
    ['https://demo.supabase.co', jwt({}), 'invalid-key'],
    ['https://demo.supabase.co', 'a.b.c', 'invalid-key'],
    ['https://demo.supabase.co', 'not-a-key', 'invalid-key']
  ];

  for (const [url, publishableKey, reason] of cases) {
    const result = auth.readConfig(null, { url, publishableKey, location: LOCATION });
    assert.equal(result.ok, false, `${url} / ${publishableKey} should be rejected`);
    assert.equal(result.reason, reason);
  }

  const mismatch = auth.readConfig(null, {
    url: 'https://demo.supabase.co',
    publishableKey: 'sb_publishable_abc123',
    redirectTo: 'https://app.test/other/',
    location: LOCATION
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'redirect-mismatch');
});

test('creating from the document is disabled without config, on file origins, and without the SDK', () => {
  const noConfig = auth.createFromDocument(documentWith({}), { location: LOCATION });
  assert.equal(noConfig.provider, null);
  assert.equal(noConfig.reason, 'not-configured');

  const configured = {
    'sgpa-supabase-url': CONFIG.url,
    'sgpa-supabase-publishable-key': 'sb_publishable_abc123'
  };

  const fileWindow = { location: { href: 'file:///app/index.html', protocol: 'file:' }, supabase: {} };
  const file = auth.createFromDocument(documentWith(configured), fileWindow);
  assert.equal(file.provider, null);
  assert.equal(file.reason, 'file-origin');

  const noSdk = auth.createFromDocument(documentWith(configured), { location: LOCATION });
  assert.equal(noSdk.provider, null);
  assert.equal(noSdk.reason, 'sdk-unavailable');
});

test('the SDK client is created with the PKCE, persistence and deferred initialization options', () => {
  let captured = null;
  const fake = createFakeClient();
  const windowObject = {
    location: LOCATION,
    history: createHistory(LOCATION.href),
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
    supabase: {
      createClient(url, key, options) {
        captured = { url, key, options };
        return fake.client;
      }
    }
  };

  const result = auth.createFromDocument(
    documentWith({
      'sgpa-supabase-url': CONFIG.url,
      'sgpa-supabase-publishable-key': 'sb_publishable_abc123'
    }),
    windowObject
  );

  assert.ok(result.provider);
  assert.equal(captured.url, CONFIG.url);
  assert.equal(captured.key, 'sb_publishable_abc123');
  assert.deepEqual(captured.options.auth, {
    flowType: 'pkce',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
    skipAutoInitialize: true
  });
  assert.equal(result.provider.getConfig().redirectTo, REDIRECT);
});

test('initialization subscribes before starting, then verifies the stored session online', async () => {
  const fake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    user: { email: 'student@example.com' }
  });
  const { provider } = createProvider({ fake });

  const result = await provider.initialize();

  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls.order.slice(0, 4), [
    'onAuthStateChange',
    'initialize',
    'getSession',
    'getUser'
  ]);
  assert.equal(provider.getState().status, 'signed-in');
  assert.deepEqual(provider.getState().user, { email: 'student@example.com' });
});

test('an offline stored session is never reported as signed in', async () => {
  const fake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    user: { email: 'student@example.com' }
  });
  const { provider } = createProvider({ fake, navigator: { onLine: false } });

  const result = await provider.initialize();

  assert.equal(result.ok, false);
  assert.equal(fake.calls.getUser, 0);
  assert.equal(provider.getState().status, 'offline-unverified');
  assert.equal(provider.getState().user.email, 'student@example.com');
});

test('a session is not accepted when the online user lookup returns no user', async () => {
  const fake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    user: null
  });
  const { provider } = createProvider({ fake });

  const result = await provider.initialize();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'no-user');
  assert.equal(provider.getState().status, 'guest');
  assert.equal(provider.getState().user, null);
});

test('the callback URL is cleaned without dropping unrelated query parameters or the hash', async () => {
  const location = {
    href: 'https://app.test/?code=abc&error=access_denied&error_description=no&tab=plan#semesters',
    protocol: 'https:'
  };
  const history = createHistory(location.href);
  const fake = createFakeClient();
  const { provider } = createProvider({ fake, location, history });

  await provider.initialize();

  assert.ok(history.replaced);
  const cleaned = new URL(history.replaced);
  assert.equal(cleaned.searchParams.get('code'), null);
  assert.equal(cleaned.searchParams.get('error'), null);
  assert.equal(cleaned.searchParams.get('error_description'), null);
  assert.equal(cleaned.searchParams.get('tab'), 'plan');
  assert.equal(cleaned.hash, '#semesters');
});

test('sign-in verifies the new session and sign-out uses local scope', async () => {
  const fake = createFakeClient({
    user: { email: 'student@example.com' },
    signInSession: { user: { email: 'student@example.com' } }
  });
  const { provider } = createProvider({ fake });

  const signedIn = await provider.signIn({ email: 'student@example.com', password: 'correct-horse' });
  assert.equal(signedIn.ok, true);
  assert.equal(provider.getState().status, 'signed-in');
  assert.deepEqual(fake.calls.signIn[0], { email: 'student@example.com', password: 'correct-horse' });
  assert.equal(fake.calls.getUser, 1);

  const signedOut = await provider.signOut();
  assert.equal(signedOut.ok, true);
  assert.deepEqual(fake.calls.signOut[0], { scope: 'local' });
  assert.equal(provider.getState().status, 'guest');
});

test('initialization reports callback failures once, cleans the URL, and does not reinitialize', async () => {
  const location = {
    href: 'https://app.test/?code=secret-code&error=access_denied&error_code=access_denied&error_description=no&tab=plan#semesters',
    protocol: 'https:'
  };
  const history = createHistory(location.href);
  const fake = createFakeClient({
    initializeResult: { error: { code: 'flow_state_expired', message: 'PKCE flow state expired for secret-code' } }
  });
  const { provider } = createProvider({ fake, location, history });

  const [first, second] = await Promise.all([provider.initialize(), provider.initialize()]);

  assert.equal(first.ok, false);
  assert.equal(first.code, 'link');
  assert.equal(second, first, 'initialize returns the same promise');
  assert.equal(fake.calls.initialize, 1, 'the SDK initializes only once');
  assert.equal(provider.getState().status, 'guest');
  assert.match(provider.getState().message, /link/i);
  assert.doesNotMatch(provider.getState().message, /secret-code|access_denied/);
  const cleaned = new URL(history.replaced);
  assert.equal(cleaned.searchParams.get('code'), null);
  assert.equal(cleaned.searchParams.get('error'), null);
  assert.equal(cleaned.searchParams.get('error_code'), null);
  assert.equal(cleaned.searchParams.get('error_description'), null);
  assert.equal(cleaned.searchParams.get('tab'), 'plan');
  assert.equal(cleaned.hash, '#semesters');
});

test('stored-session and user-verification failures do not produce a signed-in state', async () => {
  const sessionFake = createFakeClient({
    getSessionError: { status: 500, message: 'The session store failed' }
  });
  const sessionProvider = createProvider({ fake: sessionFake }).provider;
  const sessionResult = await sessionProvider.initialize();

  assert.equal(sessionResult.ok, false);
  assert.equal(sessionProvider.getState().status, 'guest');

  const userFake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    getUserError: { status: 0, message: 'Failed to fetch' }
  });
  const userProvider = createProvider({ fake: userFake }).provider;
  const userResult = await userProvider.initialize();

  assert.equal(userResult.ok, false);
  assert.equal(userResult.code, 'network');
  assert.equal(userProvider.getState().status, 'offline-unverified');
});

test('sign-out failures preserve the session and are never reported as success', async () => {
  const throwingFake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    signOutError: new Error('network unavailable')
  });
  const throwing = createProvider({ fake: throwingFake }).provider;
  await throwing.initialize();
  assert.equal(throwing.getState().status, 'signed-in');

  const rejected = await throwing.signOut();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'sign-out-failed');
  assert.equal(rejected.status, 'signed-in');
  assert.match(rejected.message, /could not sign you out/i);
  assert.equal(throwing.getState().status, 'signed-in');

  const responseFake = createFakeClient({
    session: { user: { email: 'student@example.com' } },
    signOutResponseError: { message: 'sign-out was rejected' }
  });
  const response = createProvider({ fake: responseFake }).provider;
  await response.initialize();

  const failed = await response.signOut();
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'sign-out-failed');
  assert.equal(response.getState().status, 'signed-in');
});

test('an auth event raised during an explicit sign-in does not race verification', async () => {
  const fake = createFakeClient({
    user: { email: 'student@example.com' },
    signInSession: { user: { email: 'student@example.com' } },
    emitSignIn: true
  });
  const { provider } = createProvider({ fake });
  await provider.initialize();

  const result = await provider.signIn({ email: 'student@example.com', password: 'correct-horse' });

  assert.equal(result.ok, true);
  assert.equal(fake.calls.getUser, 1);
  assert.equal(provider.getState().status, 'signed-in');
});

test('sign-up without a session is pending, while sign-up with a session is verified', async () => {
  const pendingFake = createFakeClient({ user: { email: 'student@example.com' } });
  const pending = createProvider({ fake: pendingFake }).provider;

  const pendingResult = await pending.signUp({ email: 'student@example.com', password: 'correct-horse' });
  assert.equal(pendingResult.ok, true);
  assert.equal(pendingResult.pending, true);
  assert.equal(pending.getState().status, 'guest');
  assert.deepEqual(pendingFake.calls.signUp[0].options, { emailRedirectTo: REDIRECT });

  const activeFake = createFakeClient({
    user: { email: 'student@example.com' },
    signUpSession: { user: { email: 'student@example.com' } }
  });
  const active = createProvider({ fake: activeFake }).provider;

  const activeResult = await active.signUp({ email: 'student@example.com', password: 'correct-horse' });
  assert.equal(activeResult.ok, true);
  assert.equal(activeResult.pending, undefined);
  assert.equal(active.getState().status, 'signed-in');
});

test('authentication errors are mapped to safe, specific messages', () => {
  const cases = [
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'invalid-credentials', 'auth'],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, 'email-not-confirmed', 'auth'],
    [{ code: 'user_already_exists', message: 'User already registered' }, 'already-exists', 'auth'],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters' }, 'weak-password', 'auth'],
    [{ code: 'over_email_send_rate_limit', status: 429 }, 'rate-limit', 'auth'],
    [{ code: 'flow_state_expired', message: 'PKCE flow state expired' }, 'link', 'link'],
    [{ status: 0, message: 'Failed to fetch' }, 'network', 'network'],
    [{ code: 'something_else' }, 'failed', 'auth']
  ];

  for (const [input, code, kind] of cases) {
    const mapped = auth.mapError(input);
    assert.equal(mapped.code, code);
    assert.equal(mapped.kind, kind);
    assert.equal(typeof mapped.message, 'string');
    assert.ok(mapped.message.length > 0);
  }
});

test('the vendored SDK matches the reviewed size, checksum and license', () => {
  const sdkPath = path.join(ROOT, 'vendor', 'supabase.js');
  const licensePath = path.join(ROOT, 'vendor', 'supabase-LICENSE.txt');
  const sdk = fs.readFileSync(sdkPath);
  const license = fs.readFileSync(licensePath, 'utf8');

  assert.equal(sdk.length, 218252);
  assert.equal(
    crypto.createHash('sha256').update(sdk).digest('hex'),
    'ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3'
  );
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2020 Supabase/);
});
