/**
 * Spawned CLI tests for the redaction report contract:
 * - passing run: stdout (or --report) carries parseable JSON with pass:true,
 *   verification details, and exit code 0
 * - refusal run (Type0 font): exit code 3, refusal on stderr, report on
 *   stdout, NO output PDF written
 * - `-o -` without --report: non-zero exit (cannot mix bytes + JSON on stdout)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from 'pdf-lib';
import { extractText } from 'pdfstudio-core';

const SRC_DIR = new URL('.', import.meta.url).pathname;
const CLI_DIR = resolve(SRC_DIR, '..');
const CORE_DIR = resolve(CLI_DIR, '../core');
const CLI_BIN = join(CLI_DIR, 'dist', 'cli.js');
const SCRATCH = resolve(fileURLToPath(new URL('../../../../.tmp', import.meta.url)));

async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  let y = 750;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 14, font });
    y -= 20;
  }
  return doc.save();
}

async function makeType0Pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText('type0 secret line', { x: 50, y: 750, size: 14, font });
  const fake = doc.context.obj({
    Type: PDFName.of('Font'),
    Subtype: PDFName.of('Type0'),
    BaseFont: PDFName.of('FakeCIDFont'),
  });
  const res = page.node.Resources()!;
  res.lookupMaybe(PDFName.of('Font'), PDFDict)!.set(PDFName.of('F99'), doc.context.register(fake));
  return doc.save();
}

function runCli(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const p = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    env: { ...process.env, TMPDIR: SCRATCH },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
}

beforeAll(
  () => {
    // The spawned binary runs from dist: rebuild both packages first.
    for (const d of [CORE_DIR, CLI_DIR]) {
      execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], {
        cwd: d,
        env: { ...process.env, TMPDIR: SCRATCH },
        timeout: 240000,
        stdio: 'pipe',
      });
    }
  },
  300000,
);

describe('cli redact report', () => {
  it('passing run prints parseable JSON to stdout; output PDF is clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfstudio-redact-'));
    const input = join(dir, 'in.pdf');
    const out = join(dir, 'out.pdf');
    return makePdf(['keep me', 'burn hunter2 now']).then(async (bytes) => {
      writeFileSync(input, bytes);
      const r = runCli(['redact', input, '--find', 'hunter2', '-o', out], dir);
      expect(r.code).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(report.schema).toBe('pdfstudio.redact-report/v1');
      expect(report.pass).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.find).toBe('hunter2');
      expect(report.pages).toEqual([1]);
      expect(report.removed).toBeGreaterThan(0);
      expect(report.verification.pass).toBe(true);
      expect(report.verification.byteScan).toBe('pass');
      expect(report.verification.extraction).toBe('pass');
      expect(report.verification.stringsChecked.length).toBeGreaterThan(0);
      expect(report.scrubbed).toContain('info-dict');
      expect(report.refusal).toBeNull();
      // the output PDF exists and is actually clean
      expect(existsSync(out)).toBe(true);
      const pages = await extractText(new Uint8Array(readFileSync(out)));
      expect(pages[0].text).not.toContain('hunter2');
      expect(pages[0].text).toContain('keep me');
    });
  });

  it('--report writes the JSON to a file instead of stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfstudio-redact-'));
    const input = join(dir, 'in.pdf');
    const out = join(dir, 'out.pdf');
    const rep = join(dir, 'report.json');
    writeFileSync(input, await makePdf(['burn hunter2 now']));
    const r = runCli(['redact', input, '--find', 'hunter2', '-o', out, '--report', rep], dir);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('');
    const report = JSON.parse(readFileSync(rep, 'utf8'));
    expect(report.pass).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it('refusal: Type0 font -> exit 3, refusal on stderr, report on stdout, NO output written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfstudio-redact-'));
    const input = join(dir, 'evil.pdf');
    const out = join(dir, 'must-not-exist.pdf');
    writeFileSync(input, await makeType0Pdf());
    const r = runCli(['redact', input, '--find', 'type0 secret', '-o', out], dir);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('redaction refused');
    expect(r.stderr).toContain('Type0/Type3');
    const report = JSON.parse(r.stdout);
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(3);
    expect(report.refusal).toContain('Type0/Type3');
    expect(report.skipped.some((s: { unprovable: boolean }) => s.unprovable)).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  it('-o - without --report exits non-zero (bytes and JSON cannot share stdout)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfstudio-redact-'));
    const input = join(dir, 'in.pdf');
    writeFileSync(input, await makePdf(['burn hunter2 now']));
    const r = runCli(['redact', input, '--find', 'hunter2', '-o', '-'], dir);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--report');
  });

  it('no-match run exits 2 with a report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfstudio-redact-'));
    const input = join(dir, 'in.pdf');
    const out = join(dir, 'out.pdf');
    writeFileSync(input, await makePdf(['hello world']));
    const r = runCli(['redact', input, '--find', 'zzz-no-match', '-o', out], dir);
    expect(r.code).toBe(2);
    const report = JSON.parse(r.stdout);
    expect(report.exitCode).toBe(2);
    expect(report.pass).toBe(true);
  });
});
