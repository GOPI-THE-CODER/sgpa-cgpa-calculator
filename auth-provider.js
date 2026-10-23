(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.SgpaAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const META_URL = 'sgpa-supabase-url';
  const META_KEY = 'sgpa-supabase-publishable-key';
  const AUTH_QUERY_KEYS = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];
  const SESSION_PARAMETERS = new Set([
    'session_not_found',
    'refresh_token_not_found',
    'session_expired',
    'invalid_refresh_token'
  ]);
  const LINK_PARAMETERS = new Set([
    'flow_state_not_found',
    'flow_state_expired',
    'bad_code_verifier',
    'invalid_request',
    'otp_expired',
    'pkce_verifier_not_found'
  ]);

  function emptyState() {
    return { status: 'guest', user: null, code: '', message: '' };
  }

  function snapshot(state) {
    return {
      status: state.status,
      user: state.user ? { email: state.user.email } : null,
      code: state.code || '',
      message: state.message || ''
    };
  }

  function normalizeUser(user) {
    if (!user || typeof user !== 'object') return null;
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    return email ? { email } : null;
  }

  function isOffline(navigatorObject) {
    return Boolean(navigatorObject && navigatorObject.onLine === false);
  }

  function decodeBase64Url(value) {
    try {
      const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      if (typeof atob === 'function') return atob(padded);
      if (typeof Buffer !== 'undefined') return Buffer.from(padded, 'base64').toString('binary');
    } catch (error) {
      return '';
    }
    return '';
  }

  function decodeJwtPayload(key) {
    const parts = String(key).split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    try {
      return JSON.parse(decodeBase64Url(parts[1]));
    } catch (error) {
      return null;
    }
  }

  function validatePublishableKey(value) {
    const key = String(value || '').trim();
    if (!key) return { ok: false, reason: 'missing-key' };
    if (/^sb_secret_/i.test(key)) return { ok: false, reason: 'secret-key' };

    if (key.split('.').length === 3) {
      const payload = decodeJwtPayload(key);
      if (!payload) return { ok: false, reason: 'invalid-key' };
      if (payload.role === 'service_role') return { ok: false, reason: 'secret-key' };
      if (payload.role !== 'anon') return { ok: false, reason: 'invalid-key' };
      return { ok: true };
    }

    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return { ok: true };
    return { ok: false, reason: 'invalid-key' };
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  }

  function validateProjectUrl(value) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch (error) {
      return { ok: false, reason: 'invalid-url' };
    }

    const local = isLocalHost(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      return { ok: false, reason: 'invalid-url' };
    }
    if (url.username || url.password) return { ok: false, reason: 'invalid-url' };
    if (url.pathname !== '/' || url.search || url.hash) return { ok: false, reason: 'invalid-url' };
    if (!local && !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) {
      return { ok: false, reason: 'invalid-url' };
    }

    return { ok: true, url: url.origin };
  }

  function applicationDirectory(locationObject) {
    const base = locationObject && locationObject.href ? locationObject.href : 'https://app.local/';
    const url = new URL('.', base);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  function validateRedirect(value, locationObject) {
    const expected = applicationDirectory(locationObject);
    if (!value) return { ok: true, url: expected };

    let url;
    try {
      url = new URL(String(value).trim());
    } catch (error) {
      return { ok: false, reason: 'invalid-redirect' };
    }

    url.search = '';
    url.hash = '';
    if (url.href !== expected) return { ok: false, reason: 'redirect-mismatch' };
    return { ok: true, url: expected };
  }

  function readConfig(documentObject, options) {
    const settings = options || {};
    const readMeta = (name) => {
      if (!documentObject || typeof documentObject.querySelector !== 'function') return '';
      const element = documentObject.querySelector(`meta[name="${name}"]`);
      return element && typeof element.getAttribute === 'function' ? element.getAttribute('content') || '' : '';
    };

    const rawUrl = settings.url !== undefined ? settings.url : readMeta(META_URL);
    const rawKey = settings.publishableKey !== undefined ? settings.publishableKey : readMeta(META_KEY);
    const url = String(rawUrl || '').trim();
    const key = String(rawKey || '').trim();

    if (!url && !key) return { ok: true, configured: false, reason: 'not-configured' };
    if (!url) return { ok: false, reason: 'missing-url' };
    if (!key) return { ok: false, reason: 'missing-key' };

    const urlResult = validateProjectUrl(url);
    if (!urlResult.ok) return urlResult;

    const keyResult = validatePublishableKey(key);
    if (!keyResult.ok) return keyResult;

    const redirectResult = validateRedirect(settings.redirectTo, settings.location);
    if (!redirectResult.ok) return redirectResult;

    return {
      ok: true,
      configured: true,
      config: {
        url: urlResult.url,
        publishableKey: key,
        redirectTo: redirectResult.url
      }
    };
  }

  function mapError(error) {
    const source = error || {};
    const code = String(source.code || source.name || '').toLowerCase();
    const name = String(source.name || '').toLowerCase();
    const text = String(source.message || '').toLowerCase();
    const hasStatus = source.status !== undefined && source.status !== null;
    const status = Number(source.status || 0);
    const haystack = `${code} ${name} ${text}`;

    if (
      (hasStatus && status === 0) ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      /retryablefetch|networkerror|failed to fetch|load failed|network request failed/.test(haystack)
    ) {
      return {
        code: 'network',
        kind: 'network',
        message: 'The account service could not be reached. Check your connection and try again.'
      };
    }

    if (SESSION_PARAMETERS.has(code) || /sessionmissing|session missing|refresh token not found/.test(haystack)) {
      return { code: 'session', kind: 'session', message: 'Your session has ended. Sign in again.' };
    }

    if (
      LINK_PARAMETERS.has(code) ||
      /authpkce|authimplicit|pkce|code verifier|flow state|confirmation link|token has expired|otp_expired/.test(haystack)
    ) {
      return {
        code: 'link',
        kind: 'link',
        message: 'This confirmation link is invalid or has expired. Request a new email and try again.'
      };
    }

    if (code === 'invalid_credentials' || /invalid login credentials/.test(text)) {
      return { code: 'invalid-credentials', kind: 'auth', message: 'Email or password is incorrect.' };
    }

    if (code === 'email_not_confirmed' || /email not confirmed/.test(text)) {
      return {
        code: 'email-not-confirmed',
        kind: 'auth',
        message: 'Check your email and confirm your address before signing in.'
      };
    }

    if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already exists/.test(text)) {
      return {
        code: 'already-exists',
        kind: 'auth',
        message: 'An account with this email already exists. Try signing in.'
      };
    }

    if (code === 'weak_password' || /password should be|weak password/.test(text)) {
      return { code: 'weak-password', kind: 'auth', message: 'Choose a stronger password.' };
    }

    if (
      code === 'over_email_send_rate_limit' ||
      code === 'over_request_rate_limit' ||
      code === 'too_many_requests' ||
      status === 429 ||
      /rate limit/.test(text)
    ) {
      return { code: 'rate-limit', kind: 'auth', message: 'Too many attempts. Wait a moment and try again.' };
    }

    if (code === 'signup_disabled' || code === 'email_provider_disabled' || code === 'provider_disabled') {
      return { code: 'disabled', kind: 'auth', message: 'Account creation is unavailable.' };
    }

    if (code === 'captcha_failed' || /captcha/.test(text)) {
      return { code: 'captcha', kind: 'auth', message: 'The verification check failed. Try again.' };
    }

    if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid email/.test(text)) {
      return { code: 'invalid-email', kind: 'auth', message: 'Enter a valid email address.' };
    }

    return { code: 'failed', kind: 'auth', message: 'That did not work. Please try again.' };
  }

  function cleanupAuthUrl(locationObject, historyObject) {
    if (!locationObject || !historyObject || typeof historyObject.replaceState !== 'function') return false;

    try {
      const url = new URL(locationObject.href);
      let changed = false;
      AUTH_QUERY_KEYS.forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      });
      if (!changed) return false;
      historyObject.replaceState(historyObject.state, '', url.toString());
      return true;
    } catch (error) {
      return false;
    }
  }

  function createAuthProvider(options) {
    const settings = options || {};
    const client = settings.client;
    if (!client || !client.auth) throw new Error('A Supabase client with auth support is required.');
    if (!settings.config || !settings.config.redirectTo) throw new Error('A validated auth configuration is required.');

    const config = settings.config;
    const locationObject = settings.location || (typeof window !== 'undefined' ? window.location : null);
    const historyObject = settings.history || (typeof window !== 'undefined' ? window.history : null);
    const navigatorObject = settings.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    const windowObject = settings.window || (typeof window !== 'undefined' ? window : null);
    const listeners = new Set();
    let state = emptyState();
    let authSubscription = null;
    let initializePromise = null;
    let initializing = false;
    let operationDepth = 0;
    let verificationSequence = 0;
    let stopped = false;
    let windowEventsBound = false;

    function notify() {
      if (stopped) return;
      const current = snapshot(state);
      listeners.forEach((listener) => {
        try {
          listener(current);
        } catch (error) {
          return;
        }
      });
    }

    function setState(next) {
      state = {
        status: next.status || 'guest',
        user: next.status === 'signed-in' || next.status === 'offline-unverified' ? normalizeUser(next.user) : null,
        code: next.code || '',
        message: next.message || ''
      };
      notify();
    }

    function resultFromState(extra) {
      const current = snapshot(state);
      return {
        ok: current.status === 'signed-in',
        status: current.status,
        user: current.user,
        code: current.code,
        message: current.message,
        ...(extra || {})
      };
    }

    function failure(mapped) {
      return {
        ok: false,
        code: mapped.code,
        message: mapped.message,
        kind: mapped.kind,
        status: state.status,
        user: snapshot(state).user
      };
    }

    function signOutFailure() {
      return {
        ok: false,
        code: 'sign-out-failed',
        message: 'We could not sign you out. Your session may still be active. Please try again.',
        kind: 'session',
        status: state.status,
        user: snapshot(state).user
      };
    }

    function getSessionResult() {
      return client.auth.getSession();
    }

    async function clearLocalSession() {
      if (typeof client.auth.signOut !== 'function') {
        return { ok: false, code: 'sign-out-unavailable' };
      }
      try {
        const response = await client.auth.signOut({ scope: 'local' });
        if (response && response.error) return { ok: false, code: 'sign-out-failed' };
        return { ok: true };
      } catch (error) {
        return { ok: false, code: 'sign-out-failed' };
      }
    }

    async function verifySession(session, sequence) {
      const currentSequence = sequence || ++verificationSequence;
      const hint = normalizeUser(session && session.user);

      if (isOffline(navigatorObject)) {
        if (currentSequence === verificationSequence) {
          setState({
            status: 'offline-unverified',
            user: hint,
            code: 'offline',
            message: 'You are offline. Sign in again when you have a connection.'
          });
        }
        return {
          ok: false,
          code: 'offline',
          status: state.status,
          user: snapshot(state).user,
          message: state.message
        };
      }

      let response;
      try {
        response = await client.auth.getUser();
      } catch (error) {
        const mapped = mapError(error);
        if (currentSequence !== verificationSequence) return { ok: false, code: 'superseded' };
        if (mapped.kind === 'network') {
          setState({ status: 'offline-unverified', user: hint, code: mapped.code, message: mapped.message });
        } else {
          setState({ status: 'guest', code: mapped.code, message: mapped.message });
        }
        return failure(mapped);
      }

      if (currentSequence !== verificationSequence) return { ok: false, code: 'superseded' };

      if (response && response.error) {
        const mapped = mapError(response.error);
        if (mapped.kind === 'network') {
          setState({ status: 'offline-unverified', user: hint, code: mapped.code, message: mapped.message });
        } else if (mapped.kind === 'session') {
          const cleared = await clearLocalSession();
          setState({
            status: 'guest',
            code: cleared.ok ? mapped.code : 'session-cleanup-failed',
            message: cleared.ok
              ? mapped.message
              : 'Your session has ended, but it could not be cleared from this browser. Reload and try again.'
          });
        } else {
          setState({ status: 'guest', code: mapped.code, message: mapped.message });
        }
        return failure(mapped);
      }

      const user = normalizeUser(response && response.data && response.data.user);
      if (!user) {
        setState({
          status: 'guest',
          code: 'no-user',
          message: 'The account service did not return a user. Please sign in again.'
        });
        return { ok: false, code: 'no-user', status: 'guest', user: null, message: state.message };
      }

      setState({ status: 'signed-in', user, code: '', message: 'Signed in.' });
      return { ok: true, status: 'signed-in', user: snapshot(state).user, code: '', message: 'Signed in.' };
    }

    async function refreshSession() {
      const sequence = ++verificationSequence;
      let response;
      try {
        response = await getSessionResult();
      } catch (error) {
        const mapped = mapError(error);
        if (sequence === verificationSequence) {
          setState({ status: 'guest', code: mapped.code, message: mapped.message });
        }
        return failure(mapped);
      }

      if (sequence !== verificationSequence) return { ok: false, code: 'superseded' };
      if (response && response.error) {
        const mapped = mapError(response.error);
        setState({ status: 'guest', code: mapped.code, message: mapped.message });
        return failure(mapped);
      }

      const session = response && response.data && response.data.session;
      if (!session) {
        setState({ status: 'guest' });
        return { ok: true, status: 'guest', user: null, code: '', message: '' };
      }

      return verifySession(session, sequence);
    }

    function handleAuthEvent(event, session) {
      if (stopped || initializing || operationDepth > 0) return;
      if (event === 'SIGNED_OUT') {
        setState({ status: 'guest' });
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        if (!session) {
          if (event === 'INITIAL_SESSION') setState({ status: 'guest' });
          return;
        }
        verifySession(session).catch(() => {});
      }
    }

    function onOnline() {
      if (state.status === 'offline-unverified') {
        refreshSession().catch(() => {});
      }
    }

    function onOffline() {
      if (state.status === 'signed-in') {
        setState({
          status: 'offline-unverified',
          user: state.user,
          code: 'offline',
          message: 'You are offline. Sign in again when you have a connection.'
        });
      }
    }

    function bindWindowEvents() {
      if (windowEventsBound || !windowObject || typeof windowObject.addEventListener !== 'function') return;
      windowObject.addEventListener('online', onOnline);
      windowObject.addEventListener('offline', onOffline);
      windowEventsBound = true;
    }

    function initialize() {
      if (initializePromise) return initializePromise;
      initializing = true;

      initializePromise = (async () => {
        try {
          bindWindowEvents();

          if (typeof client.auth.onAuthStateChange === 'function') {
            const subscription = client.auth.onAuthStateChange((event, session) => {
              handleAuthEvent(event, session);
            });
            authSubscription = subscription && subscription.data ? subscription.data.subscription : subscription;
          }

          if (typeof client.auth.initialize !== 'function') {
            throw new Error('The authentication client cannot be initialized.');
          }

          const result = await client.auth.initialize();
          if (result && result.error) {
            const mapped = mapError(result.error);
            setState({ status: 'guest', code: mapped.code, message: mapped.message });
            return failure(mapped);
          }

          return await refreshSession();
        } catch (error) {
          const mapped = mapError(error);
          setState({ status: 'guest', code: mapped.code, message: mapped.message });
          return failure(mapped);
        } finally {
          initializing = false;
          cleanupAuthUrl(locationObject, historyObject);
        }
      })();

      return initializePromise;
    }

    async function signIn(credentials) {
      const email = String((credentials && credentials.email) || '').trim();
      const password = String((credentials && credentials.password) || '');
      operationDepth += 1;
      try {
        const response = await client.auth.signInWithPassword({ email, password });
        if (response && response.error) return failure(mapError(response.error));
        const session = response && response.data && response.data.session;
        if (!session) {
          const mapped = {
            code: 'no-session',
            kind: 'auth',
            message: 'Sign-in did not create a session. Please try again.'
          };
          setState({ status: 'guest', code: mapped.code, message: mapped.message });
          return failure(mapped);
        }
        const verified = await verifySession(session);
        return verified.ok ? { ...verified, ok: true } : verified;
      } catch (error) {
        const mapped = mapError(error);
        setState({ status: 'guest', code: mapped.code, message: mapped.message });
        return failure(mapped);
      } finally {
        operationDepth -= 1;
      }
    }

    async function signUp(credentials) {
      const email = String((credentials && credentials.email) || '').trim();
      const password = String((credentials && credentials.password) || '');
      operationDepth += 1;
      try {
        const response = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: config.redirectTo }
        });
        if (response && response.error) return failure(mapError(response.error));

        const session = response && response.data && response.data.session;
        if (session) {
          const verified = await verifySession(session);
          return verified.ok ? { ...verified, ok: true } : verified;
        }

        const message = 'Check your email to confirm your account, then sign in.';
        setState({ status: 'guest', code: 'confirmation-pending', message });
        return {
          ok: true,
          pending: true,
          status: 'guest',
          user: normalizeUser(response && response.data && response.data.user),
          code: 'confirmation-pending',
          message
        };
      } catch (error) {
        const mapped = mapError(error);
        setState({ status: 'guest', code: mapped.code, message: mapped.message });
        return failure(mapped);
      } finally {
        operationDepth -= 1;
      }
    }

    async function signOut() {
      const cleared = await clearLocalSession();
      if (!cleared.ok) return signOutFailure();
      setState({ status: 'guest' });
      return { ok: true, status: 'guest', user: null, code: '', message: '' };
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      try {
        listener(snapshot(state));
      } catch (error) {
        return () => listeners.delete(listener);
      }
      return () => listeners.delete(listener);
    }

    return {
      initialize,
      signIn,
      signUp,
      signOut,
      refresh: refreshSession,
      subscribe,
      getState: () => snapshot(state),
      getConfig: () => ({ url: config.url, redirectTo: config.redirectTo }),
      destroy() {
        stopped = true;
        listeners.clear();
        if (windowEventsBound && windowObject && typeof windowObject.removeEventListener === 'function') {
          windowObject.removeEventListener('online', onOnline);
          windowObject.removeEventListener('offline', onOffline);
          windowEventsBound = false;
        }
        if (authSubscription && typeof authSubscription.unsubscribe === 'function') {
          authSubscription.unsubscribe();
        }
        authSubscription = null;
      }
    };
  }

  function createFromDocument(documentObject, windowObject) {
    const locationObject = windowObject && windowObject.location;
    const result = readConfig(documentObject, { location: locationObject });
    if (!result.ok) return { provider: null, reason: result.reason, message: 'Authentication configuration is invalid.' };
    if (!result.configured) return { provider: null, reason: result.reason, message: '' };
    if (locationObject && locationObject.protocol === 'file:') {
      return { provider: null, reason: 'file-origin', message: 'Authentication is unavailable in the desktop wrapper.' };
    }

    const sdk = windowObject && windowObject.supabase;
    if (!sdk || typeof sdk.createClient !== 'function') {
      return { provider: null, reason: 'sdk-unavailable', message: 'The authentication library is unavailable.' };
    }

    const client = sdk.createClient(result.config.url, result.config.publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        autoRefreshToken: true,
        persistSession: true,
        skipAutoInitialize: true
      }
    });

    return {
      provider: createAuthProvider({
        client,
        config: result.config,
        location: locationObject,
        history: windowObject && windowObject.history,
        navigator: windowObject && windowObject.navigator,
        window: windowObject
      }),
      reason: null,
      message: ''
    };
  }

  return {
    createAuthProvider,
    createFromDocument,
    readConfig,
    validateProjectUrl,
    validatePublishableKey,
    validateRedirect,
    mapError,
    cleanupAuthUrl,
    normalizeUser
  };
});
