import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import type { PDFField } from 'pdf-lib';

/** A form field we can display and fill, in page coordinates (content space, y-up). */
export interface FieldDesc {
  /** fully-qualified field name (unique key) */
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown';
  /** 0-based page index of its first widget */
  pageIndex: number;
  /** widget rect in content points (x, y = bottom-left) */
  rect: { x: number; y: number; w: number; h: number };
  /** current value (text or option) */
  value?: string;
  checked?: boolean;
  /** choices for dropdown/radio */
  options?: string[];
  readOnly?: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

/** Map a pdf-lib widget rect (media/user space) into our visible-box (crop) space. */
function toCropSpace(r: { x: number; y: number; width: number; height: number }, box: Box) {
  return { x: r.x - box.x, y: r.y - box.y, w: r.width, h: r.height };
}

/** Enumerate fillable fields of a PDF. `pageBoxes` is the crop box of each page. */
export function listFields(lib: PDFDocument, pageBoxes: Box[]): FieldDesc[] {
  let fields: PDFField[];
  try {
    fields = lib.getForm().getFields();
  } catch {
    return [];
  }
  const out: FieldDesc[] = [];
  for (const f of fields) {
    const widgets = (f as unknown as { acroField: { getWidgets(): Array<{ getRectangle(): { x: number; y: number; width: number; height: number }; P(): { tag?: unknown } | undefined }> } }).acroField.getWidgets();
    if (widgets.length === 0) continue;
    const first = widgets[0];
    const rect = first.getRectangle();
    // find which page this widget belongs to via its /P indirect ref
    let pageIndex = 0;
    const pref = first.P();
    if (pref && typeof pref === 'object' && 'tag' in (pref as object)) {
      const idx = lib.getPages().findIndex((pg) => pg.ref === pref);
      if (idx >= 0) pageIndex = idx;
    }
    const box = pageBoxes[Math.min(pageIndex, pageBoxes.length - 1)] ?? { x: 0, y: 0, w: 612, h: 792 };
    const common = {
      name: f.getName(),
      pageIndex,
      rect: toCropSpace(rect, box),
      readOnly: f.isReadOnly(),
    };
    // NOTE: instanceof, not constructor.name — bundlers mangle class names
    if (f instanceof PDFTextField) {
      out.push({ ...common, kind: 'text', value: f.getText() ?? '' });
    } else if (f instanceof PDFCheckBox) {
      out.push({ ...common, kind: 'checkbox', checked: f.isChecked() });
    } else if (f instanceof PDFRadioGroup) {
      out.push({ ...common, kind: 'radio', value: f.getSelected(), options: f.getOptions() });
    } else if (f instanceof PDFDropdown) {
      out.push({ ...common, kind: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions() });
    }
    // PDFOptionList and signatures are left untouched on purpose.
  }
  return out;
}

/** Apply a map of {fieldName: value} to the form. Values are validated per kind. */
export function applyFieldValues(lib: PDFDocument, values: Record<string, string | boolean>): { applied: number; errors: string[] } {
  const errors: string[] = [];
  let applied = 0;
  const form = lib.getForm();
  for (const f of form.getFields()) {
    const name = f.getName();
    if (!(name in values)) continue;
    try {
      if (f instanceof PDFTextField) {
        f.setText(String(values[name] ?? ''));
        applied++;
      } else if (f instanceof PDFCheckBox) {
        if (values[name]) f.check();
        else f.uncheck();
        applied++;
      } else if (f instanceof PDFRadioGroup) {
        f.select(String(values[name]));
        applied++;
      } else if (f instanceof PDFDropdown) {
        f.select(String(values[name]));
        applied++;
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { applied, errors };
}

/** Convenience: re-read all fields after apply. */
export function rereadFields(lib: PDFDocument, pageBoxes: Box[]): FieldDesc[] {
  return listFields(lib, pageBoxes);
}
