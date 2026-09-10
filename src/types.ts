/** Core domain types for PDF Studio. All annotation/page geometry is stored in
 *  PDF user-space points of the *source* page's content stream (y-up, origin
 *  bottom-left), so it maps 1:1 onto pdf-lib drawing coordinates at export. */

export type ToolId =
  | 'select'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'ink'
  | 'text'
  | 'edit'
  | 'note'
  | 'sign'
  | 'image'
  | 'redact'
  | 'whiteout'
  | 'arrow'
  | 'rect'
  | 'ellipse';

export interface Point {
  x: number;
  y: number;
}

export interface PageInfo {
  /** width / height of the visible page box (CropBox), in PDF points */
  w: number;
  h: number;
  /** origin of the visible box in user space (usually 0,0 — not always!) */
  bx: number;
  by: number;
  /** intrinsic /Rotate of the source page (0/90/180/270) */
  rot: number;
}

/** A PDF file that was opened or merged in. `bytes` is the original file data. */
export interface Source {
  id: string;
  name: string;
  bytes: Uint8Array;
  /** one entry per page in the source file */
  pages: PageInfo[];
}

/** One page of the working document (may reference a source page or be blank). */
export interface PageRec {
  id: string;
  /** source id, or null for inserted blank pages */
  src: string | null;
  /** zero-based page index within the source, or null for blanks */
  page: number | null;
  w: number;
  h: number;
  /** origin of the visible page box in user space */
  bx: number;
  by: number;
  /** mirror bits: 1 = flip horizontally, 2 = flip vertically (0 = none) */
  flip?: number;
  /** additional clockwise rotation in degrees (0/90/180/270) applied by the user */
  rot: number;
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

interface AnnCommon {
  id: string;
  pageId: string;
}

export interface RectAnn extends AnnCommon {
  type: 'highlight' | 'underline' | 'strike' | 'redact' | 'whiteout';
  x: number;
  y: number;
  w: number;
  h: number;
  /** css hex color, e.g. '#ffd400' */
  color: string;
  opacity: number;
}

export interface InkAnn extends AnnCommon {
  type: 'ink';
  pts: Point[];
  color: string;
  width: number;
  opacity: number;
}

export interface TextAnn extends AnnCommon {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  /** optional per-annotation font family (Helvetica | Times | Courier) */
  font?: string;
}

/** Replaces original page text: a background-colored cover rect + new text. */
export interface EditAnn extends AnnCommon {
  type: 'edit';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** original font size we estimate from the source */
  size: number;
  color: string;
  /** sampled page background used to cover the original glyphs */
  bg: string;
  /** original line text this edit replaced — when present, export DELETES
   *  the original glyphs from the content stream (true edit, not overlay) */
  origText?: string;
  /** optional per-annotation font family (Helvetica | Times | Courier) */
  font?: string;
  /** true when this edit replaces ONE CELL of a wider table row — the deep
   *  rewrite only touches that cell's substring, leaving neighbors untouched */
  cell?: boolean;
  /** horizontal gap (points) between the previous cell and this one — lets
   *  the deep rewrite replicate the original spacing exactly */
  gapBefore?: number;
}

export interface NoteAnn extends AnnCommon {
  type: 'note';
  x: number;
  y: number;
  /** side length in points (resizable) — older docs fall back to 16 */
  w?: number;
  h?: number;
  text: string;
  color: string;
  /** 1-based marker number */
  n: number;
}

export interface ImageAnn extends AnnCommon {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG data URL */
  dataUrl: string;
  label: string;
  /** mirror the stamp within its own rect */
  flipH?: boolean;
  flipV?: boolean;
}

/** Straight pointer arrow from (x1,y1) to (x2,y2) with an arrowhead at the end. */
export interface ArrowAnn extends AnnCommon {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
}

/** Outlined shape: rectangle or ellipse (stroke = color, optional translucent fill). */
export interface ShapeAnn extends AnnCommon {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  opacity: number;
  /** optional fill color hex; null = outline only */
  fill?: string | null;
}

export type Annotation =
  | RectAnn
  | InkAnn
  | TextAnn
  | EditAnn
  | NoteAnn
  | ImageAnn
  | ArrowAnn
  | ShapeAnn;

/* ------------------------------------------------------------------ */
/* Document model                                                      */
/* ------------------------------------------------------------------ */

export interface DocState {
  name: string;
  sources: Source[];
  /** ordered working pages */
  pages: PageRec[];
  anns: Annotation[];
  /** non-undoable document preferences (currently the default text font family) */
  settings?: { font?: string };
}

export interface DocModel {
  doc: DocState;
  past: Array<{ pages: PageRec[]; anns: Annotation[] }>;
  future: Array<{ pages: PageRec[]; anns: Annotation[] }>;
}

export type Action =
  | { type: 'open'; name: string; sources: Source[]; pages: PageRec[]; anns?: Annotation[] }
  | { type: 'merge'; sources: Source[]; pages: PageRec[]; afterPageId: string | null }
  | { type: 'reorder'; fromId: string; toId: string }
  | { type: 'rotate'; pageId: string; cw: boolean }
  | { type: 'flipPage'; pageId: string; mode: 'h' | 'v' }
  | { type: 'setPageRots'; rots: Record<string, number> }
  | { type: 'deletePage'; pageId: string }
  | { type: 'duplicatePage'; pageId: string }
  | { type: 'insertBlank'; afterPageId: string | null; w: number; h: number }
  | { type: 'annAdd'; ann: Annotation }
  | { type: 'annUpd'; id: string; patch: Partial<Annotation> }
  | { type: 'annDel'; id: string }
  | { type: 'undo' }
  | { type: 'redo' };

/* UI settings that are not part of undoable history */
export interface ToolSettings {
  color: string;
  width: number; // ink / line thickness in points
  fontSize: number; // text stamp size in points
  opacity: number;
  /** standard font family for text stamps (export uses the matching built-in) */
  font?: string;
}

export interface TextHit {
  /** whole clickable "line" string */
  text: string;
  /** content-space rect (PDF points) covering the line's glyphs */
  x: number;
  y: number;
  w: number;
  h: number;
  /** estimated font size (points) */
  size: number;
  /** typical color of the text (css hex) */
  color: string;
  /** true when this hit is one cell of a wider table row */
  cell?: boolean;
  /** horizontal gap (points) from the previous cell — the deep rewrite
   *  keeps the original spacing by re-emitting it as TJ kerning */
  gapBefore?: number;
}

export const BLANK_SIZES = {
  Letter: { w: 612, h: 792 },
  A4: { w: 595.28, h: 841.89 },
  Legal: { w: 612, h: 1008 },
} as const;

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}
