import './style.css';
import { analyzePdf, verdictOf, VERDICT_TEXT, type Report, type Verdict } from './analyze.js';

const MAX_BYTES = 100 * 1024 * 1024;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const drop = el<HTMLDivElement>('drop');
const fileInput = el<HTMLInputElement>('file');
const status = el<HTMLParagraphElement>('status');
const result = el<HTMLElement>('result');
const verdictBox = el<HTMLDivElement>('verdict');
const verdictLabel = el<HTMLSpanElement>('verdict-label');
const verdictDetail = el<HTMLSpanElement>('verdict-detail');
const statBoxes = el<HTMLElement>('stat-boxes');
const statLeaks = el<HTMLElement>('stat-leaks');
const statPages = el<HTMLElement>('stat-pages');
const pagesEl = el<HTMLDivElement>('pages');
const downloadBtn = el<HTMLButtonElement>('download');
const againBtn = el<HTMLButtonElement>('again');

let current: { name: string; report: Report } | null = null;
let busy = false;

function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  status.textContent = text;
  status.classList.toggle('error', kind === 'error');
}

const VERDICT_DETAIL: Record<Verdict, (r: Report) => string> = {
  leaks: (r) =>
    `${r.leaks} string${r.leaks === 1 ? '' : 's'} can be copied straight out of ${r.pagesWithLeaks.length === 1 ? 'a page' : 'the pages'} below.`,
  clean: (r) => `No text was recoverable from under ${r.boxes} solid box${r.boxes === 1 ? '' : 'es'}.`,
  'no-boxes': () =>
    'Nothing in this document looks like a drawn-over redaction box. That is not a clean bill of health — see the notes below.',
};

function renderReport(report: Report, name: string): void {
  const verdict = verdictOf(report);
  current = { name, report };

  verdictBox.dataset.kind = verdict;
  verdictLabel.textContent = VERDICT_TEXT[verdict];
  verdictDetail.textContent = VERDICT_DETAIL[verdict](report);
  statBoxes.textContent = String(report.boxes);
  statLeaks.textContent = String(report.leaks);
  statPages.textContent = report.pagesWithLeaks.length
    ? report.pagesWithLeaks.join(', ')
    : '—';

  pagesEl.replaceChildren();
  for (const page of report.pages) {
    if (page.boxes.length === 0) continue;
    const section = document.createElement('article');
    section.className = 'page';
    section.dataset.page = String(page.page);
    section.dataset.leaks = String(page.leaks.length);

    const head = document.createElement('div');
    head.className = 'page-head';
    const title = document.createElement('strong');
    title.textContent = `Page ${page.page}`;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent =
      `${page.boxes.length} box${page.boxes.length === 1 ? '' : 'es'} · ` +
      `${page.leaks.length} recoverable`;
    head.append(title, count);
    section.append(head);

    for (const leak of page.leaks) {
      const box = page.boxes[leak.box];
      const item = document.createElement('div');
      item.className = 'leak';

      const meta = document.createElement('div');
      meta.className = 'leak-meta';
      const pct = Math.round(leak.frac * 100);
      meta.textContent =
        `Under the box at ${Math.round(box.x / report.scale)},${Math.round(box.y / report.scale)} ` +
        `(${Math.round(box.w / report.scale)}×${Math.round(box.h / report.scale)} pt) · ` +
        `${pct}% of the line covered · glyph band luminance ${Math.round(leak.luma)}`;

      const code = document.createElement('code');
      code.textContent = leak.text;

      item.append(meta, code);
      section.append(item);
    }

    pagesEl.append(section);
  }

  document.body.dataset.verdict = verdict;
  document.body.dataset.leaks = String(report.leaks);
  document.body.dataset.boxes = String(report.boxes);

  result.hidden = false;
  setStatus(
    `Checked ${report.pages.length} page${report.pages.length === 1 ? '' : 's'} of ${name} — all analysis happened in this browser.`,
  );
}

function reset(): void {
  current = null;
  result.hidden = true;
  pagesEl.replaceChildren();
  fileInput.value = '';
  delete document.body.dataset.verdict;
  delete document.body.dataset.leaks;
  delete document.body.dataset.boxes;
  setStatus('');
}

async function check(bytes: Uint8Array, name: string): Promise<void> {
  if (busy) return;
  busy = true;
  result.hidden = true;
  setStatus('Rendering pages…');
  try {
    const report = await analyzePdf(bytes, {
      onProgress: (done, total) => setStatus(`Rendering pages… ${done}/${total}`),
    });
    renderReport(report, name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Could not read that PDF: ${message}`, 'error');
  } finally {
    busy = false;
  }
}

async function handleFile(file: File): Promise<void> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setStatus('That file does not look like a PDF.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus(`That file is ${Math.round(file.size / 1e6)} MB — the cap here is 100 MB.`, 'error');
    return;
  }
  await check(new Uint8Array(await file.arrayBuffer()), file.name);
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void handleFile(file);
});

for (const type of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const type of ['dragleave', 'drop'] as const) {
  drop.addEventListener(type, () => drop.classList.remove('over'));
}
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});
// A stray drop elsewhere must not navigate away from the report.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

againBtn.addEventListener('click', reset);

downloadBtn.addEventListener('click', () => {
  if (!current) return;
  const payload = {
    schema: 'pdfstudio.redact-check/v1',
    file: current.name,
    checkedAt: new Date().toISOString(),
    verdict: verdictOf(current.report),
    ...current.report,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${current.name.replace(/\.pdf$/i, '')}-redact-check.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Shareable check links, and the hook used by the end-to-end verification:
//   /?demo=fixtures/fake.pdf
const demo = new URLSearchParams(location.search).get('demo');
if (demo) {
  void (async () => {
    try {
      setStatus('Loading the demo document…');
      const res = await fetch(demo);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await check(bytes, decodeURIComponent(demo.split('/').pop() ?? 'document.pdf'));
    } catch (err) {
      setStatus(`Could not load ${demo}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  })();
}
