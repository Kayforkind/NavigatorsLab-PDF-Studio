import { useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { ShortcutCheatsheet } from './Shortcuts';

/** Staggered entrance: each block fades/rises in with a growing delay. */
const reveal = (ms: number): CSSProperties => ({ '--d': `${ms}ms` }) as CSSProperties;

/** A stylised PDF page where the original text is visibly rewritten.
 *  Pure CSS: the old run is struck through and the replacement is wiped in. */
function ShowcaseCard({ caption }: { caption: string }) {
  return (
    <figure className="showcase reveal" style={reveal(260)}>
      <div className="showcase-page" aria-hidden="true">
        <div className="sp-title">Invoice 2026-041</div>
        <div className="sp-line">
          Bill to:&nbsp;
          <span className="sw-pair">
            <span className="sw-old">Acme Corp</span>
            <span className="sw-new">Globex Inc</span>
          </span>
        </div>
        <div className="sp-line sp-muted">Payment terms: Net 30</div>
        <div className="sp-line sp-muted">Total due: $4,200.00</div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Landing({
  busy,
  onOpen,
  onDemo,
  onImages,
  onDropFile,
  saved,
  onRestore,
  onForget,
}: {
  busy: boolean;
  onOpen: () => void;
  onDemo: () => void;
  onImages: () => void;
  onDropFile: (e: DragEvent) => void;
  saved?: { name: string; at: number } | null;
  onRestore?: () => void;
  onForget?: () => void;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  /* Publish the pointer position (0..1) as CSS variables: drives the spotlight and the showcase tilt. */
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', ((e.clientX - r.left) / r.width).toFixed(3));
    e.currentTarget.style.setProperty('--my', ((e.clientY - r.top) / r.height).toFixed(3));
  };
  const proof = [t('landing.proofUploads'), t('landing.proofAccounts'), t('landing.proofWatermarks'), t('landing.proofLimits')];
  return (
    <div className="landing" onPointerMove={onPointerMove}>
      <div className="cine-bg" aria-hidden="true">
        <span className="spot" />
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
        <span className="grain" />
      </div>

      <div className="landing-hero">
        <p className="eyebrow reveal" style={reveal(0)}>
          {t('landing.eyebrow')}
        </p>
        <h1 className="reveal" style={reveal(70)}>
          {t('landing.title1')}
          <br />
          <span>{t('landing.title2')}</span>
        </h1>
        <p className="landing-sub reveal" style={reveal(140)}>
          {t('landing.sub')}
        </p>
        <ShowcaseCard caption={t('landing.showcaseCaption')} />
        <div className="landing-features reveal" style={reveal(340)}>
          <span><Icon.edit /> {t('landing.featEdit')}</span>
          <span><Icon.highlight /> {t('landing.featAnnotate')}</span>
          <span><Icon.sign /> {t('landing.featSign')}</span>
          <span><Icon.redact /> {t('landing.featRedact')}</span>
          <span><Icon.copy /> {t('landing.featPages')}</span>
          <span><Icon.split /> {t('landing.featMerge')}</span>
        </div>
        <ul className="proof reveal" style={reveal(400)}>
          {proof.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="landing-brand reveal" style={reveal(460)}>
          {t('landing.ossNote')} · <a href="https://navigatorslab.com" target="_blank" rel="noreferrer">{t('landing.byNav')}</a>
          · <a href="https://navigatorslab.com/tools/" target="_blank" rel="noreferrer">{t('landing.toolsLink')}</a>
          · <a href="https://navigatorslab.com/reimagine/" target="_blank" rel="noreferrer">{t('landing.reimagineLink')}</a>
        </p>
      </div>

      <div
        className={`dropzone reveal ${over ? 'over' : ''}`}
        style={reveal(200)}
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
        <h2>{t('landing.dropTitle')}</h2>
        <p>{t('landing.or')}</p>
        <button className="btn primary big" onClick={onOpen} disabled={busy}>
          <Icon.open /> {t('landing.chooseFile')}
        </button>
        <button className="btn ghost" onClick={onDemo} disabled={busy}>
          {t('landing.demo')}
        </button>
        <button className="btn ghost" onClick={onImages} disabled={busy}>
          <Icon.image /> {t('landing.fromImages')}
        </button>
        {saved && onRestore && (
          <button className="btn ghost restore-cta" onClick={onRestore} disabled={busy}>
            <Icon.undo /> {t('landing.resume', { name: saved.name, date: new Date(saved.at).toLocaleString() })}
          </button>
        )}
        {saved && onForget && (
          <button className="btn ghost danger" onClick={onForget} disabled={busy} title={t('landing.forgetTitle')}>
            <Icon.trash /> {t('landing.forget')}
          </button>
        )}
        <p className="muted small">{t('landing.privacyNote')}</p>
      </div>

      <div className="landing-shortcuts reveal" style={reveal(320)}>
        <h2>{t('landing.shortcuts')}</h2>
        <ShortcutCheatsheet />
      </div>
    </div>
  );
}
