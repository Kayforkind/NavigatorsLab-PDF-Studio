import { useRef, useState } from 'react';
import type { DiffRow } from '../lib/compare';
import { diffLines, extractLines, summarize, type CompareSummary } from '../lib/compare';
import { Dialog } from './modals';
import { Icon } from './icons';

export function CompareDialog({ onClose }: { onClose: () => void }) {
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
      setError('Please choose PDF files.');
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
      setError('Choose both PDFs first.');
      return;
    }
    setBusy('Reading documents…');
    setError(null);
    try {
      const [la, lb] = await Promise.all([extractLines(bytesA.current), extractLines(bytesB.current)]);
      setBusy('Diffing…');
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
    <Dialog title="Compare two PDFs" onClose={onClose} wide>
      <div className="cmp-pick">
        <button className="btn ghost" onClick={() => inputA.current?.click()}>
          <Icon.open /> {names.a || 'Original PDF…'}
        </button>
        <button className="btn ghost" onClick={() => inputB.current?.click()}>
          <Icon.open /> {names.b || 'Changed PDF…'}
        </button>
        <button className="btn primary" onClick={() => void run()} disabled={!!busy}>
          {busy ? busy : 'Compare'}
        </button>
        <input ref={inputA} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0], 'a')} />
        <input ref={inputB} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0], 'b')} />
      </div>
      {error && <p className="cmp-error">{error}</p>}
      {summary && (
        <p className="cmp-summary">
          <b className="add">+{summary.added}</b> added · <b className="del">−{summary.removed}</b> removed · {summary.same} unchanged
          <label className="check-row" style={{ marginLeft: 14 }}>
            <input ref={onlyChangesRef} type="checkbox" defaultChecked /> only changes
          </label>
          <span className="muted small"> — everything runs on this device.</span>
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
          Line-by-line text comparison of two PDFs, computed locally with a longest-common-subsequence diff. Scanned
          pages without a text layer are skipped.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
