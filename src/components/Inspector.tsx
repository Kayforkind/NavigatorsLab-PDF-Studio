import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Annotation, ToolId, ToolSettings } from '../types';
import { OCR_LANGS, isOcrLang, type OcrLang } from '../lib/ocr';
import { Icon } from './icons';

const COLORS = ['#ffd400', '#7cf29c', '#69c4ff', '#ff8fd0', '#ff7a5c', '#c4b5fd', '#ff5c5c', '#a8b3c0', '#17171b'];

function useToolBlurb(): Record<ToolId, string> {
  const { t } = useTranslation();
  return {
    select: t('insp.blurb.select'),
    edit: t('insp.blurb.edit'),
    text: t('insp.blurb.text'),
    highlight: t('insp.blurb.highlight'),
    underline: t('insp.blurb.underline'),
    strike: t('insp.blurb.strike'),
    note: t('insp.blurb.note'),
    ink: t('insp.blurb.ink'),
    sign: t('insp.blurb.sign'),
    image: t('insp.blurb.image'),
    redact: t('insp.blurb.redact'),
    whiteout: t('insp.blurb.whiteout'),
    arrow: t('insp.blurb.arrow'),
    rect: t('insp.blurb.rect'),
    ellipse: t('insp.blurb.ellipse'),
    formtext: t('insp.blurb.formtext'),
    formcheck: t('insp.blurb.formcheck'),
  };
}

function Field({
  label,
  value,
  onCommit,
  step,
  min,
  max,
  decimals = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={txt ?? Number(value.toFixed(decimals))}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const n = parseFloat(txt ?? '');
          if (!Number.isNaN(n)) onCommit(n);
          setTxt(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

const colorTools = new Set<ToolId>(['highlight', 'underline', 'strike', 'ink', 'text', 'edit', 'note', 'arrow', 'rect', 'ellipse', 'redact']);
const widthTools = new Set<ToolId>(['ink', 'arrow', 'rect', 'ellipse']);
const FONT_OPTIONS: Array<[string, string]> = [
  ['Helvetica', 'Helvetica (sans)'],
  ['Times', 'Times (serif)'],
  ['Courier', 'Courier (mono)'],
];
const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

function SwatchRow({ current, onPick }: { current: string; onPick: (c: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${current === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={t('insp.colorAria', { color: c })} />
        ))}
      </div>
      <label className="swatch-custom">
        <input type="color" value={isHex(current) ? current : '#17171b'} onChange={(e) => onPick(e.target.value)} aria-label={t('insp.customColor')} />
        <span>{t('insp.custom')}</span>
      </label>
    </>
  );
}

export function Inspector({
  tool,
  settings,
  onSettings,
  selected,
  onUpd,
  onDel,
  onOcr,
  ocrBusy,
  ocrLang,
  setOcrLang,
  drawerOpen = false,
  onDrawerClose,
}: {
  tool: ToolId;
  settings: ToolSettings;
  onSettings: (s: Partial<ToolSettings>) => void;
  selected: Annotation | null;
  onUpd: (id: string, patch: Partial<Annotation>) => void;
  onDel: (id: string) => void;
  onOcr: () => void;
  ocrBusy: string;
  ocrLang: OcrLang;
  setOcrLang: (l: OcrLang) => void;
  /** narrow-viewport drawer mode (sidebar hidden by CSS below 1100px) */
  drawerOpen?: boolean;
  onDrawerClose?: () => void;
}) {
  const { t } = useTranslation();
  const TOOL_BLURBS = useToolBlurb();
  const [noteText, setNoteText] = useState<string | null>(null);
  const colorable = selected && (selected.type === 'highlight' || selected.type === 'underline' || selected.type === 'strike' || selected.type === 'ink' || selected.type === 'text' || selected.type === 'edit' || selected.type === 'note' || selected.type === 'arrow' || selected.type === 'rect' || selected.type === 'ellipse' || selected.type === 'redact');
  const resizable = selected && (selected.type === 'arrow' || selected.type === 'rect' || selected.type === 'ellipse');
  const geometry = selected && (selected.type === 'highlight' || selected.type === 'underline' || selected.type === 'strike' || selected.type === 'redact' || selected.type === 'whiteout' || selected.type === 'edit' || selected.type === 'image');

  return (
    <aside className={`inspector ${drawerOpen ? 'drawer-open' : ''}`}>
      {drawerOpen && (
        <button className="drawer-close" title={t('insp.closePanel')} onClick={onDrawerClose}>
          ✕
        </button>
      )}
      <section className="insp-sec">
        <h3>{t('insp.tool')}</h3>
        <p className="tool-blurb">{TOOL_BLURBS[tool]}</p>
        {colorTools.has(tool) && (
          <>
            <SwatchRow current={settings.color} onPick={(c) => onSettings({ color: c })} />
            <div className="slider-row">
              <span>{t('insp.opacity')}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={settings.opacity}
                onChange={(e) => onSettings({ opacity: parseFloat(e.target.value) })}
              />
              <b>{Math.round(settings.opacity * 100)}%</b>
            </div>
          </>
        )}
        {widthTools.has(tool) && (
          <div className="slider-row">
            <span>{tool === 'ink' ? t('insp.penWidth') : t('insp.lineWidth')}</span>
            <input type="range" min={0.5} max={14} step={0.5} value={settings.width} onChange={(e) => onSettings({ width: parseFloat(e.target.value) })} />
            <b>{settings.width.toFixed(1)}pt</b>
          </div>
        )}
        {(tool === 'text' || tool === 'edit') && (
          <div className="slider-row">
            <span>{t('insp.font')}</span>
            <select value={settings.font ?? 'Helvetica'} onChange={(e) => onSettings({ font: e.target.value })}>
              {FONT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
        {(tool === 'text' || tool === 'edit') && (
          <div className="slider-row">
            <span>{t('insp.size')}</span>
            <input type="range" min={6} max={48} step={0.5} value={settings.fontSize} onChange={(e) => onSettings({ fontSize: parseFloat(e.target.value) })} />
            <b>{settings.fontSize.toFixed(0)}pt</b>
          </div>
        )}
        {tool === 'redact' && <p className="tool-blurb warn">{t('insp.redactWarn')}</p>}
        {tool === 'whiteout' && <p className="tool-blurb">{t('insp.whiteoutBlurb')}</p>}
        {tool === 'note' && <p className="tool-blurb">{t('insp.markerColor')}</p>}
        {tool === 'edit' && (
          <>
            <div className="slider-row">
              <span>{t('insp.ocrLang')}</span>
              <select
                className="text-input"
                value={ocrLang}
                disabled={!!ocrBusy}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isOcrLang(v)) setOcrLang(v);
                }}
                title={t('insp.ocrTitle')}
              >
                {OCR_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {t('insp.ocrOption', { label: l.label, size: l.size })}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn ghost ocr-cta" onClick={onOcr} disabled={!!ocrBusy}>
              {ocrBusy ? <span className="spinner small" /> : null}
              {ocrBusy ? ocrBusy : t('insp.ocrCta')}
            </button>
          </>
        )}
      </section>

      <section className="insp-sec">
        <h3>
          {t('insp.selection')}
          {selected ? <button className="mini-del" title={t('insp.deleteSel')} onClick={() => onDel(selected.id)}><Icon.trash /></button> : null}
        </h3>
        {selected ? (
          <div className="sel-detail">
            <div className="sel-type">{selected.type.toUpperCase()}</div>
            {geometry && (
              <div className="field-grid">
                <Field label="X" value={selected.x} onCommit={(v) => onUpd(selected.id, { x: v } as Partial<Annotation>)} />
                <Field label="Y" value={selected.y} onCommit={(v) => onUpd(selected.id, { y: v } as Partial<Annotation>)} />
                <Field label="W" value={selected.w} onCommit={(v) => onUpd(selected.id, { w: v } as Partial<Annotation>)} min={1} />
                <Field label="H" value={selected.h} onCommit={(v) => onUpd(selected.id, { h: v } as Partial<Annotation>)} min={1} />
              </div>
            )}
            {(selected.type === 'text' || selected.type === 'edit' || selected.type === 'note') && (
              <div className="note-edit">
                <textarea
                  rows={3}
                  value={noteText ?? ('text' in selected ? (selected as { text: string }).text : '')}
                  placeholder={selected.type === 'note' ? t('insp.notePlaceholder') : t('insp.contentPlaceholder')}
                  onChange={(e) => setNoteText(e.target.value)}
                  onBlur={() => {
                    if (noteText !== null) onUpd(selected.id, { text: noteText } as Partial<Annotation>);
                    setNoteText(null);
                  }}
                />
              </div>
            )}
            {selected.type === 'image' && (
              <div className="slider-row">
                <span>{t('insp.size')}</span>
                <input
                  type="range"
                  min={24}
                  max={720}
                  step={2}
                  value={Math.round((selected as { w: number }).w)}
                  onChange={(e) => {
                    const ann = selected as { w: number; h: number };
                    const nw = parseFloat(e.target.value);
                    const nh = ann.h > 0.001 ? (nw * ann.h) / ann.w : ann.h;
                    onUpd(selected.id, { w: nw, h: nh } as Partial<Annotation>);
                  }}
                />
                <b>{Math.round((selected as { w: number }).w)}pt</b>
              </div>
            )}
            {selected.type === 'image' && (
              <div className="flip-row">
                <button
                  className={`btn ghost tiny ${(selected as { flipH?: boolean }).flipH ? 'active' : ''}`}
                  onClick={() => onUpd(selected.id, { flipH: !(selected as { flipH?: boolean }).flipH } as Partial<Annotation>)}
                  title={t('insp.flipH')}
                >
                  {t('insp.flipHLabel')}
                </button>
                <button
                  className={`btn ghost tiny ${(selected as { flipV?: boolean }).flipV ? 'active' : ''}`}
                  onClick={() => onUpd(selected.id, { flipV: !(selected as { flipV?: boolean }).flipV } as Partial<Annotation>)}
                  title={t('insp.flipV')}
                >
                  {t('insp.flipVLabel')}
                </button>
              </div>
            )}
            {colorable && <SwatchRow current={(selected as { color: string }).color} onPick={(c) => onUpd(selected.id, { color: c } as Partial<Annotation>)} />}
            {(selected.type === 'text' || selected.type === 'edit') && (
              <div className="slider-row">
                <span>{t('insp.font')}</span>
                <select
                  value={(selected as { font?: string }).font ?? 'Helvetica'}
                  onChange={(e) => onUpd(selected.id, { font: e.target.value } as Partial<Annotation>)}
                >
                  {FONT_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(selected.type === 'text' || selected.type === 'edit') && (
              <div className="slider-row">
                <span>{t('insp.size')}</span>
                <input
                  type="range"
                  min={6}
                  max={48}
                  step={0.5}
                  value={(selected as { size: number }).size}
                  onChange={(e) => onUpd(selected.id, { size: parseFloat(e.target.value) } as Partial<Annotation>)}
                />
                <b>{(selected as { size: number }).size.toFixed(0)}pt</b>
              </div>
            )}
            {resizable && (
              <div className="slider-row">
                <span>{t('insp.lineWidth')}</span>
                <input
                  type="range"
                  min={0.5}
                  max={14}
                  step={0.5}
                  value={(selected as { width: number }).width}
                  onChange={(e) => onUpd(selected.id, { width: parseFloat(e.target.value) } as Partial<Annotation>)}
                />
                <b>{(selected as { width: number }).width.toFixed(1)}pt</b>
              </div>
            )}
            <p className="hint muted">{t('insp.editHint')}</p>
          </div>
        ) : (
          <p className="hint muted">{t('insp.nothingSelected')}</p>
        )}
      </section>

      <section className="insp-sec privacy">
        <h3>{t('insp.privacy')}</h3>
        <p>{t('insp.privacyNote')}</p>
      </section>
    </aside>
  );
}
