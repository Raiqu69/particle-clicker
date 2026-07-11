'use strict';

/** Electron entry point.
 *
 * The game loads its JSON data and HTML partials via synchronous XHR
 * (Helpers.loadFile / Angular ng-include). Chromium blocks those over the
 * file:// scheme, so we serve the app from a tiny loopback HTTP server on a
 * FIXED port. The fixed port keeps the origin stable across launches, which
 * is what makes the localStorage save persist (localStorage is keyed per
 * scheme+host+port).
 */

const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Fixed, uncommon loopback port -> stable origin -> stable save game.
const PORT = 47821;
const HOST = '127.0.0.1';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject'
};

/** Minimal, read-only static file server with path-traversal protection. */
function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { pathname = '/index.html'; }

    // Resolve inside ROOT and reject anything that escapes it.
    const filePath = path.join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

let win;

// Single-instance lock: a second launch must NOT spin up its own Chromium.
// Two instances would race for the Local Storage leveldb LOCK; the loser opens
// an EMPTY localStorage (fresh game) and its 10s autosave can overwrite the
// real save. Instead, focus the window that already owns the store.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) { win.restore(); }
      win.focus();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#0d0620',
    autoHideMenuBar: true,
    title: 'Particle Clicker',
    icon: path.join(ROOT, 'assets', 'mobile', 'original.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(`http://${HOST}:${PORT}/index.html`);

  // Open external links (e.g. the CERN-60 banner) in the real browser,
  // not inside the game window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  if (!gotLock) { return; }   // second instance is quitting — never bind the port
  Menu.setApplicationMenu(null);
  const server = createServer();
  server.on('error', (e) => {
    // If the fixed port is busy, surface it rather than failing silently.
    console.error('Static server error:', e.message);
  });
  server.listen(PORT, HOST, createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); }
});
