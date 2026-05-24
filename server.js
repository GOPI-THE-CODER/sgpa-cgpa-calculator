const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT) || 8080;
const root = path.join(__dirname);

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const cleanPath = req.url.split('?')[0].replace(/\/\//g, '/');
  const requestPath = cleanPath === '/' ? '/index.html' : cleanPath;
  const filePath = path.join(root, decodeURIComponent(requestPath));

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer(currentPort) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && currentPort === port) {
      const fallbackPort = currentPort + 1;
      console.warn(`Port ${currentPort} is busy. Trying ${fallbackPort} instead.`);
      server.close(() => {
        startServer(fallbackPort);
      });
      return;
    }

    throw error;
  });

  server.listen(currentPort, () => {
    console.log(`Serving app at http://localhost:${currentPort}`);
  });
}

startServer(port);
