const http = require('http');
const path = require('path');
const fs = require('fs');

const port = 8080;
let serverInstance = null;

function startServer(currentPort) {
  if (serverInstance) {
    console.warn(`Server is already running on port ${serverInstance.address().port}`);
    return;
  }

  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(__dirname, requestPath === '/' ? 'index.html' : requestPath);
    const extname = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.wav': 'audio/wav',
    }[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 Not Found</h1>', 'utf-8');
        } else {
          res.writeHead(500);
          res.end(`Server Error: ${err.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = currentPort + 1;
      console.warn(`Port ${currentPort} is busy. Trying ${fallbackPort} instead.`);
      setTimeout(() => startServer(fallbackPort), 100);
      return;
    }

    throw error;
  });

  server.listen(currentPort, () => {
    serverInstance = server;
    console.log(`Serving app at http://localhost:${currentPort}`);
  });
}

startServer(port);
