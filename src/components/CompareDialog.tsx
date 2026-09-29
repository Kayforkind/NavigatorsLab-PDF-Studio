import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiffRow } from '../lib/compare';
import { diffLines, extractLines, summarize, type CompareSummary } from '../lib/compare';
import { Dialog } from './modals';
import { Icon } from './icons';

export function CompareDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const inputA = useRef<HTMLInputElement>(null);
  const inputB = useRef<HTMLInputElement>(null);
  const bytesA = useRef<Uint8Array | null>(null);
  const bytesB = useRef<Uint8Array | null>(null);
  const onlyChangesRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined, which: 'a' | 'b') => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError(t('compare.pickPdf'));
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    if (which === 'a') {
      bytesA.current = buf;
      setNames((n) => ({ ...n, a: file.name }));
    } else {
      bytesB.current = buf;
      setNames((n) => ({ ...n, b: file.name }));
    }
    setError(null);
  };

  const run = async () => {
    if (!bytesA.current || !bytesB.current) {
      setError(t('compare.pickBoth'));
      return;
    }
    setBusy(t('compare.reading'));
    setError(null);
    try {
      const [la, lb] = await Promise.all([extractLines(bytesA.current), extractLines(bytesB.current)]);
      setBusy(t('compare.diffing'));
      await new Promise((r) => setTimeout(r, 30)); // let the UI breathe
      const d = diffLines(la, lb);
      setRows(d);
      setSummary(summarize(d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const onlyChanges = () => onlyChangesRef.current?.checked ?? false;

  return (
    <Dialog title={t('compare.title')} onClose={onClose} wide>
      <div className="cmp-pick">
        <button className="btn ghost" onClick={() => inputA.current?.click()}>
          <Icon.open /> {names.a || t('compare.original')}
        </button>
        <button className="btn ghost" onClick={() => inputB.current?.click()}>
          <Icon.open /> {names.b || t('compare.changed')}
        </button>
        <button className="btn primary" onClick={() => void run()} disabled={!!busy}>
          {busy ? busy : t('compare.compare')}
        </button>
        <input ref={inputA} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0], 'a')} />
        <input ref={inputB} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0], 'b')} />
      </div>
      {error && <p className="cmp-error">{error}</p>}
      {summary && (
        <p className="cmp-summary">
          <b className="add">+{summary.added}</b> {t('compare.added')} · <b className="del">−{summary.removed}</b> {t('compare.removed')} · {t('compare.unchanged', { count: summary.same })}
          <label className="check-row" style={{ marginLeft: 14 }}>
            <input ref={onlyChangesRef} type="checkbox" defaultChecked /> {t('compare.onlyChanges')}
          </label>
          <span className="muted small">{t('compare.localNote')}</span>
        </p>
      )}
      {rows && (
        <div className="cmp-list">
          {rows
            .filter((r) => (onlyChanges() ? r.op !== 'same' : true))
            .map((r, i) => (
              <div key={i} className={`cmp-row cmp-${r.op}`}>
                <span className="cmp-pg">{(r.left ?? r.right)!.page}</span>
                <span className="cmp-sign">{r.op === 'add' ? '+' : r.op === 'del' ? '−' : ' '}</span>
                <span className="cmp-text">{r.left?.text ?? r.right?.text}</span>
              </div>
            ))}
        </div>
      )}
      {!rows && !busy && (
        <p className="muted small" style={{ marginTop: 10 }}>
          {t('compare.explainer')}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </Dialog>
  );
}
