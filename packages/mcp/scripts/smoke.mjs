/**
 * Smoke test for the BUNDLED server (dist/index.js) — the artifact users
 * actually run, not the TypeScript source the unit tests cover.
 *
 * Spawns the bundle, speaks MCP over stdio, and checks the whole loop:
 * handshake → tools/list → extract → redact → search the redacted output.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'dist', 'index.js');

if (!existsSync(serverPath)) {
  console.error(`missing ${serverPath} — run "npm run bundle" first`);
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'pdfstudio-mcp-smoke-'));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([600, 800]);
page.drawText('smoke test document', { x: 50, y: 700, size: 14, font });
page.drawText('keep this line', { x: 50, y: 660, size: 14, font });
page.drawText('burn hunter2 now', { x: 50, y: 620, size: 14, font });
writeFileSync(join(root, 'doc.pdf'), await doc.save());

const child = spawn(process.execPath, [serverPath, '--root', root], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
const stderr = [];
child.stderr.on('data', (b) => stderr.push(String(b)));

let nextId = 1;
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error('non-JSON on stdout (would corrupt the protocol):', line.slice(0, 200));
    process.exit(1);
  }
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
});

function request(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 20_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Tool results carry the failure in `isError` + content, not as a JSON-RPC error. */
const toolText = (result) => result?.content?.[0]?.text ?? '';

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pdfstudio-smoke', version: '1.0.0' },
  });
  check('initialize', init?.serverInfo?.name === 'pdfstudio', init?.serverInfo?.name);
  notify('notifications/initialized', {});

  const tools = await request('tools/list', {});
  check('tools/list exposes 10 tools', tools?.tools?.length === 10, `${tools?.tools?.length} tools`);

  const extract = await request('tools/call', {
    name: 'pdf_extract_text',
    arguments: { path: 'doc.pdf' },
  });
  const extractText = toolText(extract);
  check('pdf_extract_text reads the document', extractText.includes('smoke test document'), extract?.isError ? extractText.slice(0, 160) : '');
  check('extraction is framed as untrusted', extractText.includes('UNTRUSTED'));

  const redact = await request('tools/call', {
    name: 'pdf_redact_text',
    arguments: { path: 'doc.pdf', find: 'hunter2', output: 'red.pdf' },
  });
  const redactText = toolText(redact);
  check('pdf_redact_text burns in', redactText.includes('BURNED-IN'), redactText.split('\n')[0]);
  check('redaction report embedded', redactText.includes('pdfstudio.redact-report/v1'));

  const rescan = await request('tools/call', {
    name: 'pdf_search_text',
    arguments: { path: 'red.pdf', query: 'hunter2' },
  });
  check('redacted output no longer contains the string', /no matches/.test(toolText(rescan)));

  const escape = await request('tools/call', {
    name: 'pdf_info',
    arguments: { path: '../../etc/passwd' },
  });
  const escapeText = toolText(escape);
  check(
    'path escape is rejected',
    escape?.isError === true && /escapes/.test(escapeText),
    escapeText.slice(0, 120),
  );

  check('clean stderr', stderr.join('').trim() === '', stderr.join('').trim().slice(0, 160));
} catch (err) {
  check('run', false, err instanceof Error ? err.message : String(err));
} finally {
  child.stdin.end();
  child.kill();
  rmSync(root, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
