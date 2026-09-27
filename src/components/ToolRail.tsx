import type { ComponentType, SVGProps } from 'react';
import type { ToolId } from '../types';
import { Icon } from './icons';

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** single-key keyboard shortcut shown in the tooltip */
  key?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', label: 'Select & move', hint: 'Click to select, drag to move, corner to resize', icon: Icon.select, key: 'V' },
    { id: 'edit', label: 'Edit text', hint: 'Click existing text on the page to rewrite it', icon: Icon.edit, key: 'E' },
    { id: 'text', label: 'Add text', hint: 'Click the page and type', icon: Icon.text, key: 'T' },
  ],
  [
    { id: 'highlight', label: 'Highlight', hint: 'Drag a box over text', icon: Icon.highlight, key: 'H' },
    { id: 'underline', label: 'Underline', hint: 'Drag over text to underline it', icon: Icon.underline, key: 'U' },
    { id: 'strike', label: 'Strikethrough', hint: 'Drag over text to strike it out', icon: Icon.strike, key: 'X' },
    { id: 'note', label: 'Sticky note', hint: 'Click to drop a note marker', icon: Icon.note, key: 'N' },
  ],
  [
    { id: 'ink', label: 'Pen / draw', hint: 'Freehand drawing', icon: Icon.ink, key: 'D' },
    { id: 'arrow', label: 'Arrow / pointer', hint: 'Drag to point at something — arrowhead at the far end', icon: Icon.arrow, key: 'A' },
    { id: 'rect', label: 'Rectangle', hint: 'Outlined box — great for circling regions of interest', icon: Icon.rect, key: 'R' },
    { id: 'ellipse', label: 'Ellipse', hint: 'Outlined ellipse — circle content in style', icon: Icon.ellipse, key: 'O' },
    { id: 'sign', label: 'Signature', hint: 'Draw a signature and stamp it on the page', icon: Icon.sign, key: 'G' },
    { id: 'image', label: 'Image stamp', hint: 'Place a PNG / JPG / logo on the page', icon: Icon.image, key: 'I' },
  ],
  [
    { id: 'formtext', label: 'Text field', hint: 'Drag a box to place a fillable text field (real AcroForm)', icon: Icon.formtext, key: 'F' },
    { id: 'formcheck', label: 'Checkbox', hint: 'Drag a box to place a fillable checkbox (real AcroForm)', icon: Icon.formcheck, key: 'C' },
  ],
  [
    { id: 'redact', label: 'Redact', hint: 'Permanently black out content', icon: Icon.redact, key: 'B' },
    { id: 'whiteout', label: 'Whiteout', hint: 'Cover content with the page background', icon: Icon.whiteout, key: 'W' },
  ],
];

/** single-key shortcut → tool id, derived from the rail definitions above */
export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  GROUPS.flat().flatMap((t) => (t.key ? [[t.key.toLowerCase(), t.id]] : [])),
);

export function ToolRail({
  tool,
  onTool,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
}) {
  return (
    <aside className="tool-rail" aria-label="Tools">
      {GROUPS.map((group, gi) => (
        <div className="tool-group" key={gi}>
          {group.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? 'active' : ''}`}
              onClick={() => onTool(t.id)}
              title={t.key ? `${t.label} (${t.key})` : t.label}
              data-hint={t.key ? `${t.hint} — press ${t.key}` : t.hint}
            >
              <t.icon />
              <span className="tool-name">{t.label}</span>
              {t.key && <kbd className="tool-key">{t.key}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
