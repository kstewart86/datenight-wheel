/**
 * Date Night Wheel — tiny zero-dependency server.
 *
 * Serves the static site and exposes a small JSON API that writes additions,
 * edits and deletions straight back into data/*.json, so the lists really are
 * saved in the project's own files.
 *
 *   node server.js            -> http://localhost:4321
 *   node server.js --port 8080
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

// The wheels the API will serve. Anything else is a 404.
const LISTS = new Set(['restaurants', 'bars']);

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
const MAX_WEIGHT = 50;

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fileFor(list) {
  return path.join(DATA_DIR, `${list}.json`);
}

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

async function readList(list) {
  try {
    const raw = await fsp.readFile(fileFor(list), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Write to a temp file first so a crash mid-write can never truncate a list.
async function writeList(list, items) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const target = fileFor(list);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, target);
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
      if (raw.length > 10_000) reject(fail('Body too large', 413));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(fail('Invalid JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw fail('Please give it a name.', 400);
  if (name.length > MAX_NAME_LENGTH) throw fail(`Keep it under ${MAX_NAME_LENGTH} characters.`, 400);
  return name;
}

// How many slices this entry gets on the wheel.
function cleanWeight(value) {
  if (value === undefined || value === null || value === '') return 1;
  const weight = Number(value);
  if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
    throw fail(`Slices must be a whole number from 1 to ${MAX_WEIGHT}.`, 400);
  }
  return weight;
}

function assertNameFree(items, name, exceptId) {
  if (items.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
    throw fail(`${name} is already on the wheel.`, 409);
  }
}

// Serialise writes so two quick clicks can't clobber each other.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', list, id?]
  const list = parts[1];
  const id = parts[2] ? decodeURIComponent(parts[2]) : '';

  if (!LISTS.has(list) || parts.length > 3) throw fail('Not found', 404);

  if (req.method === 'GET' && !id) {
    return sendJson(res, 200, await readList(list));
  }

  if (req.method === 'POST' && !id) {
    const body = await readBody(req);
    const name = cleanName(body.name);
    const weight = cleanWeight(body.weight);
    return sendJson(
      res,
      201,
      await mutate(async () => {
        const items = await readList(list);
        assertNameFree(items, name);
        items.push({ id: uniqueId(slugify(name), new Set(items.map((r) => r.id))), name, weight });
        await writeList(list, items);
        return items;
      })
    );
  }

  if (req.method === 'PUT' && id) {
    const body = await readBody(req);
    const name = cleanName(body.name);
    const weight = cleanWeight(body.weight);
    return sendJson(
      res,
      200,
      await mutate(async () => {
        const items = await readList(list);
        const target = items.find((r) => r.id === id);
        if (!target) throw fail('That one is no longer on the wheel.', 404);
        assertNameFree(items, name, id);
        target.name = name;
        target.weight = weight;
        await writeList(list, items);
        return items;
      })
    );
  }

  if (req.method === 'DELETE' && id) {
    return sendJson(
      res,
      200,
      await mutate(async () => {
        const items = await readList(list);
        const next = items.filter((r) => r.id !== id);
        if (next.length !== items.length) await writeList(list, next);
        return next;
      })
    );
  }

  throw fail('Not found', 404);
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
    if (url.pathname.startsWith('/api/')) {
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
  console.log(`      Saving picks to ${path.relative(ROOT, DATA_DIR)}\\{${[...LISTS].join(',')}}.json\n`);
});
