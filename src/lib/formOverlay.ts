import { PDFDocument } from 'pdf-lib';
import type { Source } from '../types';
import { listFields, type FieldDesc } from './forms';

const cache = new Map<string, FieldDesc[]>();

/** Fields per source id (cached — AcroForm parsing is expensive per open). */
export async function fieldsForSource(source: Source): Promise<FieldDesc[]> {
  const hit = cache.get(source.id);
  if (hit) return hit;
  try {
    const lib = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    const boxes = source.pages.map((p) => ({ x: p.bx ?? 0, y: p.by ?? 0, w: p.w, h: p.h }));
    const fields = listFields(lib, boxes);
    cache.set(source.id, fields);
    return fields;
  } catch {
    cache.set(source.id, []);
    return [];
  }
}

export function clearFieldCache() {
  cache.clear();
}
