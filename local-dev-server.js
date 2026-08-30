const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 8081);
const ROOT = __dirname;
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwxEEhfMfU8hjiR-iijOqcdPbRR-UOQOf4CMD34B0qVlhjgJYEpFXzGkopJ4inI5RyRnA/exec';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

function send(res, statusCode, body, headers = {}) {
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        ...headers,
    });
    res.end(body);
}

function resolveStaticPath(urlPath) {
    const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
    const requested = cleanPath === '/' ? '/index.html' : cleanPath;
    const filePath = path.resolve(ROOT, '.' + requested);
    if (!filePath.startsWith(ROOT)) return null;
    return filePath;
}

async function proxyApi(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body,
            });
            const text = await response.text();
            const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
            send(res, response.status, text, { 'Content-Type': contentType });
        } catch (err) {
            send(res, 502, JSON.stringify({
                success: false,
                status: 'error',
                message: 'Local proxy failed: ' + err.message,
            }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
    });
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        return send(res, 204, '');
    }

    if (req.url === '/api' && req.method === 'POST') {
        return proxyApi(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const filePath = resolveStaticPath(req.url);
    if (!filePath) {
        return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            return send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not Found' : err.message, {
                'Content-Type': 'text/plain; charset=utf-8',
            });
        }
        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        send(res, 200, req.method === 'HEAD' ? '' : data, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        });
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`RDF local dev server running at http://127.0.0.1:${PORT}/`);
    console.log('API proxy: /api -> Google Apps Script');
});
