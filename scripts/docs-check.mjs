import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = [
  'product',
  'architecture',
  'connectivity',
  'security',
  'ai',
  'plugins',
  'development',
  'release',
  'maps',
  'mail',
  'continuity',
  'nearby-exchange',
  'photos',
  'web-library',
  'inbox',
  'subscriptions',
  'files',
  'tasks',
  'contacts',
  'documents',
  'capture',
];

const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path);
  }
  return files;
}

function display(path) {
  return relative(root, path) || '.';
}

function isExternal(target) {
  return target.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function checkLinks(path, source) {
  const linkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of source.matchAll(linkPattern)) {
    let target = match[1];
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (isExternal(target)) continue;
    const hash = target.indexOf('#');
    const query = target.indexOf('?');
    const cutAt = [hash, query].filter((value) => value >= 0).sort((a, b) => a - b)[0];
    const fileTarget = cutAt === undefined ? target : target.slice(0, cutAt);
    if (!fileTarget) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(fileTarget);
    } catch {
      errors.push(`${display(path)}: malformed link target ${target}`);
      continue;
    }
    const resolved = resolve(dirname(path), decoded);
    if (!(await exists(resolved))) errors.push(`${display(path)}: broken local link ${target}`);
  }
}

const files = [resolve(root, 'README.md'), ...(await walk(resolve(root, 'docs'))), ...(await walk(resolve(root, 'apps'))), ...(await walk(resolve(root, 'packages'))), resolve(root, 'CONTRIBUTING.md')];
const uniqueFiles = [];
for (const path of [...new Set(files)]) {
  if (await exists(path)) uniqueFiles.push(path);
}

for (const path of uniqueFiles) {
  const source = await readFile(path, 'utf8');
  await checkLinks(path, source);
  const normalized = display(path).toLowerCase();
  if (/(^|\/)(r0p\d+(?:-[^/]+)?|phase\d+(?:-[^/]+)?|[^/]*-phase)\.md$/.test(normalized)) {
    errors.push(`${display(path)}: phase-style documentation filename`);
  }
  if (/ячеист[\p{L}\p{M}]*\s+сет[\p{L}\p{M}]*/iu.test(source)) {
    errors.push(`${display(path)}: use "Мэш-сеть" for the Russian mesh term`);
  }
  if (/\/home\/[\w.-]+\/Development\/keystone(?:\/|$)/.test(source)) {
    errors.push(`${display(path)}: developer-specific absolute path`);
  }
}

const canonicalFiles = canonical.map((name) => resolve(root, 'docs', `${name}.md`));
for (const name of canonical) {
  const english = resolve(root, 'docs', `${name}.md`);
  const russian = resolve(root, 'docs', 'ru', `${name}.md`);
  if (!(await exists(english))) errors.push(`missing canonical English page docs/${name}.md`);
  if (!(await exists(russian))) errors.push(`missing canonical Russian page docs/ru/${name}.md`);
}

const phaseFreeCanonical = [
  resolve(root, 'README.md'),
  ...canonicalFiles,
  ...canonical.map((name) => resolve(root, 'docs', 'ru', `${name}.md`)),
];
for (const path of phaseFreeCanonical) {
  if (!(await exists(path))) continue;
  const source = await readFile(path, 'utf8');
  if (/\bR0P\d+\b|\bPhase\s*\d+\b/i.test(source)) {
    errors.push(`${display(path)}: phase reference in canonical documentation`);
  }
}

if (errors.length > 0) {
  console.error(`docs:check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`docs:check PASS (${uniqueFiles.length} Markdown files, ${canonical.length} EN/RU canonical pairs)`);
}
