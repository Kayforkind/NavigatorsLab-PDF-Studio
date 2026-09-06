import { useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import type { PageRec, Source } from '../types';
import { listFields, type FieldDesc } from '../lib/forms';
import { Dialog } from './modals';
import { Icon } from './icons';

export interface FormValuesBySource {
  [sourceId: string]: { [fieldName: string]: string | boolean };
}

interface SourceForms {
  source: Source;
  fields: FieldDesc[];
  error?: string;
}

const KIND_LABEL: Record<FieldDesc['kind'], string> = {
  text: 'Text',
  checkbox: 'Check',
  radio: 'Radio',
  dropdown: 'Choice',
};

export function FormsDialog({
  docName,
  sources,
  pages,
  values,
  onChange,
  onJump,
  onExport,
  showOnPages,
  onToggleShow,
  focusedField,
  onClose,
}: {
  docName: string;
  sources: Source[];
  pages: PageRec[];
  values: FormValuesBySource;
  onChange: (sourceId: string, field: string, v: string | boolean) => void;
  onJump: (pageIndex: number) => void;
  /** ask the app to build a filled (flattened) export right now */
  onExport: () => void;
  /** outline widgets on the page canvas, clickable to focus */
  showOnPages: boolean;
  onToggleShow: (v: boolean) => void;
  focusedField: string | null;
  onClose: () => void;
}) {
  const [forms, setForms] = useState<SourceForms[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState<string | null>(null);
  const pulseTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: SourceForms[] = [];
      for (const s of sources) {
        try {
          const lib = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
          // crop box per page for widget mapping
          const boxes = s.pages.map((p) => ({ x: p.bx ?? 0, y: p.by ?? 0, w: p.w, h: p.h }));
          out.push({ source: s, fields: listFields(lib, boxes) });
        } catch (e) {
          out.push({ source: s, fields: [], error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (alive) {
        setForms(out);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    };
  }, [sources]);

  const totalFields = useMemo(() => forms.reduce((n, f) => n + f.fields.length, 0), [forms]);
  const filledCount = useMemo(
    () =>
      forms.reduce(
        (n, f) =>
          n +
          f.fields.filter((fd) => {
            const v = values[f.source.id]?.[fd.name];
            return fd.kind === 'checkbox' ? v === true : typeof v === 'string' && v.trim().length > 0;
          }).length,
        0,
      ),
    [forms, values],
  );

  const jump = (pageIndex: number) => {
    // map source page index -> working page id
    const rec = pages.find((p) => p.src && p.page === pageIndex);
    if (rec) {
      onJump(pages.indexOf(rec));
      setPulse('scanning');
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setPulse(null), 2400);
    }
  };

  return (
    <Dialog title={`Fill form fields — ${docName}`} onClose={onClose} wide>
      <p className="modal-sub">
        {loading
          ? 'Reading form fields…'
          : totalFields === 0
            ? 'No fillable form fields found in this document. Use the text tool to type onto the page instead.'
            : `${totalFields} field${totalFields === 1 ? '' : 's'} · ${filledCount} filled. Values are written into the real form fields on export — or flattened so they can no longer be changed.`}
      </p>
      {totalFields > 0 && (
        <label className="check-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={showOnPages} onChange={(e) => onToggleShow(e.target.checked)} />
          Show field boxes on the pages (click a box to focus its field here)
        </label>
      )}
      <div className="forms-list">
        {forms.map((sf) => (
          <div key={sf.source.id} className="forms-src">
            {sf.error ? (
              <p className="muted">Could not read fields: {sf.error}</p>
            ) : sf.fields.length === 0 ? (
              <p className="muted small">{sf.source.name}: no fillable fields.</p>
            ) : (
              sf.fields.map((f) => {
                const v = values[sf.source.id]?.[f.name];
                const str = typeof v === 'string' ? v : '';
                const focused = focusedField === f.name;
                return (
                  <div className={`form-row pulse-${pulse ?? 'none'} ${focused ? 'row-focused' : ''}`} key={f.name} data-field={f.name}>
                    <span className="form-kind">{KIND_LABEL[f.kind]}</span>
                    <label className="form-name" title={f.name}>
                      {f.name}
                      <small>
                        {' '}
                        · page {f.pageIndex + 1}
                        <button className="linklike" onClick={() => jump(f.pageIndex)}>
                          view
                        </button>
                        {f.readOnly ? ' · read-only' : ''}
                      </small>
                    </label>
                    {f.kind === 'text' && (
                      <input
                        className="text-input"
                        value={str || (typeof f.value === 'string' ? f.value : '')}
                        placeholder={typeof f.value === 'string' && f.value ? f.value : 'Type…'}
                        onChange={(e) => onChange(sf.source.id, f.name, e.target.value)}
                      />
                    )}
                    {f.kind === 'checkbox' && (
                      <input
                        type="checkbox"
                        checked={v === true}
                        onChange={(e) => onChange(sf.source.id, f.name, e.target.checked)}
                      />
                    )}
                    {f.kind === 'radio' && (
                      <select
                        className="text-input"
                        value={str || f.value || ''}
                        onChange={(e) => onChange(sf.source.id, f.name, e.target.value)}
                      >
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    )}
                    {f.kind === 'dropdown' && (
                      <select
                        className="text-input"
                        value={str || f.value || ''}
                        onChange={(e) => onChange(sf.source.id, f.name, e.target.value)}
                      >
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={onExport} disabled={totalFields === 0}>
          <Icon.download /> Export filled (flatten fields)
        </button>
      </div>
    </Dialog>
  );
}
