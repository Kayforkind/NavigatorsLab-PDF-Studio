import { useTranslation } from 'react-i18next';

/** Shared keyboard-shortcut cheatsheet: shown in the in-app Help modal and on the landing page. */
export function ShortcutCheatsheet() {
  const { t } = useTranslation();
  return (
    <ul className="shortcut-list">
      <li><kbd>Ctrl/⌘ Z</kbd> {t('shortcuts.undo')} · <kbd>Ctrl/⌘ Y</kbd> {t('shortcuts.or')} <kbd>Ctrl/⌘⇧Z</kbd> {t('shortcuts.redo')}</li>
      <li><kbd>Ctrl/⌘ O</kbd> {t('shortcuts.open')} · <kbd>Ctrl/⌘ S</kbd> {t('shortcuts.saveCopy')} · <kbd>Ctrl/⌘ P</kbd> {t('shortcuts.print')}</li>
      <li><kbd>Del</kbd> {t('shortcuts.deleteMark')} · <kbd>Esc</kbd> {t('shortcuts.cancelDeselect')}</li>
      <li><kbd>+</kbd> / <kbd>−</kbd> {t('shortcuts.zoom')} · <kbd>0</kbd> {t('shortcuts.resetZoom')}</li>
      <li>
        {t('shortcuts.tools')}: <kbd>V</kbd> {t('shortcuts.toolSelect')} · <kbd>E</kbd> {t('shortcuts.toolEdit')} ·{' '}
        <kbd>T</kbd> {t('shortcuts.toolText')} · <kbd>H</kbd> {t('shortcuts.toolHighlight')} ·{' '}
        <kbd>U</kbd> {t('shortcuts.toolUnderline')} · <kbd>X</kbd> {t('shortcuts.toolStrike')} ·{' '}
        <kbd>N</kbd> {t('shortcuts.toolNote')} · <kbd>D</kbd> {t('shortcuts.toolPen')} ·{' '}
        <kbd>A</kbd> {t('shortcuts.toolArrow')} · <kbd>R</kbd> {t('shortcuts.toolRect')} ·{' '}
        <kbd>O</kbd> {t('shortcuts.toolEllipse')} · <kbd>G</kbd> {t('shortcuts.toolSign')} ·{' '}
        <kbd>I</kbd> {t('shortcuts.toolImage')} · <kbd>F</kbd> {t('shortcuts.toolField')} ·{' '}
        <kbd>C</kbd> {t('shortcuts.toolCheckbox')} · <kbd>B</kbd> {t('shortcuts.toolRedact')} ·{' '}
        <kbd>W</kbd> {t('shortcuts.toolWhiteout')}
      </li>
    </ul>
  );
}
