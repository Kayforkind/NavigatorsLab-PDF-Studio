import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { ShortcutCheatsheet } from './Shortcuts';

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
  return (
    <div className="landing">
      <div className="landing-hero">
        <h1>
          {t('landing.title1')}
          <br />
          <span>{t('landing.title2')}</span>
        </h1>
        <p className="landing-sub">{t('landing.sub')}</p>
        <div className="landing-features">
          <span><Icon.edit /> {t('landing.featEdit')}</span>
          <span><Icon.highlight /> {t('landing.featAnnotate')}</span>
          <span><Icon.sign /> {t('landing.featSign')}</span>
          <span><Icon.redact /> {t('landing.featRedact')}</span>
          <span><Icon.copy /> {t('landing.featPages')}</span>
          <span><Icon.split /> {t('landing.featMerge')}</span>
        </div>
        <p className="landing-brand">
          {t('landing.ossNote')} · <a href="https://navigatorslab.com" target="_blank" rel="noreferrer">{t('landing.byNav')}</a>
          · <a href="https://navigatorslab.com/tools/" target="_blank" rel="noreferrer">{t('landing.toolsLink')}</a>
          · <a href="https://navigatorslab.com/reimagine/" target="_blank" rel="noreferrer">{t('landing.reimagineLink')}</a>
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

      <div className="landing-shortcuts">
        <h2>{t('landing.shortcuts')}</h2>
        <ShortcutCheatsheet />
      </div>
    </div>
  );
}
