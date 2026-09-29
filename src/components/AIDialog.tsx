import { useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
  const { t } = useTranslation();
  const [model, setModel] = useState(AI_MODELS[0].id);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [provenance, setProvenance] = useState('');
  const engineRef = useRef<Engine | null>(null);

  const ensureEngine = async (): Promise<Engine> => {
    if (engineRef.current) return engineRef.current;
    setBusy(t('ai.loadingModel'));
    engineRef.current = await loadEngine(model, (p) => {
      if (lastProgressText() !== p) setBusy(t('ai.modelProgress', { progress: p }));
    });
    setBusy('');
    return engineRef.current;
  };

  const run = async (kind: 'ask' | 'summarize') => {
    if (busy) return;
    void kind;
    setResult('');
    setProvenance('');
    setBusy(t('ai.reading'));
    let context = '';
    try {
      context = await getContext();
    } catch (e) {
      setResult(t('ai.readError', { error: e instanceof Error ? e.message : String(e) }));
      setBusy('');
      return;
    }
    const preview = context.length > 24000 ? `${context.slice(0, 24000)}\n…[truncated]` : context;
    const system = `You are a precise document assistant. Answer only from the provided document text. If the document does not contain the answer, say so. Document: "${docName}".\n\nDOCUMENT TEXT:\n${preview}`;
    const user = kind === 'summarize' ? 'Give a concise, structured summary (headings + bullets) of this document.' : question || 'Summarize this document in a few sentences.';
    setBusy(kind === 'ask' ? t('ai.thinking') : t('ai.summarizing'));
    try {
      const engine = await ensureEngine();
      const answer = await chat(engine, { system, user });
      setResult(answer || t('ai.emptyReply'));
      setProvenance(t('ai.provenance'));
    } catch (e) {
      setResult(`⚠ ${e instanceof Error ? e.message : e}`);
      setProvenance(t('ai.unavailable'));
    } finally {
      setBusy('');
    }
  };

  const extractText = async () => {
    if (busy) return;
    setBusy(t('ai.reading'));
    try {
      const text = await getContext();
      setResult(text || t('ai.noText'));
      setProvenance(t('ai.extractProvenance'));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog title={t('ai.title')} onClose={onClose} wide>
      <p className="modal-sub">
        <Trans i18nKey="ai.sub" components={{ b: <b /> }} />
      </p>
      <div className="ai-controls">
        <label className="stack-field">
          {t('ai.model')}
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
            <Icon.logo /> {t('ai.summarize')}
          </button>
          <button className="btn ghost" onClick={() => void extractText()}>
            <Icon.file /> {t('ai.extractText')}
          </button>
          <button className="btn ghost" onClick={() => void disposeEngine()}>
            {t('ai.unload')}
          </button>
        </div>
      </div>
      <div className="ai-prompt">
        <textarea
          rows={3}
          className="text-input"
          placeholder={t('ai.placeholder')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn primary" disabled={!!busy} onClick={() => void run('ask')}>
          <Icon.sparkle /> {t('ai.ask')}
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
