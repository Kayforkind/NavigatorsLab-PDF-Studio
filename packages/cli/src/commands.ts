/**
 * pdfstudio CLI — command implementations over pdfstudio-core.
 *
 * Kept separate from cli.ts (the commander wiring + process I/O) so every
 * command is unit-testable without spawning a process or touching the fs.
 */
import {
  pdfInfo,
  extractText,
  searchText,
  editText,
  redactText,
  redactRects,
  mergePdfs,
  splitPdf,
  rotatePages,
  arrangePages,
  type RedactRect,
} from 'pdfstudio-core';

export interface TextOut {
  text: string;
  json: unknown;
}

const asTextOut = (text: string, json: unknown): TextOut => ({ text, json });

export async function cmdInfo(input: Uint8Array, asJson: boolean): Promise<TextOut> {
  const info = await pdfInfo(input);
  if (asJson) return asTextOut(JSON.stringify(info, null, 2), info);
  const lines = [
    `Pages: ${info.pages}`,
    ...info.pageSizes.map((s, i) => `  p${i + 1}: ${Math.round(s.width)}x${Math.round(s.height)}pt rot=${s.rotation}`),
  ];
  if (info.title) lines.push(`Title: ${info.title}`);
  if (info.author) lines.push(`Author: ${info.author}`);
  if (info.producer) lines.push(`Producer: ${info.producer}`);
  return asTextOut(lines.join('\n'), info);
}

export async function cmdExtractText(
  input: Uint8Array,
  pages: number[] | undefined,
  asJson: boolean,
): Promise<TextOut> {
  const pg = await extractText(input, pages);
  if (asJson) return asTextOut(JSON.stringify(pg, null, 2), pg);
  const text = pg.map((p) => `--- page ${p.page} ---\n${p.text}`).join('\n');
  return asTextOut(text, pg);
}

export async function cmdSearch(
  input: Uint8Array,
  query: string,
  caseSensitive: boolean,
  asJson: boolean,
): Promise<TextOut> {
  const hits = await searchText(input, query, { caseSensitive });
  if (asJson) return asTextOut(JSON.stringify(hits, null, 2), hits);
  const text =
    hits.length === 0
      ? 'no matches'
      : hits.map((h) => `p${h.page} L${h.line}: ${h.snippet}`).join('\n');
  return asTextOut(text, hits);
}

export interface MutatingResult {
  bytes?: Uint8Array;
  report: string;
  json: unknown;
  /** true when the op changed nothing (caller maps to exit code 2) */
  noChange: boolean;
}

export async function cmdEditText(
  input: Uint8Array,
  opts: { find: string; replace: string; pages?: string; all?: boolean; caseSensitive?: boolean },
): Promise<MutatingResult> {
  const r = await editText(input, opts);
  const lines = r.replacements.map(
    (x) => `p${x.page}: "${x.before.slice(0, 60)}" -> "${x.after.slice(0, 60)}"`,
  );
  for (const s of r.skipped) lines.push(`p${s.page}: SKIPPED (${s.reason})`);
  return {
    bytes: r.bytes,
    report: lines.length ? lines.join('\n') : 'no matches found',
    json: r,
    noChange: r.replacements.length === 0,
  };
}

export async function cmdRedact(
  input: Uint8Array,
  opts: { find?: string; rects?: RedactRect[]; pages?: string; caseSensitive?: boolean },
): Promise<MutatingResult> {
  if (!opts.find && !opts.rects?.length) {
    throw new Error('redact: need --find TEXT and/or --rect <page:x,y,w,h>');
  }
  let bytes = input;
  let removed = 0;
  let partial = 0;
  const skipped: Array<{ page: number; reason: string }> = [];
  if (opts.find) {
    const r = await redactText(bytes, { find: opts.find, pages: opts.pages, caseSensitive: opts.caseSensitive });
    bytes = r.bytes;
    removed += r.removed;
    partial += r.partial;
    skipped.push(...r.skipped);
  }
  if (opts.rects?.length) {
    const r = await redactRects(opts.rects, bytes);
    bytes = r.bytes;
    removed += r.removed;
    partial += r.partial;
    skipped.push(...r.skipped);
  }
  const lines = [`removed ${removed} text line(s)${partial ? `, ${partial} partially covered (left intact)` : ''}`];
  for (const s of skipped) lines.push(`p${s.page}: SKIPPED (${s.reason})`);
  return { bytes, report: lines.join('\n'), json: { removed, partial, skipped }, noChange: removed === 0 };
}

export async function cmdMerge(inputs: Uint8Array[]): Promise<MutatingResult> {
  const bytes = await mergePdfs(inputs);
  return { bytes, report: `merged ${inputs.length} file(s)`, json: { inputs: inputs.length }, noChange: false };
}

export async function cmdSplit(
  input: Uint8Array,
  specs: string[],
): Promise<Array<{ spec: string; pages: number[]; bytes: Uint8Array }>> {
  return splitPdf(input, specs);
}

export async function cmdRotate(
  input: Uint8Array,
  angle: number,
  pages?: string,
): Promise<MutatingResult> {
  const r = await rotatePages(input, pages, angle);
  return {
    bytes: r.bytes,
    report: `rotated ${r.pages.length} page(s) by ${angle}°`,
    json: r,
    noChange: false,
  };
}

export async function cmdPages(
  input: Uint8Array,
  opts: { delete?: string; order?: string },
): Promise<MutatingResult> {
  if (!opts.delete?.trim() && !opts.order?.trim()) {
    throw new Error('pages: need --delete <ranges> and/or --order <list>');
  }
  const r = await arrangePages(input, opts);
  return {
    bytes: r.bytes,
    report: `new order: ${r.newOrder.join(',')}`,
    json: r,
    noChange: false,
  };
}
