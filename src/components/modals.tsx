import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocMeta, StampOptions } from '../lib/exportPdf';
import { defaultStamps } from '../lib/exportPdf';
import { Icon } from './icons';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon.x />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SignPadModal({ onSave, onClose }: { onSave: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(false);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvasRef.current!.width, y: ((e.clientY - r.top) / r.height) * canvasRef.current!.height };
  };

  const setup = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#101020';
    ctx.lineWidth = 2.6 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  useEffect(() => {
    setup();
  }, []);

  return (
    <Dialog title="Draw your signature" onClose={onClose}>
      <p className="modal-sub">Sign with mouse, trackpad, or touch. It stays on your device and is only stamped onto this document.</p>
      <canvas
        ref={canvasRef}
        className="sign-pad"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          drawing.current = true;
          last.current = pos(e);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e);
          const ctx = canvasRef.current!.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          setDirty(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <div className="modal-actions">
        <button className="btn ghost" onClick={() => {
          setup();
          setDirty(false);
        }}>
          Clear
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={() => {
            const c = canvasRef.current!;
            const tmp = document.createElement('canvas');
            tmp.width = c.width;
            tmp.height = c.height;
            const tctx = tmp.getContext('2d')!;
            tctx.clearRect(0, 0, tmp.width, tmp.height);
            const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
            // drop the white background -> transparent PNG
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i + 3] = 0;
            }
            tctx.putImageData(img, 0, 0);
            onSave(tmp.toDataURL('image/png'));
          }}
        >
          Use this signature
        </button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export interface ExportPayload {
  range: string;
  meta: DocMeta;
  stamps?: StampOptions;
}

export function ExportDialog({
  fileName,
  pageCount,
  meta,
  onExport,
  onSplit,
  onClose,
}: {
  fileName: string;
  pageCount: number;
  meta: DocMeta;
  onExport: (p: ExportPayload) => void;
  onSplit: (p: ExportPayload) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState('');
  const [title, setTitle] = useState(meta.title || fileName);
  const [author, setAuthor] = useState(meta.author);
  const [subject, setSubject] = useState(meta.subject);
  const [keywords, setKeywords] = useState(meta.keywords);
  const [stamps, setStamps] = useState<StampOptions>(defaultStamps);
  const payload = (): ExportPayload => ({ range, meta: { title, author, subject, keywords }, stamps });

  return (
    <Dialog title="Export PDF" onClose={onClose} wide>
      <div className="export-grid">
        <section>
          <h3>Pages</h3>
          <p className="muted">
            Leave blank for all {pageCount} pages, or enter a range such as <code>1-3, 5</code> to extract only those pages into a new
            file (split/extract).
          </p>
          <input className="text-input" value={range} onChange={(e) => setRange(e.target.value)} placeholder={`All ${pageCount} pages`} />
          <div className="modal-actions" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => onExport(payload())}>
              <Icon.download /> {range.trim() ? 'Download these pages' : 'Download PDF'}
            </button>
            <button className="btn ghost" onClick={() => onSplit(payload())} title="Creates one PDF file per page">
              <Icon.split /> Split — one file per page
            </button>
          </div>
          <details className="stamp-box">
            <summary>Page numbers, watermark &amp; header/footer</summary>
            <div className="stamp-grid">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={stamps.pageNumbers}
                  onChange={(e) => setStamps({ ...stamps, pageNumbers: e.target.checked })}
                />
                Page numbers
              </label>
              {stamps.pageNumbers && (
                <>
                  <div className="stamp-row">
                    <select
                      className="text-input"
                      value={stamps.pnPosition}
                      onChange={(e) => setStamps({ ...stamps, pnPosition: e.target.value as StampOptions['pnPosition'] })}
                    >
                      <option value="bottom-center">bottom center</option>
                      <option value="bottom-left">bottom left</option>
                      <option value="bottom-right">bottom right</option>
                    </select>
                    <input
                      className="text-input"
                      value={stamps.pnFormat}
                      onChange={(e) => setStamps({ ...stamps, pnFormat: e.target.value })}
                      title="Tokens: {page} {pages}"
                    />
                    <input
                      className="text-input num"
                      type="number"
                      min={0}
                      value={stamps.pnStart}
                      onChange={(e) => setStamps({ ...stamps, pnStart: parseInt(e.target.value || '1', 10) })}
                      title="First page number"
                    />
                    <label className="check-row">
                      <input type="checkbox" checked={stamps.pnSkipFirst} onChange={(e) => setStamps({ ...stamps, pnSkipFirst: e.target.checked })} />
                      skip cover
                    </label>
                  </div>
                </>
              )}
              <div className="stamp-row">
                <input
                  className="text-input"
                  placeholder="Watermark text (blank = none)"
                  value={stamps.watermark}
                  onChange={(e) => setStamps({ ...stamps, watermark: e.target.value })}
                />
                {stamps.watermark.trim() !== '' && (
                  <>
                    <input
                      className="text-input num"
                      type="number"
                      min={8}
                      max={200}
                      value={stamps.wmSize}
                      onChange={(e) => setStamps({ ...stamps, wmSize: parseInt(e.target.value || '56', 10) })}
                      title="Watermark size"
                    />
                    <input
                      className="text-input num"
                      type="number"
                      min={0.02}
                      max={1}
                      step={0.02}
                      value={stamps.wmOpacity}
                      onChange={(e) => setStamps({ ...stamps, wmOpacity: parseFloat(e.target.value || '0.12') })}
                      title="Watermark opacity"
                    />
                    <input
                      type="color"
                      value={stamps.wmColor}
                      onChange={(e) => setStamps({ ...stamps, wmColor: e.target.value })}
                      title="Watermark color"
                    />
                  </>
                )}
              </div>
              <div className="stamp-row">
                <input className="text-input" placeholder="Header left — tokens: {title} {page} {date}" value={stamps.headerLeft} onChange={(e) => setStamps({ ...stamps, headerLeft: e.target.value })} />
                <input className="text-input" placeholder="Header right" value={stamps.headerRight} onChange={(e) => setStamps({ ...stamps, headerRight: e.target.value })} />
              </div>
              <div className="stamp-row">
                <input className="text-input" placeholder="Footer left" value={stamps.footerLeft} onChange={(e) => setStamps({ ...stamps, footerLeft: e.target.value })} />
                <input className="text-input" placeholder="Footer right — {date}" value={stamps.footerRight} onChange={(e) => setStamps({ ...stamps, footerRight: e.target.value })} />
              </div>
            </div>
          </details>
          <p className="muted small">Rotation, reordering, blank pages and all marks are applied. Sticky-note text stays in the app (markers are stamped).</p>
        </section>
        <section>
          <h3>Document properties</h3>
          <label className="stack-field">
            Title
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="stack-field">
            Author
            <input className="text-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label className="stack-field">
            Subject
            <input className="text-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="stack-field">
            Keywords
            <input className="text-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </label>
        </section>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="How PDF Studio works" onClose={onClose} wide>
      <div className="help-grid">
        <section>
          <h3>Editing</h3>
          <ul>
            <li><b>Edit text</b> — switch to the edit tool and click a line (or one table cell) of the original PDF. On export the original text is rewritten in place inside the PDF content stream — tables keep their column positions, and the replacement becomes real selectable text. Scanned images need the OCR tool (same toolbar).</li>
            <li><b>Add text</b>, <b>highlight</b>, <b>underline</b>, <b>strikethrough</b>, <b>notes</b>, <b>freehand pen</b>, <b>arrows &amp; pointers</b>, <b>rectangles</b> and <b>ellipses</b> all layer on top and are flattened into the exported file.</li>
            <li><b>Redact</b> paints permanent black boxes — nothing sensitive remains visible in the exported file; <b>whiteout</b> samples the page background so it blends in.</li>
            <li><b>Search</b> — the box in the top bar finds text across the whole document; Enter / Shift+Enter jump between matches.</li>
          </ul>
        </section>
        <section>
          <h3>Pages &amp; files</h3>
          <ul>
            <li>Drag thumbnails to reorder, use hover buttons to rotate / duplicate / delete / insert blank pages.</li>
            <li><b>Merge</b>: while a document is open, choose <b>Merge PDF</b> (or drop a file and pick “Merge”).</li>
            <li><b>Split / extract</b>: Export &gt; enter a page range, or “one file per page”.</li>
            <li><b>Forms</b>: the Forms button lists fillable AcroForm fields (text, checkboxes, radios, dropdowns). Values are written into the real fields on Save, or flattened from the dialog.</li>
            <li><b>Stamps</b>: in Export, add page numbers, a diagonal watermark, and header/footer text (tokens: <code>{'{page}'}</code> <code>{'{pages}'}</code> <code>{'{date}'}</code> <code>{'{title}'}</code>).</li>
            <li><b>Autosave</b>: your working session (including annotations and form values) is kept on this device and offered on the start screen after a refresh or crash.</li>
          </ul>
        </section>
        <section>
          <h3>Privacy</h3>
          <ul>
            <li><b>No uploads</b> — documents are opened, edited and saved entirely on this device.</li>
            <li><b>No attachments kept, no user information retained</b> — there is no account, no tracking of your files, and nothing is stored on any server. Your session autosaves locally in your browser and only you can read it.</li>
            <li>Optional AI/OCR models download public weights once; your <i>documents</i> never touch the network.</li>
          </ul>
        </section>
        <section>
          <h3>Shortcuts</h3>
          <ul>
            <li><kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Ctrl/⌘ Y</kbd> or <kbd>Ctrl/⌘⇧Z</kbd> redo</li>
            <li><kbd>Ctrl/⌘ O</kbd> open · <kbd>Ctrl/⌘ S</kbd> save a copy</li>
            <li><kbd>Del</kbd> delete the selected mark · <kbd>Esc</kbd> cancel / deselect</li>
            <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>0</kbd> fit to width</li>
          </ul>
        </section>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>Got it</button>
      </div>
    </Dialog>
  );
}
