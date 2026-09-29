import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolId } from '../types';
import { Icon } from './icons';

interface ToolDef {
  id: ToolId;
  /** i18n key prefix under `tools`, e.g. "select" -> tools.select.label */
  key: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** single-key keyboard shortcut shown in the tooltip */
  shortcut?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', key: 'select', icon: Icon.select, shortcut: 'V' },
    { id: 'edit', key: 'edit', icon: Icon.edit, shortcut: 'E' },
    { id: 'text', key: 'text', icon: Icon.text, shortcut: 'T' },
  ],
  [
    { id: 'highlight', key: 'highlight', icon: Icon.highlight, shortcut: 'H' },
    { id: 'underline', key: 'underline', icon: Icon.underline, shortcut: 'U' },
    { id: 'strike', key: 'strike', icon: Icon.strike, shortcut: 'X' },
    { id: 'note', key: 'note', icon: Icon.note, shortcut: 'N' },
  ],
  [
    { id: 'ink', key: 'ink', icon: Icon.ink, shortcut: 'D' },
    { id: 'arrow', key: 'arrow', icon: Icon.arrow, shortcut: 'A' },
    { id: 'rect', key: 'rect', icon: Icon.rect, shortcut: 'R' },
    { id: 'ellipse', key: 'ellipse', icon: Icon.ellipse, shortcut: 'O' },
    { id: 'sign', key: 'sign', icon: Icon.sign, shortcut: 'G' },
    { id: 'image', key: 'image', icon: Icon.image, shortcut: 'I' },
  ],
  [
    { id: 'formtext', key: 'formtext', icon: Icon.formtext, shortcut: 'F' },
    { id: 'formcheck', key: 'formcheck', icon: Icon.formcheck, shortcut: 'C' },
  ],
  [
    { id: 'redact', key: 'redact', icon: Icon.redact, shortcut: 'B' },
    { id: 'whiteout', key: 'whiteout', icon: Icon.whiteout, shortcut: 'W' },
  ],
];

/** single-key shortcut → tool id, derived from the rail definitions above */
export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  GROUPS.flat().flatMap((t) => (t.shortcut ? [[t.shortcut.toLowerCase(), t.id]] : [])),
);

export function ToolRail({
  tool,
  onTool,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="tool-rail" aria-label={t('tools.railLabel')}>
      {GROUPS.map((group, gi) => (
        <div className="tool-group" key={gi}>
          {group.map((td) => {
            const label = t(`tools.${td.key}.label`);
            const hint = t(`tools.${td.key}.hint`);
            return (
              <button
                key={td.id}
                className={`tool-btn ${tool === td.id ? 'active' : ''}`}
                onClick={() => onTool(td.id)}
                title={td.shortcut ? `${label} (${td.shortcut})` : label}
                data-hint={td.shortcut ? `${hint} — ${t('tools.pressKey', { key: td.shortcut })}` : hint}
              >
                <td.icon />
                <span className="tool-name">{label}</span>
                {td.shortcut && <kbd className="tool-key">{td.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
