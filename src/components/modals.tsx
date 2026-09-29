import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { DocMeta, StampOptions } from '../lib/exportPdf';
import { expandTokens, hasStamps } from '../lib/exportPdf';
import { COMPRESS_PRESETS } from '../lib/compress';
import { Icon } from './icons';
import { ShortcutCheatsheet } from './Shortcuts';
import { TRANSLATE_URL } from '../i18n';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
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
          <button className="icon-btn" onClick={onClose} title={t('dlg.closeTitle')}>
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
  const { t } = useTranslation();
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
    <Dialog title={t('sign.title')} onClose={onClose}>
      <p className="modal-sub">{t('sign.sub')}</p>
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
          {t('common.clear')}
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
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
          {t('sign.use')}
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
  /** when set, rasterize pages to JPEG at these settings after building */
  compress?: { maxSide: number; quality: number } | null;
}

import { EXPORT_RANGE_KEY } from '../lib/storage';

/** Live preview of page numbers / watermark / header-footer on a mini page. */
export function StampPreview({
  stamps,
  aspect,
  pageCount,
  title,
}: {
  stamps: StampOptions;
  /** page width / height */
  aspect: number;
  pageCount: number;
  title: string;
}) {
  const { t } = useTranslation();
  const W = 200;
  const H = Math.max(120, Math.min(320, W / Math.max(0.2, aspect)));
  const k = W / 612; // css px per PDF point at ~letter width
  const pn = expandTokens(stamps.pnFormat || '{page}', stamps.pnStart, pageCount, title);
  const wm = expandTokens(stamps.watermark, 1, pageCount, title);
  const hl = expandTokens(stamps.headerLeft, 1, pageCount, title);
  const hr = expandTokens(stamps.headerRight, 1, pageCount, title);
  const fl = expandTokens(stamps.footerLeft, 1, pageCount, title);
  const fr = expandTokens(stamps.footerRight, 1, pageCount, title);
  const pnStyle: React.CSSProperties =
    stamps.pnPosition === 'bottom-left'
      ? { left: 24 * k }
      : stamps.pnPosition === 'bottom-right'
        ? { right: 24 * k }
        : { left: '50%', transform: 'translateX(-50%)' };
  return (
    <div className="stamp-preview" style={{ width: W, height: H }}>
      <div className="sp-page-lines" />
      {wm.trim() && (
        <div
          className="sp-watermark"
          style={{ fontSize: Math.max(8, stamps.wmSize * k), color: stamps.wmColor, opacity: stamps.wmOpacity }}
        >
          {wm}
        </div>
      )}
      {(hl.trim() || hr.trim()) && (
        <div className="sp-row sp-top">
          <span>{hl}</span>
          <span>{hr}</span>
        </div>
      )}
      {stamps.pageNumbers && !stamps.pnSkipFirst && (
        <div className="sp-pagenum" style={pnStyle}>
          {pn}
        </div>
      )}
      {(fl.trim() || fr.trim()) && (
        <div className="sp-row sp-bottom">
          <span>{fl}</span>
          <span>{fr}</span>
        </div>
      )}
      <div className="sp-caption">{t('export.previewCaption', { count: pageCount })}</div>
    </div>
  );
}

export function ExportDialog({
  fileName,
  pageCount,
  pageAspect,
  meta,
  stamps,
  setStamps,
  onExport,
  onSplit,
  onPagePng,
  onClose,
}: {
  fileName: string;
  pageCount: number;
  /** width/height of the first page — used for the stamp preview */
  pageAspect: number;
  meta: DocMeta;
  stamps: StampOptions;
  setStamps: React.Dispatch<React.SetStateAction<StampOptions>>;
  onExport: (p: ExportPayload) => void;
  onSplit: (p: ExportPayload) => void;
  onPagePng: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState(() => {
    try {
      return localStorage.getItem(EXPORT_RANGE_KEY) ?? '';
    } catch {
      return ''; // private mode — start blank
    }
  });
  const [title, setTitle] = useState(meta.title || fileName);
  const [author, setAuthor] = useState(meta.author);
  const [subject, setSubject] = useState(meta.subject);
  const [keywords, setKeywords] = useState(meta.keywords);
  const [compressKey, setCompressKey] = useState<string>('');
  const payload = (): ExportPayload => ({
    range,
    meta: { title, author, subject, keywords },
    stamps,
    compress: compressKey ? { ...COMPRESS_PRESETS[compressKey].opts } : null,
  });
  /** remember the range so the dialog pre-selects it next time it opens */
  const rememberRange = () => {
    try {
      localStorage.setItem(EXPORT_RANGE_KEY, range);
    } catch {
      /* private mode — forget it */
    }
  };

  return (
    <Dialog title={t('export.title')} onClose={onClose} wide>
      <div className="export-grid">
        <section>
          <h3>{t('export.pages')}</h3>
          <p className="muted">
            <Trans i18nKey="export.pagesExplainer" values={{ count: pageCount }} components={{ code: <code /> }} />
          </p>
          <input className="text-input" value={range} onChange={(e) => setRange(e.target.value)} placeholder={t('export.allPages', { count: pageCount })} />
          <div className="modal-actions" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => { rememberRange(); onExport(payload()); }}>
              <Icon.download /> {range.trim() ? t('export.downloadRange') : t('export.download')}
            </button>
            <button className="btn ghost" onClick={() => onSplit(payload())} title={t('export.splitTitle')}>
              <Icon.split /> {t('export.split')}
            </button>
            <button className="btn ghost" onClick={onPagePng} title={t('export.pagePngTitle')}>
              <Icon.image /> {t('export.pagePng')}
            </button>
          </div>
          <details className="stamp-box">
            <summary>{t('export.stampsSummary')}</summary>
            <div className="stamp-grid">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={stamps.pageNumbers}
                  onChange={(e) => setStamps({ ...stamps, pageNumbers: e.target.checked })}
                />
                {t('export.pageNumbers')}
              </label>
              {stamps.pageNumbers && (
                <>
                  <div className="stamp-row">
                    <select
                      className="text-input"
                      value={stamps.pnPosition}
                      onChange={(e) => setStamps({ ...stamps, pnPosition: e.target.value as StampOptions['pnPosition'] })}
                    >
                      <option value="bottom-center">{t('export.posBottomCenter')}</option>
                      <option value="bottom-left">{t('export.posBottomLeft')}</option>
                      <option value="bottom-right">{t('export.posBottomRight')}</option>
                    </select>
                    <input
                      className="text-input"
                      value={stamps.pnFormat}
                      onChange={(e) => setStamps({ ...stamps, pnFormat: e.target.value })}
                      title={t('export.tokensTitle')}
                    />
                    <input
                      className="text-input num"
                      type="number"
                      min={0}
                      value={stamps.pnStart}
                      onChange={(e) => setStamps({ ...stamps, pnStart: parseInt(e.target.value || '1', 10) })}
                      title={t('export.firstPageNum')}
                    />
                    <label className="check-row">
                      <input type="checkbox" checked={stamps.pnSkipFirst} onChange={(e) => setStamps({ ...stamps, pnSkipFirst: e.target.checked })} />
                      {t('export.skipCover')}
                    </label>
                  </div>
                </>
              )}
              <div className="stamp-row">
                <input
                  className="text-input"
                  placeholder={t('export.wmPlaceholder')}
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
                      title={t('export.wmSize')}
                    />
                    <input
                      className="text-input num"
                      type="number"
                      min={0.02}
                      max={1}
                      step={0.02}
                      value={stamps.wmOpacity}
                      onChange={(e) => setStamps({ ...stamps, wmOpacity: parseFloat(e.target.value || '0.12') })}
                      title={t('export.wmOpacity')}
                    />
                    <input
                      type="color"
                      value={stamps.wmColor}
                      onChange={(e) => setStamps({ ...stamps, wmColor: e.target.value })}
                      title={t('export.wmColor')}
                    />
                  </>
                )}
              </div>
              <div className="stamp-row">
                <input className="text-input" placeholder={t('export.headerLeftPh')} value={stamps.headerLeft} onChange={(e) => setStamps({ ...stamps, headerLeft: e.target.value })} />
                <input className="text-input" placeholder={t('export.headerRightPh')} value={stamps.headerRight} onChange={(e) => setStamps({ ...stamps, headerRight: e.target.value })} />
              </div>
              <div className="stamp-row">
                <input className="text-input" placeholder={t('export.footerLeftPh')} value={stamps.footerLeft} onChange={(e) => setStamps({ ...stamps, footerLeft: e.target.value })} />
                <input className="text-input" placeholder={t('export.footerRightPh')} value={stamps.footerRight} onChange={(e) => setStamps({ ...stamps, footerRight: e.target.value })} />
              </div>
            </div>
          </details>
          <p className="muted small">{t('export.note')}</p>
          {hasStamps(stamps) ? (
            <div className="preview-wrap">
              <StampPreview stamps={stamps} aspect={pageAspect} pageCount={pageCount} title={title.trim() || fileName} />
            </div>
          ) : (
            <p className="muted small">{t('export.tip')}</p>
          )}
          <details className="stamp-box">
            <summary>{t('export.reduceSize')}</summary>
            <label className="check-row">
              <input type="checkbox" checked={compressKey !== ''} onChange={(e) => setCompressKey(e.target.checked ? 'medium' : '')} />
              {t('export.compress')}
            </label>
            {compressKey !== '' && (
              <>
                <div className="stamp-row">
                  <select className="text-input" value={compressKey} onChange={(e) => setCompressKey(e.target.value)}>
                    {Object.entries(COMPRESS_PRESETS).map(([k, p]) => (
                      <option key={k} value={k}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="muted small">
                  {t('export.compressNote')}
                </p>
              </>
            )}
          </details>
        </section>
        <section>
          <h3>{t('export.docProps')}</h3>
          <label className="stack-field">
            {t('export.metaTitle')}
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="stack-field">
            {t('export.metaAuthor')}
            <input className="text-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label className="stack-field">
            {t('export.metaSubject')}
            <input className="text-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="stack-field">
            {t('export.metaKeywords')}
            <input className="text-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </label>
        </section>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('help.title')} onClose={onClose} wide>
      <div className="help-grid">
        <section>
          <h3>{t('help.editing')}</h3>
          <ul>
            <li><Trans i18nKey="help.editingEdit" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.editingLayers" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.editingRedact" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.editingSearch" components={{ b: <b /> }} /></li>
          </ul>
        </section>
        <section>
          <h3>{t('help.pagesFiles')}</h3>
          <ul>
            <li><Trans i18nKey="help.pagesReorder" /></li>
            <li><Trans i18nKey="help.pagesMerge" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.pagesSplit" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.pagesForms" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.pagesStamps" components={{ b: <b />, code: <code /> }} /></li>
            <li><Trans i18nKey="help.pagesAutosave" components={{ b: <b /> }} /></li>
          </ul>
        </section>
        <section>
          <h3>{t('help.privacy')}</h3>
          <ul>
            <li><Trans i18nKey="help.privacyNoUploads" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.privacyNoTracking" components={{ b: <b /> }} /></li>
            <li><Trans i18nKey="help.privacyModels" components={{ i: <i /> }} /></li>
            <li><Trans i18nKey="help.translateCta" components={{ a: <a href={TRANSLATE_URL} target="_blank" rel="noreferrer" /> }} /></li>
          </ul>
        </section>
        <section>
          <h3>{t('help.shortcuts')}</h3>
          <ShortcutCheatsheet />
        </section>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>{t('help.gotIt')}</button>
      </div>
    </Dialog>
  );
}
