const http = require('http');
const path = require('path');
const fs = require('fs');
const auth = require('./auth-provider.js');

const DEFAULT_PORT = 8080;
const HOST = '127.0.0.1';
const PROJECT_ROOT = path.resolve(__dirname);
const LOCAL_AUTH_FLAG = '--local-auth';
const SUPABASE_URL_META = 'sgpa-supabase-url';
const SUPABASE_KEY_META = 'sgpa-supabase-publishable-key';
const URL_META_PATTERN = /(<meta name="sgpa-supabase-url" content=")[^"]*(" \/>)/;
const KEY_META_PATTERN = /(<meta name="sgpa-supabase-publishable-key" content=")[^"]*(" \/>)/;
const CSP_META_PATTERN = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav'
};

/**
 * The same restrictive policy the pages declare in a <meta> element. The
 * header is delivered for HTML documents only, so the policy is applied
 * before the browser parses the document and the meta element stays as the
 * fallback for any environment that does not use this server.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

/**
 * The local server mirrors the policy declared by index.html, so enabling the
 * configured Supabase origin in the page does not require a second edit here.
 * Every other document, including offline.html, keeps the auth-free default.
 */
function readIndexContentSecurityPolicy() {
  try {
    const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const match = head.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/);
    return match ? match[1] : CONTENT_SECURITY_POLICY;
  } catch (error) {
    return CONTENT_SECURITY_POLICY;
  }
}

const INDEX_CONTENT_SECURITY_POLICY = readIndexContentSecurityPolicy();
let activeLocalAuth = null;

function validateLocalAuthConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const url = String(source.url || '').trim();
  const publishableKey = String(source.publishableKey || '').trim();
  const urlResult = auth.validateProjectUrl(url);

  if (!urlResult.ok) {
    throw new Error('the local authentication configuration has an invalid Supabase URL');
  }

  const keyResult = auth.validatePublishableKey(publishableKey);
  if (!keyResult.ok) {
    if (keyResult.reason === 'secret-key') {
      throw new Error('the local authentication configuration must not contain a secret or service-role key');
    }
    throw new Error('the local authentication configuration has an invalid publishable key');
  }

  return Object.freeze({ url: urlResult.url, publishableKey });
}

function loadLocalAuthConfig(configPath) {
  if (!configPath) {
    throw new Error('--local-auth requires a configuration file path');
  }

  const resolvedPath = path.resolve(configPath);
  const relativePath = path.relative(PROJECT_ROOT, resolvedPath);
  const outsideProject =
    relativePath !== '' &&
    (relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath));

  if (!outsideProject) {
    throw new Error('the local authentication configuration must be stored outside the repository');
  }

  let source;
  try {
    source = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new Error('the local authentication configuration file could not be read');
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('the local authentication configuration is not valid JSON');
  }

  return validateLocalAuthConfig(parsed);
}

function addConnectSource(policy, origin) {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);
  const index = directives.findIndex((directive) => directive.split(/\s+/)[0] === 'connect-src');

  if (index === -1) {
    throw new Error('index.html is missing a connect-src directive');
  }

  const tokens = directives[index].split(/\s+/);
  if (!tokens.includes(origin)) tokens.push(origin);
  directives[index] = tokens.join(' ');
  return directives.join('; ');
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = source.match(new RegExp(pattern.source, flags));

  if (!matches || matches.length !== 1) {
    throw new Error(`index.html must contain exactly one ${label}`);
  }

  return source.replace(pattern, replacement);
}

function injectLocalAuthHtml(html, localAuth) {
  const policy = addConnectSource(INDEX_CONTENT_SECURITY_POLICY, localAuth.url);
  let result = replaceExactlyOnce(
    html,
    URL_META_PATTERN,
    (match, prefix, suffix) => `${prefix}${escapeAttribute(localAuth.url)}${suffix}`,
    `${SUPABASE_URL_META} meta tag`
  );

  result = replaceExactlyOnce(
    result,
    KEY_META_PATTERN,
    (match, prefix, suffix) => `${prefix}${escapeAttribute(localAuth.publishableKey)}${suffix}`,
    `${SUPABASE_KEY_META} meta tag`
  );

  result = replaceExactlyOnce(
    result,
    CSP_META_PATTERN,
    (match, prefix, suffix) => `${prefix}${escapeAttribute(policy)}${suffix}`,
    'Content-Security-Policy meta tag'
  );

  return { html: result, policy };
}

function contentSecurityPolicyFor(fileName, localAuth) {
  if (fileName !== 'index.html') return CONTENT_SECURITY_POLICY;
  return localAuth
    ? addConnectSource(INDEX_CONTENT_SECURITY_POLICY, localAuth.url)
    : INDEX_CONTENT_SECURITY_POLICY;
}

function responseHeaders(contentType, fileName, localAuth) {
  const headers = { 'Content-Type': contentType };
  if (String(contentType).startsWith('text/html')) {
    headers['Content-Security-Policy'] = contentSecurityPolicyFor(fileName, localAuth);
    if (fileName === 'index.html' && localAuth) {
      headers['Cache-Control'] = 'no-store';
    }
  }
  return headers;
}

let serverInstance = null;

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function handleRequest(req, res) {
  const localAuth = activeLocalAuth;
  let requestPath;

  try {
    requestPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  if (requestPath.includes('\0')) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const requestedFile = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.resolve(PROJECT_ROOT, `.${requestedFile}`);
  const relativePath = path.relative(PROJECT_ROOT, filePath);

  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, responseHeaders('text/html', '404.html'));
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code}`);
      }
      return;
    }

    const fileName = path.basename(filePath);
    if (fileName === 'index.html' && localAuth) {
      let transformed;
      try {
        transformed = injectLocalAuthHtml(content.toString('utf8'), localAuth);
      } catch (error) {
        sendText(res, 500, 'Server Error: local authentication injection failed');
        return;
      }

      res.writeHead(200, responseHeaders(contentType, fileName, localAuth));
      res.end(transformed.html, 'utf-8');
      return;
    }

    res.writeHead(200, responseHeaders(contentType, fileName, localAuth));
    res.end(content, 'utf-8');
  });
}

function localAuthFileArgument(argv) {
  const index = argv.indexOf(LOCAL_AUTH_FLAG);
  if (index === -1) return null;

  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--local-auth requires a configuration file path');
  }
  return value;
}

function startServer(currentPort = DEFAULT_PORT, options = {}) {
  if (serverInstance) {
    console.warn(`Server is already running on port ${serverInstance.address().port}`);
    return serverInstance;
  }

  const settings = options && typeof options === 'object' ? options : {};
  const localAuth = settings.localAuth
    ? validateLocalAuthConfig(settings.localAuth)
    : settings.localAuthFile
      ? loadLocalAuthConfig(settings.localAuthFile)
      : null;

  activeLocalAuth = localAuth;

  const server = http.createServer(handleRequest);

  server.once('close', () => {
    if (serverInstance === server) serverInstance = null;
  });

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = currentPort + 1;
      console.warn(`Port ${currentPort} is busy. Trying ${fallbackPort} instead.`);
      setTimeout(() => {
        try {
          startServer(fallbackPort, settings);
        } catch (fallbackError) {
          console.error(`Local authentication server not started: ${fallbackError.message}`);
          process.exitCode = 1;
        }
      }, 100);
      return;
    }

    throw error;
  });

  server.listen(currentPort, HOST, () => {
    serverInstance = server;
    console.log(`Serving app at http://${HOST}:${server.address().port}`);
  });

  return server;
}

if (require.main === module) {
  try {
    const localAuthFile = localAuthFileArgument(process.argv.slice(2));
    startServer(DEFAULT_PORT, localAuthFile ? { localAuthFile } : {});
  } catch (error) {
    console.error(`Local authentication server not started: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  PROJECT_ROOT,
  handleRequest,
  loadLocalAuthConfig,
  startServer
};
