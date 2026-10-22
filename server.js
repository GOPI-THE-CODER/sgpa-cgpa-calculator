const http = require('http');
const path = require('path');
const fs = require('fs');

const DEFAULT_PORT = 8080;
const HOST = '127.0.0.1';
const PROJECT_ROOT = path.resolve(__dirname);

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

function contentSecurityPolicyFor(fileName) {
  return fileName === 'index.html' ? INDEX_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY;
}

function responseHeaders(contentType, fileName) {
  const headers = { 'Content-Type': contentType };
  if (String(contentType).startsWith('text/html')) {
    headers['Content-Security-Policy'] = contentSecurityPolicyFor(fileName);
  }
  return headers;
}

let serverInstance = null;

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function handleRequest(req, res) {
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

    res.writeHead(200, responseHeaders(contentType, path.basename(filePath)));
    res.end(content, 'utf-8');
  });
}

function startServer(currentPort = DEFAULT_PORT) {
  if (serverInstance) {
    console.warn(`Server is already running on port ${serverInstance.address().port}`);
    return serverInstance;
  }

  const server = http.createServer(handleRequest);

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = currentPort + 1;
      console.warn(`Port ${currentPort} is busy. Trying ${fallbackPort} instead.`);
      setTimeout(() => startServer(fallbackPort), 100);
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
  startServer(DEFAULT_PORT);
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  PROJECT_ROOT,
  handleRequest,
  startServer
};
