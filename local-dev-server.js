const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 8081);
const ROOT = __dirname;
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwxEEhfMfU8hjiR-iijOqcdPbRR-UOQOf4CMD34B0qVlhjgJYEpFXzGkopJ4inI5RyRnA/exec';
const API_PROXY_TIMEOUT_MS = 15000;
const API_PROXY_READ_RETRY_ATTEMPTS = 2;
const RETRYABLE_PROXY_ACTIONS = new Set([
    'getAttachmentDataUrl',
    'getAttachments',
    'getCarryOverAmount',
    'getClaims',
    'getExpenses',
    'getFoodExpenseById',
    'getFoodExpenses',
    'getFundReceipts',
    'getMasterData',
    'getMonthStatuses',
    'getRuntimeConfig',
    'getSystemConfig',
    'getUsers'
]);

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

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getApiAction(body) {
    try {
        const payload = JSON.parse(body);
        return typeof payload.action === 'string' ? payload.action : '';
    } catch (_) {
        return '';
    }
}

function isJsonPayload(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (_) {
        return false;
    }
}

function isTransientApiStatus(status) {
    return status === 404 || status === 408 || status === 429 || status >= 500;
}

function apiErrorBody(message, code) {
    return JSON.stringify({
        success: false,
        status: 'error',
        message,
        error: { code }
    });
}

async function fetchGasApi(body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_PROXY_TIMEOUT_MS);
    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            signal: controller.signal,
        });
        return { response, text: await response.text() };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function proxyApi(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        const action = getApiAction(body);
        const canRetry = RETRYABLE_PROXY_ACTIONS.has(action);
        const maxAttempts = canRetry ? API_PROXY_READ_RETRY_ATTEMPTS : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const { response, text } = await fetchGasApi(body);
                const contentType = response.headers.get('content-type') || '';
                const hasJsonPayload = isJsonPayload(text);
                const shouldRetry = canRetry
                    && attempt < maxAttempts
                    && (!hasJsonPayload || isTransientApiStatus(response.status));

                if (shouldRetry) {
                    await wait(700 * attempt);
                    continue;
                }

                if (!hasJsonPayload) {
                    return send(res, 502, apiErrorBody(
                        'Apps Script ตอบกลับผิดรูปแบบชั่วคราว ระบบโปรดลองใหม่อีกครั้ง',
                        'UPSTREAM_NON_JSON'
                    ), { 'Content-Type': 'application/json; charset=utf-8' });
                }

                if (isTransientApiStatus(response.status)) {
                    return send(res, 502, apiErrorBody(
                        `Apps Script ขัดข้องชั่วคราว (HTTP ${response.status})`,
                        'UPSTREAM_UNAVAILABLE'
                    ), { 'Content-Type': 'application/json; charset=utf-8' });
                }

                return send(res, response.status, text, {
                    'Content-Type': contentType || 'application/json; charset=utf-8'
                });
            } catch (err) {
                const isTimeout = err && err.name === 'AbortError';
                const shouldRetry = canRetry && attempt < maxAttempts;
                if (shouldRetry) {
                    await wait(700 * attempt);
                    continue;
                }

                return send(res, isTimeout ? 504 : 502, apiErrorBody(
                    isTimeout
                        ? `ใช้เวลาติดต่อ Apps Script เกิน ${Math.round(API_PROXY_TIMEOUT_MS / 1000)} วินาที`
                        : 'ไม่สามารถเชื่อมต่อ Apps Script ได้ชั่วคราว',
                    isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_FAILED'
                ), { 'Content-Type': 'application/json; charset=utf-8' });
            }
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
