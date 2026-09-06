import { useState, type DragEvent } from 'react';
import { Icon } from './icons';

export function Landing({
  busy,
  onOpen,
  onDemo,
  onDropFile,
  saved,
  onRestore,
}: {
  busy: boolean;
  onOpen: () => void;
  onDemo: () => void;
  onDropFile: (e: DragEvent) => void;
  saved?: { name: string; at: number } | null;
  onRestore?: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="landing">
      <div className="landing-hero">
        <h1>
          PDF Studio.
          <br />
          <span>Private, free, open source.</span>
        </h1>
        <p className="landing-sub">
          Edit the text that is already in your PDF, mark it up, sign it, organize the pages, merge and split — all inside your
          browser. No account, no watermark, no uploads, no page limits.
        </p>
        <div className="landing-features">
          <span><Icon.edit /> Edit existing text</span>
          <span><Icon.highlight /> Highlight &amp; comment</span>
          <span><Icon.sign /> Sign &amp; stamp</span>
          <span><Icon.redact /> Redact</span>
          <span><Icon.copy /> Organize pages</span>
          <span><Icon.split /> Merge &amp; split</span>
        </div>
        <p className="landing-brand">
          Free &amp; open source (MIT) · <a href="https://navigatorslab.com" target="_blank" rel="noreferrer">by NavigatorsLab</a>
          · <a href="https://navigatorslab.com/tools/" target="_blank" rel="noreferrer">🧭 10 more free tools</a>
        </p>
      </div>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropFile(e);
        }}
      >
        <div className="dz-icon">
          <Icon.file />
        </div>
        <h2>Drop a PDF here</h2>
        <p>…or</p>
        <button className="btn primary big" onClick={onOpen} disabled={busy}>
          <Icon.open /> Choose a PDF file
        </button>
        <button className="btn ghost" onClick={onDemo} disabled={busy}>
          No file handy? Open the demo document →
        </button>
        {saved && onRestore && (
          <button className="btn ghost restore-cta" onClick={onRestore} disabled={busy}>
            <Icon.undo /> Resume “{saved.name}” — saved {new Date(saved.at).toLocaleString()} (on this device)
          </button>
        )}
        <p className="muted small">
          Files never leave this device — no uploads, no attachments kept, no user information collected. Everything runs
          locally in your browser.
        </p>
      </div>
    </div>
  );
}
