#!/usr/bin/env node
// 의존성 없는 정적 파일 서버. Funnel 이 프록시할 로컬 서버로 쓴다.
// 사용법: node scripts/serve-static.mjs <폴더> [포트=4173] [호스트=127.0.0.1]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const host = process.argv[4] ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function fileFor(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = normalize(join(root, p));
  if (full !== root && !full.startsWith(root + sep)) return null; // 폴더 밖 접근 차단
  try {
    const st = statSync(full);
    if (st.isDirectory()) return fileFor(urlPath.replace(/\/?$/, '/'));
    return { full, size: st.size };
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const f = fileFor(req.url ?? '/');
  if (!f) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const hashed = f.full.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': TYPES[extname(f.full)] ?? 'application/octet-stream',
    'content-length': f.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(f.full).pipe(res);
});

server.on('error', (e) => {
  console.error(`서버를 시작할 수 없습니다: ${e.message}`);
  process.exit(1);
});
server.listen(port, host, () => console.log(`serving ${root} at http://${host}:${port}/`));
