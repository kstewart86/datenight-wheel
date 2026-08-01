/**
 * Date Night Wheel — tiny zero-dependency server.
 *
 * Serves the static site and exposes a small JSON API that writes additions,
 * edits and deletions straight back into data/restaurants.json, so the list
 * really is saved in the project's own file.
 *
 *   node server.js            -> http://localhost:4321
 *   node server.js --port 8080
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'restaurants.json');

const portFlag = process.argv.indexOf('--port');
const PORT = Number(process.env.PORT || (portFlag !== -1 && process.argv[portFlag + 1]) || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_NAME_LENGTH = 60;

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'spot'
  );
}

function uniqueId(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

async function readList() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Write to a temp file first so a crash mid-write can never truncate the list.
async function writeList(list) {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, DATA_FILE);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': MIME['.json'] });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new Error('Please give the place a name.');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`Keep it under ${MAX_NAME_LENGTH} characters.`);
  return name;
}

// Serialise writes so two quick clicks can't clobber each other.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function handleApi(req, res, url) {
  const id = decodeURIComponent(url.pathname.replace('/api/restaurants', '').replace(/^\//, ''));

  if (req.method === 'GET' && !id) {
    return sendJson(res, 200, await readList());
  }

  if (req.method === 'POST' && !id) {
    const body = await readBody(req);
    const name = cleanName(body.name);
    return sendJson(
      res,
      201,
      await mutate(async () => {
        const list = await readList();
        if (list.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
          const err = new Error(`${name} is already on the wheel.`);
          err.status = 409;
          throw err;
        }
        const entry = { id: uniqueId(slugify(name), new Set(list.map((r) => r.id))), name };
        list.push(entry);
        await writeList(list);
        return list;
      })
    );
  }

  if (req.method === 'PUT' && id) {
    const body = await readBody(req);
    const name = cleanName(body.name);
    return sendJson(
      res,
      200,
      await mutate(async () => {
        const list = await readList();
        const target = list.find((r) => r.id === id);
        if (!target) {
          const err = new Error('That place is no longer on the wheel.');
          err.status = 404;
          throw err;
        }
        if (list.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
          const err = new Error(`${name} is already on the wheel.`);
          err.status = 409;
          throw err;
        }
        target.name = name;
        await writeList(list);
        return list;
      })
    );
  }

  if (req.method === 'DELETE' && id) {
    return sendJson(
      res,
      200,
      await mutate(async () => {
        const list = await readList();
        const next = list.filter((r) => r.id !== id);
        if (next.length !== list.length) await writeList(next);
        return next;
      })
    );
  }

  const err = new Error('Not found');
  err.status = 404;
  throw err;
}

async function handleStatic(res, url) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.join(ROOT, path.normalize(rel));

  // Never serve anything outside the project folder.
  if (!filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

  try {
    const data = await fsp.readFile(filePath);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/restaurants')) {
      await handleApi(req, res, url);
    } else {
      await handleStatic(res, url);
    }
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.message || 'Something went wrong.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🎡  Date Night Wheel running at http://localhost:${PORT}`);
  console.log(`      Saving picks to ${path.relative(ROOT, DATA_FILE)}\n`);
});
