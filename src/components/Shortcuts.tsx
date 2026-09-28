/** Shared keyboard-shortcut cheatsheet: shown in the in-app Help modal and on the landing page. */
export function ShortcutCheatsheet() {
  return (
    <ul className="shortcut-list">
      <li><kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Ctrl/⌘ Y</kbd> or <kbd>Ctrl/⌘⇧Z</kbd> redo</li>
      <li><kbd>Ctrl/⌘ O</kbd> open · <kbd>Ctrl/⌘ S</kbd> save a copy · <kbd>Ctrl/⌘ P</kbd> print</li>
      <li><kbd>Del</kbd> delete the selected mark · <kbd>Esc</kbd> cancel / deselect</li>
      <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>0</kbd> reset zoom to 100%</li>
      <li>
        Tools: <kbd>V</kbd> select · <kbd>E</kbd> edit · <kbd>T</kbd> text · <kbd>H</kbd> highlight ·{' '}
        <kbd>U</kbd> underline · <kbd>X</kbd> strike · <kbd>N</kbd> note · <kbd>D</kbd> pen ·{' '}
        <kbd>A</kbd> arrow · <kbd>R</kbd> rect · <kbd>O</kbd> ellipse · <kbd>G</kbd> sign ·{' '}
        <kbd>I</kbd> image · <kbd>F</kbd> text field · <kbd>C</kbd> checkbox · <kbd>B</kbd> redact ·{' '}
        <kbd>W</kbd> whiteout
      </li>
    </ul>
  );
}
