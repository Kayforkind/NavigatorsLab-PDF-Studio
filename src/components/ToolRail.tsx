import type { ComponentType, SVGProps } from 'react';
import type { ToolId } from '../types';
import { Icon } from './icons';

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', label: 'Select & move', hint: 'Click to select, drag to move, corner to resize', icon: Icon.select },
    { id: 'edit', label: 'Edit text', hint: 'Click existing text on the page to rewrite it', icon: Icon.edit },
    { id: 'text', label: 'Add text', hint: 'Click the page and type', icon: Icon.text },
  ],
  [
    { id: 'highlight', label: 'Highlight', hint: 'Drag a box over text', icon: Icon.highlight },
    { id: 'underline', label: 'Underline', hint: 'Drag over text to underline it', icon: Icon.underline },
    { id: 'strike', label: 'Strikethrough', hint: 'Drag over text to strike it out', icon: Icon.strike },
    { id: 'note', label: 'Sticky note', hint: 'Click to drop a note marker', icon: Icon.note },
  ],
  [
    { id: 'ink', label: 'Pen / draw', hint: 'Freehand drawing', icon: Icon.ink },
    { id: 'sign', label: 'Signature', hint: 'Draw a signature and stamp it on the page', icon: Icon.sign },
    { id: 'image', label: 'Image stamp', hint: 'Place a PNG / JPG / logo on the page', icon: Icon.image },
  ],
  [
    { id: 'redact', label: 'Redact', hint: 'Permanently black out content', icon: Icon.redact },
    { id: 'whiteout', label: 'Whiteout', hint: 'Cover content with the page background', icon: Icon.whiteout },
  ],
];

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
              title={t.label}
              data-hint={t.hint}
            >
              <t.icon />
              <span className="tool-name">{t.label}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
