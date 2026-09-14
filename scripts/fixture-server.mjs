/**
 * Serve the fictional Northvale fixture pages on loopback.
 *
 * For dry runs of the research skills against pages that describe an
 * institution that does not exist (see docs/dry-run.md). Binds to 127.0.0.1
 * only, serves files from tests/fixtures/pages and nothing else, and has no
 * dependencies.
 *
 *   node scripts/fixture-server.mjs [port]      default port 5199
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { rootDir } from './lib.mjs';

const pagesDir = resolve(rootDir, 'tests', 'fixtures', 'pages');
const siteDir = resolve(pagesDir, 'site');
const port = Number.parseInt(process.argv[2] ?? '5199', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write('Usage: node scripts/fixture-server.mjs [port]\n');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
};

function listPages(dir = pagesDir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listPages(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

function indexHtml() {
  const items = listPages()
    .map((name) => `      <li><a href="/${name.startsWith('site/') ? name.slice(5).replace(/(\/index)?\.html$/, '') : encodeURIComponent(name)}">${name}</a></li>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
  <head><title>Northvale Institute of Technology — fixture pages</title></head>
  <body>
    <h1>Northvale Institute of Technology</h1>
    <p>This site is a fictional fixture served from tests/fixtures/pages. Northvale Institute of Technology does not exist, and every address on it is fictional.</p>
    <h2>Pages</h2>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

/** True when `candidate` is a regular file inside pagesDir. */
function insidePages(candidate) {
  if (candidate !== pagesDir && !candidate.startsWith(pagesDir + sep)) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Map a request to a file inside pagesDir, or null when it escapes or is
 * missing. The fictional site lives under `site/` with clean URLs:
 * `/engineering/ece` → `site/engineering/ece.html`, `/` → `site/index.html`,
 * `/engineering/ece/people?page=2` → `site/engineering/ece/people.page2.html`.
 * Files directly under pagesDir (the older single-page fixtures) stay
 * reachable by their file name.
 */
function resolvePage(url) {
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '').replace(/\/+$/, '');
  if (relative.includes('\0')) return null;
  const pageParam = url.searchParams.get('page');
  const siteBase = relative === '' ? 'index' : relative;
  const candidates = [];
  if (pageParam && /^[0-9]{1,3}$/.test(pageParam) && pageParam !== '1') {
    candidates.push(resolve(siteDir, `${siteBase}.page${pageParam}.html`));
  }
  candidates.push(resolve(siteDir, `${siteBase}.html`), resolve(siteDir, siteBase, 'index.html'));
  if (relative !== '') candidates.push(resolve(pagesDir, relative));
  for (const candidate of candidates) {
    if (insidePages(candidate)) return candidate;
  }
  return null;
}

/**
 * Paths that behave like the awkward parts of a real site: a staff-only
 * listing that answers 403 to anonymous visitors, and a citations profile
 * that only renders in a browser (a plain fetch gets a JavaScript shell).
 */
const special = [
  { test: (path) => path === '/engineering/ece/adjuncts', status: 403, body: 'Forbidden: staff login required\n' },
  { test: (path) => path.startsWith('/scholar/'), file: 'scholar-shell.html' },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('Method not allowed\n');
    return;
  }
  if (url.pathname === '/fixtures' || url.pathname === '/fixtures.html') {
    const body = indexHtml();
    res.writeHead(200, { 'content-type': types['.html'], 'content-length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const rule = special.find((entry) => entry.test(url.pathname));
  if (rule?.status) {
    res.writeHead(rule.status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : rule.body);
    return;
  }
  const file = rule?.file ? resolve(pagesDir, 'site', rule.file) : resolvePage(url);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
    return;
  }
  const body = readFileSync(file);
  const type = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'x-fixture': 'northvale' });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `Fixture pages: http://127.0.0.1:${port}/\nServing ${listPages().length} file(s) from ${pagesDir} (file list at /fixtures)\nFictional institution only. Press Ctrl+C to stop.\n`,
  );
});
server.on('error', (error) => {
  process.stderr.write(`fixture-server: ${error.message}\n`);
  process.exit(1);
});
