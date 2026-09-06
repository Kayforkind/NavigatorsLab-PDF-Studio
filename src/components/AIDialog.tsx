import { useRef, useState } from 'react';
import { AI_MODELS, chat, disposeEngine, lastProgressText, loadEngine, type Engine } from '../lib/ai';
import { Dialog } from './modals';
import { Icon } from './icons';

export interface AIDialogProps {
  docName: string;
  /** builds the plain-text context of the open document (page markers included) */
  getContext: () => Promise<string>;
  onClose: () => void;
}

export function AIDialog({ docName, getContext, onClose }: AIDialogProps) {
  const [model, setModel] = useState(AI_MODELS[0].id);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [provenance, setProvenance] = useState('');
  const engineRef = useRef<Engine | null>(null);

  const ensureEngine = async (): Promise<Engine> => {
    if (engineRef.current) return engineRef.current;
    setBusy('Loading model — first run downloads it once (~0.6 GB), then it stays cached on this device.');
    engineRef.current = await loadEngine(model, (t) => {
      if (lastProgressText() !== t) setBusy(`Model: ${t}`);
    });
    setBusy('');
    return engineRef.current;
  };

  const run = async (kind: 'ask' | 'summarize') => {
    if (busy) return;
    void kind;
    setResult('');
    setProvenance('');
    setBusy(kind === 'ask' ? 'Reading your document…' : 'Reading your document…');
    let context = '';
    try {
      context = await getContext();
    } catch (e) {
      setResult(`Could not read the document: ${e instanceof Error ? e.message : e}`);
      setBusy('');
      return;
    }
    const preview = context.length > 24000 ? `${context.slice(0, 24000)}\n…[truncated]` : context;
    const system = `You are a precise document assistant. Answer only from the provided document text. If the document does not contain the answer, say so. Document: "${docName}".\n\nDOCUMENT TEXT:\n${preview}`;
    const user = kind === 'summarize' ? 'Give a concise, structured summary (headings + bullets) of this document.' : question || 'Summarize this document in a few sentences.';
    setBusy(kind === 'ask' ? 'Thinking locally…' : 'Summarizing locally…');
    try {
      const engine = await ensureEngine();
      const answer = await chat(engine, { system, user });
      setResult(answer || '(empty reply)');
      setProvenance('Generated 100% on your device — the document never left this machine.');
    } catch (e) {
      setResult(`⚠ ${e instanceof Error ? e.message : e}`);
      setProvenance('Model unavailable — extraction and page tools still work fully offline.');
    } finally {
      setBusy('');
    }
  };

  const extractText = async () => {
    if (busy) return;
    setBusy('Reading your document…');
    try {
      const text = await getContext();
      setResult(text || '(document contains no extractable text — it may be a scan. Try the OCR button in the Edit-text tool.)');
      setProvenance('Plain-text extraction ran locally.');
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog title="AI assistant — private, on-device" onClose={onClose} wide>
      <p className="modal-sub">
        Ask questions or summarize the open document. The LLM runs in <b>your browser via WebAssembly</b> — your PDF is never
        uploaded. Model weights download once (network needed for that first step only).
      </p>
      <div className="ai-controls">
        <label className="stack-field">
          Model
          <select className="text-input" value={model} onChange={(e) => setModel(e.target.value)}>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ai-actions">
          <button className="btn ghost" onClick={() => void summarize()}>
            <Icon.logo /> Summarize
          </button>
          <button className="btn ghost" onClick={() => void extractText()}>
            <Icon.file /> Extract text
          </button>
          <button className="btn ghost" onClick={() => void disposeEngine()}>
            Unload model
          </button>
        </div>
      </div>
      <div className="ai-prompt">
        <textarea
          rows={3}
          className="text-input"
          placeholder="Ask anything about this document — e.g. “What is the total due on the invoice?”"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn primary" disabled={!!busy} onClick={() => void run('ask')}>
          <Icon.sparkle /> Ask the document
        </button>
      </div>
      {busy && (
        <div className="ai-busy">
          <span className="spinner small" /> {busy}
        </div>
      )}
      {result && (
        <div className="ai-result">
          <pre>{result}</pre>
          {provenance && <p className="muted small">{provenance}</p>}
        </div>
      )}
    </Dialog>
  );

  function summarize() {
    void run('summarize');
  }
}
