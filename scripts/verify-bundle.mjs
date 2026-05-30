// Verifies that the production build is a single, fully self-contained HTML file
// with no external network dependencies — safe to pass around / drop as an artifact.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const indexPath = join(dist, 'index.html');

const fail = (msg) => {
  console.error(`✗ bundle check failed: ${msg}`);
  process.exit(1);
};

let html;
try {
  html = readFileSync(indexPath, 'utf8');
} catch {
  fail(`${indexPath} not found — run \`vite build\` first`);
}

// 1) No external script/style references (everything must be inlined).
const externalScript = /<script[^>]*\ssrc=["'](?!data:)/i.test(html);
const externalLink = /<link[^>]*\srel=["']stylesheet["'][^>]*\shref=["'](?!data:)/i.test(html);
if (externalScript) fail('found a <script src=...> referencing an external file');
if (externalLink) fail('found an external stylesheet <link>');

// 2) No http(s) asset fetches baked into the markup.
if (/(?:src|href)=["']https?:\/\//i.test(html)) {
  fail('found an absolute http(s) resource reference');
}

// 3) The bundle should be the only emitted JS/CSS artifact.
const stray = readdirSync(dist).filter((f) => /\.(js|css)$/i.test(f));
if (stray.length > 0) fail(`stray non-inlined assets in dist/: ${stray.join(', ')}`);

const sizeKb = (statSync(indexPath).size / 1024).toFixed(1);
console.log(`✓ single self-contained artifact: ${indexPath} (${sizeKb} KB, 0 external requests)`);
