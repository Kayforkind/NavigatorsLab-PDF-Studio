import { useState } from 'react';
import type { Annotation, ToolId, ToolSettings } from '../types';
import { Icon } from './icons';

const COLORS = ['#ffd400', '#7cf29c', '#69c4ff', '#ff8fd0', '#ff7a5c', '#c4b5fd', '#ff5c5c', '#a8b3c0', '#17171b'];

const TOOL_BLURBS: Record<ToolId, string> = {
  select: 'Click an item to select it. Drag to move; drag the blue corner to resize. Delete removes it.',
  edit: 'Click a line of the original text — NavigatorsLab PDF Studio detects it and lets you retype it. The old glyphs are painted over with the page background, then your new text is stamped on top.',
  text: 'Click anywhere and type. Press Enter to place, Esc to cancel.',
  highlight: 'Drag across text to highlight it. Adjust color and opacity below.',
  underline: 'Drag across text to underline it.',
  strike: 'Drag across text to strike it through.',
  note: 'Click to drop a sticky-note marker. Double-click it or select it to edit the note text.',
  ink: 'Draw freehand with the pointer (mouse, pen or finger).',
  sign: 'Draw a signature once; it is remembered for this session and stamped where you click.',
  image: 'Choose an image file; it is stamped at the click point. Drag to position, corner to scale.',
  redact: 'Drag a box over sensitive content to permanently black it out in the exported PDF.',
  whiteout: 'Drag a box to cover content with the sampled page background — ideal for cleaning up a scan.',
};

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

const colorTools = new Set<ToolId>(['highlight', 'underline', 'strike', 'ink', 'text', 'note']);

export function Inspector({
  tool,
  settings,
  onSettings,
  selected,
  onUpd,
  onDel,
  onOcr,
  ocrBusy,
}: {
  tool: ToolId;
  settings: ToolSettings;
  onSettings: (s: Partial<ToolSettings>) => void;
  selected: Annotation | null;
  onUpd: (id: string, patch: Partial<Annotation>) => void;
  onDel: (id: string) => void;
  onOcr: () => void;
  ocrBusy: string;
}) {
  const [noteText, setNoteText] = useState<string | null>(null);
  const colorable = selected && (selected.type === 'highlight' || selected.type === 'underline' || selected.type === 'strike' || selected.type === 'ink' || selected.type === 'text' || selected.type === 'edit' || selected.type === 'note');
  const geometry = selected && (selected.type === 'highlight' || selected.type === 'underline' || selected.type === 'strike' || selected.type === 'redact' || selected.type === 'whiteout' || selected.type === 'edit' || selected.type === 'image');

  return (
    <aside className="inspector">
      <section className="insp-sec">
        <h3>Tool</h3>
        <p className="tool-blurb">{TOOL_BLURBS[tool]}</p>
        {colorTools.has(tool) && (
          <>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${settings.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => onSettings({ color: c })}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
            <div className="slider-row">
              <span>Opacity</span>
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
        {(tool === 'ink') && (
          <div className="slider-row">
            <span>Pen width</span>
            <input type="range" min={0.5} max={14} step={0.5} value={settings.width} onChange={(e) => onSettings({ width: parseFloat(e.target.value) })} />
            <b>{settings.width.toFixed(1)}pt</b>
          </div>
        )}
        {(tool === 'text' || tool === 'edit') && (
          <div className="slider-row">
            <span>Size</span>
            <input type="range" min={6} max={48} step={0.5} value={settings.fontSize} onChange={(e) => onSettings({ fontSize: parseFloat(e.target.value) })} />
            <b>{settings.fontSize.toFixed(0)}pt</b>
          </div>
        )}
        {tool === 'redact' && <p className="tool-blurb warn">Redactions are flattened black boxes — content underneath is permanently hidden in the exported file.</p>}
        {tool === 'whiteout' && <p className="tool-blurb">The cover color is sampled from the page under your drag, so whiteouts blend in on tinted or scanned pages.</p>}
        {tool === 'note' && <p className="tool-blurb">Marker color:</p>}
        {tool === 'edit' && (
          <button className="btn ghost ocr-cta" onClick={onOcr} disabled={!!ocrBusy}>
            {ocrBusy ? <span className="spinner small" /> : null}
            {ocrBusy ? ocrBusy : 'OCR this page → editable text'}
          </button>
        )}
      </section>

      <section className="insp-sec">
        <h3>
          Selection
          {selected ? <button className="mini-del" title="Delete (Del)" onClick={() => onDel(selected.id)}><Icon.trash /></button> : null}
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
                  placeholder={selected.type === 'note' ? 'Write the note…' : 'Content…'}
                  onChange={(e) => setNoteText(e.target.value)}
                  onBlur={() => {
                    if (noteText !== null) onUpd(selected.id, { text: noteText } as Partial<Annotation>);
                    setNoteText(null);
                  }}
                />
              </div>
            )}
            {selected.type === 'image' && (
              <div className="flip-row">
                <button
                  className={`btn ghost tiny ${(selected as { flipH?: boolean }).flipH ? 'active' : ''}`}
                  onClick={() => onUpd(selected.id, { flipH: !(selected as { flipH?: boolean }).flipH } as Partial<Annotation>)}
                  title="Mirror the stamp horizontally"
                >
                  ⇋ Flip H
                </button>
                <button
                  className={`btn ghost tiny ${(selected as { flipV?: boolean }).flipV ? 'active' : ''}`}
                  onClick={() => onUpd(selected.id, { flipV: !(selected as { flipV?: boolean }).flipV } as Partial<Annotation>)}
                  title="Mirror the stamp vertically"
                >
                  ⇵ Flip V
                </button>
              </div>
            )}
            {colorable && (
              <div className="swatches small">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${(selected as { color: string }).color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => onUpd(selected.id, { color: c } as Partial<Annotation>)}
                  />
                ))}
              </div>
            )}
            <p className="hint muted">Double-click text or a note marker to edit its content in place.</p>
          </div>
        ) : (
          <p className="hint muted">Nothing selected. Use the Select tool and click a mark, or drag with a tool to create one.</p>
        )}
      </section>

      <section className="insp-sec privacy">
        <h3>Privacy</h3>
        <p>All processing happens in this browser tab. Files are never uploaded; export is generated locally.</p>
      </section>
    </aside>
  );
}
