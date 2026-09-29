#!/usr/bin/env node
/**
 * pdfstudio — CLI for PDF Studio.
 *
 * True in-place text editing, burned-in redaction, and page operations.
 * 100% local: no network calls, document bytes never leave the machine.
 *
 * Conventions:
 * - <input> "-" reads the PDF from stdin.
 * - "-o -" writes binary output to stdout (pipe-friendly).
 * - Exit codes: 0 ok · 1 error · 2 no matches / nothing changed · 3 redaction refused (unprovable removal).
 * - `redact` prints its machine-readable JSON report on stdout by default
 *   (or to --report <file>); on refusal it exits 3 and writes NO output PDF.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  cmdInfo,
  cmdExtractText,
  cmdSearch,
  cmdEditText,
  cmdRedact,
  cmdMerge,
  cmdSplit,
  cmdRotate,
  cmdPages,
  type MutatingResult,
  type TextOut,
} from './commands.js';
import type { RedactRect } from 'pdfstudio-core';

const VERSION = '1.0.0';

function fail(msg: string, code = 1): never {
  process.stderr.write(`pdfstudio: error: ${msg}\n`);
  process.exit(code);
}

async function readInput(spec: string): Promise<Uint8Array> {
  if (spec === '-') {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return new Uint8Array(Buffer.concat(chunks));
  }
  try {
    return new Uint8Array(readFileSync(spec));
  } catch (e) {
    fail(`cannot read "${spec}": ${(e as Error).message}`);
  }
}

function writeOut(data: Uint8Array | string, out: string | undefined, binary: boolean): void {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  if (!out || out === '-') {
    if (binary && process.stdout.isTTY) {
      fail('refusing to write binary PDF to a terminal; use -o <file> or pipe stdout');
    }
    process.stdout.write(buf);
    return;
  }
  try {
    writeFileSync(out, buf);
  } catch (e) {
    fail(`cannot write "${out}": ${(e as Error).message}`);
  }
}

function emitText(r: TextOut, json: boolean): void {
  process.stdout.write(json ? r.text + '\n' : r.text + (r.text.endsWith('\n') ? '' : '\n'));
}

function emitMutating(r: MutatingResult, out: string | undefined): void {
  if (r.noChange) {
    process.stderr.write(r.report + '\n');
    process.exit(2);
  }
  process.stderr.write(r.report + '\n');
  writeOut(r.bytes!, out, true);
}

function parsePagesOpt(v: string | undefined): number[] | undefined {
  if (!v) return undefined;
  const out: number[] = [];
  for (const part of v.split(',')) {
    const t = part.trim();
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) {
      const a = +m[1];
      const b = +m[2];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else if (/^\d+$/.test(t)) {
      out.push(+t);
    } else {
      fail(`bad --pages value "${part}"`);
    }
  }
  return [...new Set(out)];
}

function parseRect(spec: string): RedactRect {
  // <page:x,y,w,h> — points, origin bottom-left of the page's media box
  const m = /^(\d+):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(spec.trim());
  if (!m) fail(`bad --rect "${spec}"; want <page:x,y,w,h>, e.g. 1:72,500,200,24`);
  const [, p, x, y, w, h] = m;
  return { page: +p, x: +x, y: +y, w: +w, h: +h };
}

const program = new Command();
program
  .name('pdfstudio')
  .description('PDF Studio CLI — true text editing, burned-in redaction, page ops. 100% local.')
  .version(VERSION)
  .showHelpAfterError('(add --help for usage)');

program
  .command('info')
  .description('show metadata and page geometry')
  .argument('<input>', 'PDF file, or - for stdin')
  .option('--json', 'machine-readable output')
  .action(async (input: string, o: { json?: boolean }) => {
    emitText(await cmdInfo(await readInput(input), !!o.json), !!o.json);
  });

program
  .command('extract-text')
  .description('extract text per page (stdout unless -o)')
  .argument('<input>', 'PDF file, or - for stdin')
  .option('-p, --pages <spec>', '1-based pages, e.g. "1-3,5"')
  .option('-o, --output <file>', 'write to file ("-" = stdout)')
  .option('--json', 'machine-readable output')
  .action(async (input: string, o: { pages?: string; output?: string; json?: boolean }) => {
    const r = await cmdExtractText(await readInput(input), parsePagesOpt(o.pages), !!o.json);
    if (o.output && o.output !== '-') writeOut(r.text, o.output, false);
    else process.stdout.write(r.text + (r.text.endsWith('\n') ? '' : '\n'));
  });

program
  .command('search')
  .description('search text; prints page/line/snippet hits')
  .argument('<input>', 'PDF file, or - for stdin')
  .argument('<query>', 'substring to find')
  .option('--case-sensitive', 'case-sensitive match')
  .option('--json', 'machine-readable output')
  .action(async (input: string, query: string, o: { caseSensitive?: boolean; json?: boolean }) => {
    const r = await cmdSearch(await readInput(input), query, !!o.caseSensitive, !!o.json);
    if (r.json && (r.json as unknown[]).length === 0) {
      process.stderr.write('no matches\n');
      process.exit(2);
    }
    emitText(r, !!o.json);
  });

program
  .command('edit-text')
  .description('find/replace REAL text in content streams (original bytes deleted, not overlaid)')
  .argument('<input>', 'PDF file, or - for stdin')
  .requiredOption('--find <text>', 'text to find')
  .requiredOption('--replace <text>', 'replacement text ("" deletes)')
  .option('-p, --pages <spec>', '1-based page ranges, e.g. "1-3,5" (default: all)')
  .option('--all', 'replace every occurrence (default: first match only)')
  .option('--case-sensitive', 'case-sensitive match')
  .requiredOption('-o, --output <file>', 'output PDF ("-" = stdout)')
  .action(
    async (
      input: string,
      o: { find: string; replace: string; pages?: string; all?: boolean; caseSensitive?: boolean; output: string },
    ) => {
      emitMutating(
        await cmdEditText(await readInput(input), {
          find: o.find,
          replace: o.replace,
          pages: o.pages,
          all: o.all,
          caseSensitive: o.caseSensitive,
        }),
        o.output,
      );
    },
  );

program
  .command('redact')
  .description('BURNED-IN redaction: covered text is deleted from the file, unrecoverable')
  .argument('<input>', 'PDF file, or - for stdin')
  .option('--find <text>', 'redact every line containing this text')
  .option('--rect <spec>', 'redact rectangle <page:x,y,w,h> in points (repeatable)', (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option('-p, --pages <spec>', 'limit --find to these 1-based pages')
  .option('--case-sensitive', 'case-sensitive --find')
  .option('--report <file>', 'write the machine-readable JSON redaction report to <file> instead of stdout')
  .requiredOption('-o, --output <file>', 'output PDF ("-" = stdout)')
  .action(
    async (
      input: string,
      o: { find?: string; rect: string[]; pages?: string; caseSensitive?: boolean; output: string; report?: string },
    ) => {
      const r = await cmdRedact(await readInput(input), {
        find: o.find,
        rects: o.rect.map(parseRect),
        pages: o.pages,
        caseSensitive: o.caseSensitive,
      });
      const json = JSON.stringify(r.report, null, 2);
      const emitReport = () => {
        if (o.report) {
          try {
            writeFileSync(o.report, json + '\n');
          } catch (e) {
            fail(`cannot write "${o.report}": ${(e as Error).message}`);
          }
        } else {
          process.stdout.write(json + '\n');
        }
      };
      if (r.report.exitCode === 3) {
        // Refusal: report is emitted, but NO output PDF is written.
        emitReport();
        process.stderr.write(`${r.report.refusal}\n`);
        process.exit(3);
      }
      if (r.report.exitCode === 2) {
        emitReport();
        process.stderr.write('redact: nothing changed\n');
        process.exit(2);
      }
      if (o.output === '-' && !o.report) {
        fail('cannot mix the PDF bytes and the JSON report on stdout; use --report <file>');
      }
      emitReport();
      const rep = r.report;
      process.stderr.write(
        `removed ${rep.removed} line(s), ${rep.annotationsRemoved} annotation(s), ${rep.imagesPixelRedacted} image(s) pixel-redacted; verification: ${rep.verification.pass ? 'PASS' : 'FAIL'}\n`,
      );
      writeOut(r.bytes, o.output, true);
    },
  );

program
  .command('merge')
  .description('merge PDFs in order')
  .argument('<inputs...>', 'PDF files ("-" = stdin for one of them)')
  .requiredOption('-o, --output <file>', 'output PDF ("-" = stdout)')
  .action(async (inputs: string[], o: { output: string }) => {
    const bufs = [] as Uint8Array[];
    for (const i of inputs) bufs.push(await readInput(i));
    emitMutating(await cmdMerge(bufs), o.output);
  });

program
  .command('split')
  .description('split into one PDF per --ranges spec (1-based, e.g. "1-3")')
  .argument('<input>', 'PDF file, or - for stdin')
  .requiredOption('--ranges <spec>', 'range spec (repeatable)', (v: string, acc: string[]) => [...acc, v], [] as string[])
  .requiredOption('-o, --output <template>', 'output template; %d = index, %s = spec (e.g. out-%d.pdf, "-" = stdout for single)')
  .action(async (input: string, o: { ranges: string[]; output: string }) => {
    if (o.ranges.length > 1 && o.output === '-') {
      fail('split: writing multiple outputs to stdout would concatenate PDFs; use a template like out-%d.pdf');
    }
    const parts = await cmdSplit(await readInput(input), o.ranges);
    parts.forEach((p, i) => {
      const name = o.output.replace(/%d/g, String(i + 1)).replace(/%s/g, p.spec.replace(/[^0-9a-zA-Z-]+/g, '_'));
      process.stderr.write(`ranges "${p.spec}" -> pages ${p.pages.join(',')} -> ${name}\n`);
      writeOut(p.bytes, name, true);
    });
  });

program
  .command('rotate')
  .description('rotate pages clockwise by a multiple of 90°')
  .argument('<input>', 'PDF file, or - for stdin')
  .requiredOption('--angle <deg>', '90, 180 or 270', (v: string) => parseInt(v, 10))
  .option('-p, --pages <spec>', '1-based pages (default: all)')
  .requiredOption('-o, --output <file>', 'output PDF ("-" = stdout)')
  .action(async (input: string, o: { angle: number; pages?: string; output: string }) => {
    emitMutating(await cmdRotate(await readInput(input), o.angle, o.pages), o.output);
  });

program
  .command('pages')
  .description('delete and/or reorder pages')
  .argument('<input>', 'PDF file, or - for stdin')
  .option('--delete <ranges>', '1-based pages to drop, e.g. "2,5-7"')
  .option('--order <list>', '1-based new order, e.g. "3,1,2" (unlisted pages keep relative order, appended)')
  .requiredOption('-o, --output <file>', 'output PDF ("-" = stdout)')
  .action(async (input: string, o: { delete?: string; order?: string; output: string }) => {
    emitMutating(await cmdPages(await readInput(input), { delete: o.delete, order: o.order }), o.output);
  });

program.parseAsync(process.argv).catch((e) => fail(String((e as Error)?.message ?? e)));
