import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, PageRec, Point, RectAnn, TextHit, ToolId, ToolSettings } from '../types';
import { uid } from '../types';  import {
  beginRender,
  clientToContent,
  contentToCss,
  groupIntoLines,
  makeViewport,
  pageTextItems,
  type ViewportLike,
} from '../lib/pdfio';
import { cssHexToRgb } from '../lib/exportPdf';

export interface SheetProps {
  page: PageRec;
  index: number;
  proxy: PDFDocumentProxy | null;
  /** css px per pdf point */
  scale: number;
  /** total display rotation: intrinsic /Rotate + user rotation (0/90/180/270) */
  rotation: number;
  anns: Annotation[];
  /** search matches to glow on this page */
  searchHits?: Array<{ x: number; y: number; w: number; h: number }>;
  /** AcroForm widgets to outline on this page (content-space rects) */
  formFields?: Array<{ name: string; kind: string; rect: { x: number; y: number; w: number; h: number }; filled: boolean; focused: boolean }>;
  onFormFieldClick?: (name: string) => void;
  tool: ToolId;
  settings: ToolSettings;
  selectedId: string | null;
  isCurrent: boolean;
  onSetCurrent: (id: string) => void;
  onSelect: (id: string | null) => void;
  onAdd: (ann: Annotation) => void;
  onUpd: (id: string, patch: Partial<Annotation>) => void;
  onDel: (id: string) => void;
  getNextNoteN: () => number;
  onPlaceSpecial: (kind: 'sign' | 'image', pt: Point, pageId: string) => void;
}

function rectOf(a: Point, b: Point) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

type ContentRect = { x: number; y: number; w: number; h: number };

/** content-space bounding rect of an annotation (null when degenerate) */
function annRect(a: Annotation): ContentRect | null {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strike':
    case 'redact':
    case 'whiteout':
    case 'edit':
    case 'image':
      return a;
    case 'text':
      return { x: a.x, y: a.y - a.size * 0.25, w: 0, h: a.size };
    case 'note':
      return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
    case 'arrow': {
      const x0 = Math.min(a.x1, a.x2);
      const y0 = Math.min(a.y1, a.y2);
      return { x: x0, y: y0, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    }
    case 'rect':
    case 'ellipse':
      return a;
    case 'ink': {
      if (a.pts.length < 2) return null;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of a.pts) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      if (x1 - x0 < 0.001 && y1 - y0 < 0.001) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
}

function isLineTool(t: ToolId) {
  return t === 'underline' || t === 'strike';
}

function isArrowTool(t: ToolId) {
  return t === 'arrow';
}

/** average rgb sampled along a horizontal scan inside the rendered canvas (css coords) */
function sampleBackground(canvas: HTMLCanvasElement, cssX: number, cssY: number, cssW: number, dpr: number): string {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#ffffff';
    const k = dpr;
    const py = Math.min(canvas.height - 2, Math.max(1, Math.floor(cssY * k)));
    let r = 0;
    let g = 0;
    let b = 0;
    let ok = 0;
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const px = Math.min(canvas.width - 2, Math.max(0, Math.floor((cssX + (cssW * i) / n) * k)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      r += d[0];
      g += d[1];
      b += d[2];
      ok++;
    }
    const toHex = (v: number) => Math.round(v / ok).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } catch {
    return '#ffffff';
  }
}

const RECT_TOOLS = new Set<ToolId>(['highlight', 'underline', 'strike', 'redact', 'whiteout', 'rect', 'ellipse']);

interface GestureState {
  kind: 'rect' | 'ink' | 'move' | 'resize';
  tool?: ToolId;
  /* rect tools */
  a?: Point;
  b?: Point;
  /* ink */
  pts?: Point[];
  /* move / resize */
  annId?: string;
  start?: Point;
  /** content-space offset between the pointer and the ann anchor at grab time */
  off?: Point;
  /** snapshot of the ann's content rect at grab time */
  base?: ContentRect | null;
  /** running content-space delta */
  dx?: number;
  dy?: number;
}

interface InlineState {
  mode: 'new-text' | 'new-edit' | 'edit-text' | 'note';
  pt: Point;
  size: number;
  hit?: TextHit;
  bg?: string;
  annId?: string;
  initial: string;
  color?: string;
}

const NOTE_SIZE = 16; // content points

export const PageSheet = memo(function PageSheet(props: SheetProps) {
  const { page, proxy, scale, settings, rotation } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssVpRef = useRef<ViewportLike | null>(null);
  const genRef = useRef(0);
  const taskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);
  const hitsCache = useRef<Map<string, TextHit[]>>(new Map());

  const [cssDims, setCssDims] = useState({ w: 0, h: 0 });
  const [hits, setHits] = useState<TextHit[] | null>(null);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const [inline, setInline] = useState<InlineState | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [loaded, setLoaded] = useState(false); // canvas painted

  const dpr = window.devicePixelRatio || 1;
  const isBlank = page.src === null;

  /* ---------- viewport & page-box geometry (pure math, no page object) ---------- */
  const cssVp: ViewportLike = useMemo(
    () => makeViewport({ x: page.bx, y: page.by, w: page.w, h: page.h }, scale, isBlank ? 0 : rotation, isBlank ? 0 : (page.flip ?? 0)),
    [page.bx, page.by, page.w, page.h, scale, rotation, isBlank, page.flip],
  );

  useEffect(() => {
    cssVpRef.current = cssVp;
    setCssDims({ w: cssVp.width, h: cssVp.height });
  }, [cssVp]);

  /* ---------- pdf.js canvas render ---------- */
  useEffect(() => {
    if (isBlank || !proxy || page.page === null) {
      setLoaded(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gen = ++genRef.current;
    const pg = page.page;
    let alive = true;
    void (async () => {
      try {
        // Serialize renders per canvas: pdf.js throws if a second render starts
        // on a canvas while a previous task is still drawing (StrictMode
        // double-mounts effects, and zoom changes restart renders quickly).
        const prev = taskRef.current;
        if (prev) {
          try {
            await prev.cancel();
          } catch {
            /* already finished */
          }
          taskRef.current = null;
        }
        if (!alive || gen !== genRef.current) return;
        const pp = await proxy.getPage(pg + 1);
        if (!alive || gen !== genRef.current) return;
        const task = beginRender(canvas, pp, { scale, dpr, rotation, flip: isBlank ? 0 : (page.flip ?? 0) });
        taskRef.current = task;
        await task.promise;
        if (taskRef.current === task) taskRef.current = null;
        if (!alive || gen !== genRef.current) return;
        setLoaded(true);
        setCssDims({ w: cssVp.width, h: cssVp.height });
      } catch (err) {
        if (alive) console.error('PageSheet render failed for page', pg + 1, err);
      }
    })();
    return () => {
      alive = false;
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBlank, proxy, page.page, page.id, scale, dpr, rotation, page.flip, cssVp.width, cssVp.height]);

  /* ---------- text hits when "edit existing text" tool active ---------- */
  useEffect(() => {
    if (props.tool !== 'edit' || isBlank || !proxy || page.page === null) return;
    const cached = hitsCache.current.get(page.id);
    if (cached) {
      setHits(cached);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const pp = await proxy.getPage(page.page as number);
        const items = await pageTextItems(pp);
        const lines = groupIntoLines(items);
        hitsCache.current.set(page.id, lines);
        if (alive) setHits(lines);
      } catch {
        /* noop */
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.tool, isBlank, proxy, page.page, page.id]);

  /* ---------- css-space geometry of annotations ---------- */
  const geom = useMemo(() => {
    const out: Array<{ ann: Annotation; r: ContentRect | null; css: { x: number; y: number; w: number; h: number } | null }> = [];
    for (const ann of props.anns) {
      const r = annRect(ann);
      if (!r) {
        out.push({ ann, r, css: null });
        continue;
      }
      const tl = contentToCss(cssVp, { x: r.x, y: r.y });
      const br = contentToCss(cssVp, { x: r.x + r.w, y: r.y + r.h });
      out.push({
        ann,
        r,
        css: { x: Math.min(tl.x, br.x), y: Math.min(tl.y, br.y), w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y) },
      });
    }
    return out;
  }, [props.anns, cssVp]);

  const toCss = useCallback((p: Point) => contentToCss(cssVpRef.current ?? cssVp, p), [cssVp]);

  const contentAt = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = wrapRef.current;
      if (!el) return null;
      return clientToContent(cssVpRef.current ?? cssVp, el.getBoundingClientRect(), e.clientX, e.clientY);
    },
    [cssVp],
  );

  const hitTest = useCallback(
    (pt: Point): { ann: Annotation; entry: (typeof geom)[number] } | null => {
      const cssPt = toCss(pt);
      for (let i = geom.length - 1; i >= 0; i--) {
        const entry = geom[i];
        if (!entry.css) continue;
        const { x, y, w, h } = entry.css;
        const pad = 5;
        const hoverW = Math.max(w, 14);
        const hoverH = Math.max(h, 14);
        if (cssPt.x >= x - pad && cssPt.x <= x + hoverW + pad && cssPt.y >= y - pad && cssPt.y <= y + hoverH + pad) {
          return { ann: entry.ann, entry };
        }
      }
      return null;
    },
    [geom, toCss],
  );

  /* ================= pointer interactions ================= */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const pt = contentAt(e);
      if (!pt) return;
      props.onSetCurrent(page.id);
      try {
        wrapRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* pointer may be synthetic */
      }

      const tool = props.tool;
      if (tool === 'select') {
      const hit = hitTest(pt);
      if (!hit) {
        props.onSelect(null);
        return;
      }
        props.onSelect(hit.ann.id);
        const { ann, entry } = hit;
        const rect = entry.r;
        // resize handle on bottom-right corner (content space)
        if (rect && rect.w > 3 && !(ann.type === 'ink' || ann.type === 'note' || ann.type === 'text')) {
          const corner = toCss({ x: rect.x + rect.w, y: rect.y + rect.h });
          const cssPt = toCss(pt);
          if (Math.abs(cssPt.x - corner.x) <= 11 && Math.abs(cssPt.y - corner.y) <= 11) {
            setGesture({ kind: 'resize', annId: ann.id, start: pt, off: { x: 0, y: 0 }, base: rect, dx: 0, dy: 0 });
            return;
          }
        }
        setGesture({ kind: 'move', annId: ann.id, start: pt, off: { x: pt.x - rect!.x, y: pt.y - rect!.y }, base: rect, dx: 0, dy: 0 });
        return;
      }

      if (tool === 'sign' || tool === 'image') {
        props.onPlaceSpecial(tool, pt, page.id);
        return;
      }
      if (RECT_TOOLS.has(tool)) {
        setGesture({ kind: 'rect', a: pt, b: pt, tool });
        return;
      }
      if (tool === 'arrow') {
        setGesture({ kind: 'rect', a: pt, b: pt, tool });
        return;
      }
      if (tool === 'ink') {
        setGesture({ kind: 'ink', pts: [pt], tool });
        return;
      }

      if (tool === 'text' || tool === 'edit') {
        const own = hitTest(pt);
        if (own && (own.ann.type === 'text' || own.ann.type === 'edit')) {
          props.onSelect(own.ann.id);
          setInline({
            mode: 'edit-text',
            pt: { x: own.ann.x, y: own.ann.y },
            size: own.ann.type === 'text' ? own.ann.size : own.ann.size,
            annId: own.ann.id,
            initial: own.ann.type === 'text' ? own.ann.text : own.ann.text,
          });
          setInlineText(own.ann.type === 'text' ? own.ann.text : own.ann.text);
          return;
        }
        if (tool === 'text') {
          setInline({ mode: 'new-text', pt, size: settings.fontSize, color: settings.color, initial: '' });
          setInlineText('');
          return;
        }
        // tool === 'edit' and we did not click our own annotation
        if (!hits || hits.length === 0) return;
        const cssPt = toCss(pt);
        const hit = hits.find((h) => {
          const tl = toCss({ x: h.x, y: h.y });
          return cssPt.x >= tl.x && cssPt.x <= tl.x + h.w * scale && cssPt.y >= tl.y && cssPt.y <= tl.y + h.h * scale;
        });
        if (!hit) return;
        const canvas = canvasRef.current;
        const tl = toCss({ x: hit.x, y: hit.y });
        const bg = canvas
          ? sampleBackground(canvas, tl.x + 4, tl.y + Math.max(3, hit.h * scale - 8), Math.max(6, hit.w * scale - 8), dpr)
          : '#ffffff';
        setInline({ mode: 'new-edit', pt: { x: hit.x, y: hit.y }, size: hit.size, hit, bg, initial: hit.text });
        setInlineText(hit.text);
        return;
      }

      if (tool === 'note') {
        const n = props.getNextNoteN();
        const ann: Annotation = {
          id: uid(),
          pageId: page.id,
          type: 'note',
          x: pt.x,
          y: pt.y,
          text: '',
          color: '#ffd43b',
          n,
        };
        props.onAdd(ann);
        props.onSelect(ann.id);
        setInline({ mode: 'note', pt, size: 13, annId: ann.id, initial: '' });
        setInlineText('');
      }
    },
    [contentAt, hitTest, toCss, hits, scale, dpr, settings, props, page.id],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!gesture) return;
      const pt = contentAt(e);
      if (!pt) return;
      if (gesture.kind === 'rect' && gesture.a) {
        setGesture({ kind: 'rect', a: gesture.a, b: pt });
      } else if (gesture.kind === 'ink' && gesture.pts) {
        const last = gesture.pts[gesture.pts.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.35) {
          setGesture({ kind: 'ink', pts: [...gesture.pts, pt] });
        }
      } else if ((gesture.kind === 'move' || gesture.kind === 'resize') && gesture.start) {
        setGesture({ ...gesture, dx: pt.x - gesture.start.x, dy: pt.y - gesture.start.y });
      }
    },
    [gesture, contentAt],
  );

  const commitGesture = useCallback(() => {
    const g = gesture;
    setGesture(null);
    if (!g) return;
    if (g.kind === 'rect' && g.a && g.b) {
      const t = (g.tool ?? props.tool) as ToolId;
      if (t === 'arrow') {
        // an arrow is a segment, not an area: commit even for tiny drags
        const dist = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
        if (dist < 3) return;
        props.onAdd({ id: uid(), pageId: page.id, type: 'arrow', x1: g.a.x, y1: g.a.y, x2: g.b.x, y2: g.b.y, color: settings.color, width: settings.width, opacity: Math.min(1, 0.45 + settings.opacity) } as Annotation);
        return;
      }
      const r = rectOf(g.a, g.b);
      if (r.w < 1.5 || r.h < 1.5) return;
      if (t === 'highlight') {
        props.onAdd({ id: uid(), pageId: page.id, type: t, ...r, color: settings.color, opacity: settings.opacity } as Annotation);
      } else if (t === 'underline' || t === 'strike') {
        props.onAdd({ id: uid(), pageId: page.id, type: t, ...r, color: settings.color, opacity: settings.opacity } as Annotation);
      } else if (t === 'redact') {
        props.onAdd({ id: uid(), pageId: page.id, type: t, ...r, color: '#101014', opacity: 1 } as Annotation);
      } else if (t === 'rect' || t === 'ellipse') {
        props.onAdd({ id: uid(), pageId: page.id, type: t, ...r, color: settings.color, width: settings.width, opacity: Math.min(1, 0.35 + settings.opacity), fill: null } as Annotation);
      } else if (t === 'whiteout') {
        // paint with the page background sampled from inside the drawn box
        const canvas = canvasRef.current;
        const cssA = toCss({ x: r.x, y: r.y });
        const sampled = canvas
          ? sampleBackground(canvas, cssA.x + 3, cssA.y + 3, Math.max(1, Math.abs(r.w * scale) - 10), window.devicePixelRatio || 1)
          : '#ffffff';
        props.onAdd({ id: uid(), pageId: page.id, type: t, ...r, color: sampled, opacity: 1 } as Annotation);
      }
      return;
    }
    if (g.kind === 'ink' && g.pts && g.pts.length > 1) {
      props.onAdd({
        id: uid(),
        pageId: page.id,
        type: 'ink',
        pts: g.pts,
        color: settings.color,
        width: settings.width,
        opacity: settings.opacity,
      } as Annotation);
      return;
    }
    if (g.kind === 'move' && g.annId) {
      const dx = g.dx ?? 0;
      const dy = g.dy ?? 0;
      if (dx === 0 && dy === 0) return;
      const ann = props.anns.find((a) => a.id === g.annId);
      if (!ann) return;
      if (ann.type === 'ink' && ann.pts) {
        props.onUpd(g.annId, { pts: ann.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) } as Partial<Annotation>);
      } else if (ann.type === 'arrow') {
        props.onUpd(g.annId, { x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy } as Partial<Annotation>);
      } else if ('x' in ann) {
        props.onUpd(g.annId, { x: (ann.x as number) + dx, y: (ann.y as number) + dy } as Partial<Annotation>);
      }
      return;
    }
    if (g.kind === 'resize' && g.annId && g.base) {
      const dx = g.dx ?? 0;
      const dy = g.dy ?? 0;
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return;
      const b = g.base;
      const w = Math.max(2, b.w + dx);
      const h = Math.max(2, b.h + dy);
      const ann = props.anns.find((a) => a.id === g.annId);
      if (ann?.type === 'arrow') {
        // scale the free endpoint inside the resized bounding box
        const nx = b.w > 0.001 ? b.x + ((ann.x2 - b.x) / b.w) * w : b.x;
        const ny = b.h > 0.001 ? b.y + ((ann.y2 - b.y) / b.h) * h : b.y;
        props.onUpd(g.annId, { x2: nx, y2: ny } as Partial<Annotation>);
      } else {
        props.onUpd(g.annId, { x: b.x, y: b.y, w, h } as Partial<Annotation>);
      }
    }
  }, [gesture, props, settings, toCss]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      commitGesture();
      try {
        wrapRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* synthetic or already released */
      }
    },
    [commitGesture],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pt = contentAt(e);
      if (!pt) return;
      const hit = hitTest(pt);
      if (!hit) return;
      const ann = hit.ann;
      if (ann.type === 'text' || ann.type === 'edit' || ann.type === 'note') {
        e.stopPropagation();
        props.onSelect(ann.id);
        setInline({
          mode: 'edit-text',
          pt: { x: ann.x, y: ann.y },
          size: ann.type === 'text' || ann.type === 'edit' ? ann.size : 13,
          annId: ann.id,
          initial: ann.type === 'text' ? ann.text : ann.type === 'edit' ? ann.text : ann.text,
        });
        setInlineText(ann.text);
      }
    },
    [contentAt, hitTest, props],
  );

  const commitInline = useCallback(() => {
    if (!inline) return;
    const text = inlineText;
    if (inline.mode === 'new-text') {
      if (text.trim()) {
        props.onAdd({
          id: uid(),
          pageId: page.id,
          type: 'text',
          x: inline.pt.x,
          y: inline.pt.y,
          text,
          size: inline.size,
          color: inline.color ?? settings.color,
        } as Annotation);
      }
    } else if (inline.mode === 'new-edit' && inline.hit) {
      const h = inline.hit;
      props.onAdd({
        id: uid(),
        pageId: page.id,
        type: 'edit',
        x: h.x,
        y: h.y,
        w: Math.max(2, h.w),
        h: h.h,
        text,
        size: h.size,
        color: '#17171b',
        bg: inline.bg ?? '#ffffff',
      } as Annotation);
    } else if (inline.mode === 'edit-text' && inline.annId) {
      props.onUpd(inline.annId, { text } as Partial<Annotation>);
    } else if (inline.mode === 'note' && inline.annId) {
      props.onUpd(inline.annId, { text } as Partial<Annotation>);
    }
    setInline(null);
    setInlineText('');
  }, [inline, inlineText, props, settings.color, page.id]);

  /* ---------- derived rendering data ---------- */
  const previewInfo = useMemo(() => {
    if (!gesture) return null;
    if (gesture.kind === 'move' && gesture.base && gesture.annId) {
      const b = gesture.base;
      const dx = gesture.dx ?? 0;
      const dy = gesture.dy ?? 0;
      const tl = toCss({ x: b.x + dx, y: b.y + dy });
      return { x: tl.x, y: tl.y, w: b.w * scale, h: b.h * scale };
    }
    if (gesture.kind === 'resize' && gesture.base) {
      const b = gesture.base;
      const dx = gesture.dx ?? 0;
      const dy = gesture.dy ?? 0;
      const w = Math.max(2, b.w + dx);
      const h = Math.max(2, b.h + dy);
      const tl = toCss({ x: b.x, y: b.y });
      return { x: tl.x, y: tl.y, w: w * scale, h: h * scale };
    }
    return null;
  }, [gesture, toCss, scale]);

  const toolType = props.tool as RectAnn['type'] | 'rect' | 'ellipse' | 'arrow';
  const rectPreview = useMemo(() => {
    if (!gesture || gesture.kind !== 'rect' || !gesture.a || !gesture.b) return null;
    const a = toCss(gesture.a);
    const b = toCss(gesture.b);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    let fill: string;
    if (toolType === 'redact') fill = 'rgba(10,10,12,0.9)';
    else if (toolType === 'whiteout') fill = 'rgba(255,255,255,0.95)';
    else {
      const c = cssHexToRgb(settings.color);
      fill = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${settings.opacity})`;
    }
    return { x, y, w, h, fill, line: isLineTool(toolType), isRect: toolType === 'highlight' || toolType === 'redact' || toolType === 'whiteout', arrow: isArrowTool(toolType), ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }, [gesture, toCss, toolType, settings]);

  const inkPts = gesture?.kind === 'ink' ? gesture.pts ?? [] : null;

  const inlineInput = useMemo(() => {
    if (!inline) return null;
    const p = toCss(inline.pt);
    const fs = inline.size * scale;
    const est = Math.max(inlineText.length * fs * 0.62, 8);
    let width: number;
    let left = p.x;
    if (inline.mode === 'new-text') {
      width = Math.max(120, est + 24);
    } else if (inline.mode === 'new-edit' && inline.hit) {
      width = Math.max(inline.hit.w * scale, est + 24);
      // align to the visual top of the hit box
      const box = geom.find((en) => false);
      void box;
    } else if (inline.mode === 'note') {
      width = Math.max(260, Math.min(430, est + 30));
      left = p.x + 20;
    } else {
      // editing an existing text/edit ann
      const existing = props.anns.find((a) => a.id === inline.annId);
      const w = existing && 'w' in existing ? (existing as RectAnn).w * scale : 160;
      width = Math.max(w, est + 24);
    }
    // For single-line text, the click point is the baseline: place the input
    // so its text baseline lands near it (glyphs ascend above, like pdf-lib).
    const top =
      inline.mode === 'new-text' || inline.mode === 'new-edit' || inline.mode === 'edit-text' ? p.y - fs - 4 : p.y - fs * 1.5;
    return { left, top, width, fontSize: fs };
  }, [inline, inlineText, scale, toCss, geom, props.anns]);

  const selEntry = geom.find((g) => g.ann.id === props.selectedId);

  return (
    <div className={`sheet ${props.isCurrent ? 'sheet-current' : ''}`} data-page-id={page.id}>
      <div className="sheet-meta">
        <span className="sheet-label">{page.src === null ? `Blank page ${props.index + 1}` : `Page ${props.index + 1}`}</span>
        {page.rot !== 0 && <span className="badge-rot">rot {page.rot}°</span>}
        {props.anns.length > 0 && (
          <span className="sheet-count">
            {props.anns.length} mark{props.anns.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div
        ref={wrapRef}
        className={`sheet-inner ${isBlank ? 'sheet-blank' : ''} ${loaded || isBlank ? '' : 'sheet-loading'}`}
        style={{ width: cssDims.w || 600, height: cssDims.h || 800 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvasRef} className="sheet-canvas" style={{ width: cssDims.w, height: cssDims.h }} />
        {isBlank && (
          <div className="blank-paper" style={{ width: cssDims.w, height: cssDims.h }}>
            <div className="blank-mark">
              <div>＋</div>
              <p>Blank page</p>
              <small>
                {Math.round(page.w)} × {Math.round(page.h)} pt
              </small>
            </div>
          </div>
        )}

        <svg className="sheet-overlay" width={cssDims.w} height={cssDims.h}>
          <defs>
            <marker id="arrow-preview-head" markerWidth="9" markerHeight="8" refX="7.5" refY="4" orient="auto">
              <path d="M0.5,0.5 L8,4 L0.5,7.5" fill="none" stroke={settings.color} strokeWidth={Math.max(1.4, settings.width * scale)} strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="arrow-head" markerWidth="9" markerHeight="8" refX="7.5" refY="4" orient="auto">
              <path d="M0.5,0.5 L8,4 L0.5,7.5" fill="none" stroke={settings.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="arrow-head-sel" markerWidth="9" markerHeight="8" refX="7.5" refY="4" orient="auto">
              <path d="M0.5,0.5 L8,4 L0.5,7.5" fill="none" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {props.tool === 'edit' &&
            hits &&
            hits.map((h, i) => {
              const tl = toCss({ x: h.x, y: h.y });
              return <rect key={i} x={tl.x} y={tl.y} width={h.w * scale} height={h.h * scale} rx={2} className="hit-hint" />;
            })}

          {(props.formFields ?? []).map((f) => {
            const tl = toCss({ x: f.rect.x, y: f.rect.y });
            const br = toCss({ x: f.rect.x + f.rect.w, y: f.rect.y + f.rect.h });
            const x = Math.min(tl.x, br.x);
            const y = Math.min(tl.y, br.y);
            const w = Math.abs(br.x - tl.x);
            const h = Math.abs(br.y - tl.y);
            return (
              <g
                key={f.name}
                className={`form-widget ${f.filled ? 'form-filled' : ''} ${f.focused ? 'form-focused' : ''}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  props.onFormFieldClick?.(f.name);
                }}
              >
                <rect x={x} y={y} width={w} height={h} className="form-rect" />
                <text x={x + 3} y={y - 3} className="form-label">
                  {f.kind === 'checkbox' ? '☑' : 'ƒ'} {f.name.length > 28 ? f.name.slice(0, 27) + '…' : f.name}
                </text>
              </g>
            );
          })}

          {(props.searchHits ?? []).map((r, i) => {
            const tl = toCss({ x: r.x, y: r.y });
            const br = toCss({ x: r.x + r.w, y: r.y + r.h });
            return (
              <rect
                key={`s${i}`}
                x={Math.min(tl.x, br.x)}
                y={Math.min(tl.y, br.y)}
                width={Math.abs(br.x - tl.x)}
                height={Math.abs(br.y - tl.y)}
                className="search-hl"
              />
            );
          })}

          {geom.map(({ ann, css }) => {
            if (ann.type === 'ink') {
              const points = ann.pts
                .map((q) => {
                  const c = toCss(q);
                  return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <polyline
                  key={ann.id}
                  points={points}
                  fill="none"
                  stroke={ann.color}
                  strokeWidth={Math.max(1.2, ann.width * scale)}
                  strokeOpacity={ann.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            if (!css) return null;
            switch (ann.type) {
              case 'highlight':
                return <rect key={ann.id} x={css.x} y={css.y} width={css.w} height={css.h} fill={ann.color} opacity={ann.opacity} />;
              case 'underline':
                return <line key={ann.id} x1={css.x} y1={css.y + css.h * 0.92} x2={css.x + css.w} y2={css.y + css.h * 0.92} stroke={ann.color} strokeWidth={Math.max(1.4, css.h * 0.12)} strokeOpacity={ann.opacity} strokeLinecap="round" />;
              case 'strike':
                return <line key={ann.id} x1={css.x} y1={css.y + css.h * 0.5} x2={css.x + css.w} y2={css.y + css.h * 0.5} stroke={ann.color} strokeWidth={Math.max(1.4, css.h * 0.1)} strokeOpacity={ann.opacity} strokeLinecap="round" />;
              case 'redact':
                return <rect key={ann.id} x={css.x} y={css.y} width={css.w} height={css.h} fill="#111114" />;
              case 'whiteout':
                return <rect key={ann.id} x={css.x} y={css.y} width={css.w} height={css.h} fill={ann.color} />;
              case 'arrow': {
                const p1 = toCss({ x: ann.x1, y: ann.y1 });
                const p2 = toCss({ x: ann.x2, y: ann.y2 });
                return (
                  <line
                    key={ann.id}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={ann.color}
                    strokeWidth={Math.max(1.4, ann.width * scale)}
                    strokeOpacity={ann.opacity}
                    strokeLinecap="round"
                    markerEnd={props.selectedId === ann.id ? 'url(#arrow-head-sel)' : 'url(#arrow-head)'}
                  />
                );
              }
              case 'rect':
                return (
                  <rect
                    key={ann.id}
                    x={css.x}
                    y={css.y}
                    width={css.w}
                    height={css.h}
                    fill={ann.fill ?? 'none'}
                    fillOpacity={ann.fill ? ann.opacity * 0.35 : 0}
                    stroke={ann.color}
                    strokeWidth={Math.max(1.2, ann.width * scale)}
                    strokeOpacity={ann.opacity}
                  />
                );
              case 'ellipse':
                return (
                  <ellipse
                    key={ann.id}
                    cx={css.x + css.w / 2}
                    cy={css.y + css.h / 2}
                    rx={Math.max(1, css.w / 2)}
                    ry={Math.max(1, css.h / 2)}
                    fill={ann.fill ?? 'none'}
                    fillOpacity={ann.fill ? ann.opacity * 0.35 : 0}
                    stroke={ann.color}
                    strokeWidth={Math.max(1.2, ann.width * scale)}
                    strokeOpacity={ann.opacity}
                  />
                );
              case 'edit':
                return (
                  <g key={ann.id}>
                    <rect x={css.x} y={css.y} width={css.w} height={css.h} fill={ann.bg || '#fff'} />
                    {ann.text && (
                      <text
                        x={css.x + 1.5}
                        y={toCss({ x: ann.x, y: ann.y + ann.h * 0.18 }).y}
                        fontSize={ann.size * scale}
                        fill={ann.color}
                        fontFamily="Helvetica, Arial, sans-serif"
                      >
                        {ann.text}
                      </text>
                    )}
                  </g>
                );
              case 'text': {
                // baseline sits exactly where pdf-lib draws it (content y) — WYSIWYG with export
                const bl = toCss({ x: ann.x, y: ann.y });
                return (
                  <text key={ann.id} x={css.x} y={bl.y} fontSize={ann.size * scale} fill={ann.color} fontFamily="Helvetica, Arial, sans-serif">
                    {ann.text}
                  </text>
                );
              }
              case 'note':
                return (
                  <g key={ann.id}>
                    <rect x={css.x} y={css.y} width={css.w} height={css.h} rx={1} fill={ann.color} stroke="#b48a10" strokeWidth={0.8} />
                    <path d={`M${css.x + css.w * 0.68} ${css.y} v${css.h * 0.32} h${css.w * 0.32} z`} fill="rgba(120,90,0,0.35)" />
                    <text x={css.x + css.w / 2} y={css.y + css.h * 0.7} textAnchor="middle" fontSize={Math.min(11, css.w * 0.5)} fontWeight="700" fill="#5a4300" fontFamily="Helvetica, Arial, sans-serif">
                      {ann.n}
                    </text>
                  </g>
                );
              case 'image': {
                const fh = ann.flipH ? -1 : 1;
                const fv = ann.flipV ? -1 : 1;
                const cx = css.x + css.w / 2;
                const cy = css.y + css.h / 2;
                return (
                  <image
                    key={ann.id}
                    href={ann.dataUrl}
                    x={css.x}
                    y={css.y}
                    width={css.w}
                    height={css.h}
                    preserveAspectRatio="none"
                    transform={fh !== 1 || fv !== 1 ? `translate(${cx} ${cy}) scale(${fh} ${fv}) translate(${-cx} ${-cy})` : undefined}
                  />
                );
              }
              default:
                return null;
            }
          })}

          {inkPts && (
            <polyline
              points={inkPts.map((q, i) => `${(i === 0 ? '' : '') + toCss(q).x.toFixed(1)},${toCss(q).y.toFixed(1)}`).join(' ')}
              fill="none"
              stroke={settings.color}
              strokeWidth={Math.max(1.2, settings.width * scale)}
              strokeOpacity={settings.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {rectPreview &&
            (rectPreview.arrow ? (
              <line
                x1={rectPreview.ax}
                y1={rectPreview.ay}
                x2={rectPreview.bx}
                y2={rectPreview.by}
                stroke={settings.color}
                strokeWidth={Math.max(1.5, settings.width * scale)}
                strokeOpacity={settings.opacity}
                strokeLinecap="round"
                markerEnd="url(#arrow-preview-head)"
              />
            ) : rectPreview.line ? (
              <g>
                <rect x={rectPreview.x} y={rectPreview.y} width={rectPreview.w} height={rectPreview.h} fill="none" stroke={settings.color} strokeOpacity={0.5} strokeDasharray="4 3" />
                <line
                  x1={rectPreview.x}
                  y1={isLineTool(toolType) && toolType === 'underline' ? rectPreview.y + rectPreview.h * 0.92 : rectPreview.y + rectPreview.h * 0.5}
                  x2={rectPreview.x + rectPreview.w}
                  y2={isLineTool(toolType) && toolType === 'underline' ? rectPreview.y + rectPreview.h * 0.92 : rectPreview.y + rectPreview.h * 0.5}
                  stroke={settings.color}
                  strokeWidth={Math.max(1.5, rectPreview.h * 0.12)}
                  strokeOpacity={settings.opacity}
                  strokeLinecap="round"
                />
              </g>
            ) : toolType === 'ellipse' ? (
              <ellipse cx={rectPreview.x + rectPreview.w / 2} cy={rectPreview.y + rectPreview.h / 2} rx={Math.max(1, rectPreview.w / 2)} ry={Math.max(1, rectPreview.h / 2)} fill="none" stroke={settings.color} strokeWidth={Math.max(1.5, settings.width * scale)} strokeOpacity={Math.min(1, 0.35 + settings.opacity)} strokeDasharray="5 3" />
            ) : toolType === 'rect' ? (
              <rect x={rectPreview.x} y={rectPreview.y} width={rectPreview.w} height={rectPreview.h} fill="none" stroke={settings.color} strokeWidth={Math.max(1.5, settings.width * scale)} strokeOpacity={Math.min(1, 0.35 + settings.opacity)} strokeDasharray="5 3" />
            ) : (
              <rect x={rectPreview.x} y={rectPreview.y} width={rectPreview.w} height={rectPreview.h} fill={rectPreview.fill} stroke="rgba(60,80,120,0.6)" strokeDasharray="4 3" />
            ))}

          {previewInfo && !rectPreview && gesture?.kind !== 'resize' && (
            <rect x={previewInfo.x} y={previewInfo.y} width={previewInfo.w} height={previewInfo.h} fill="none" stroke="#3b82f6" strokeDasharray="5 3" />
          )}
          {gesture?.kind === 'resize' && previewInfo && (
            <rect x={previewInfo.x} y={previewInfo.y} width={previewInfo.w} height={previewInfo.h} fill="none" stroke="#3b82f6" strokeDasharray="5 3" />
          )}

          {selEntry && selEntry.css && !gesture && (
            <g pointerEvents="none">
              <rect x={selEntry.css.x - 2} y={selEntry.css.y - 2} width={selEntry.css.w + 4} height={selEntry.css.h + 4} fill="none" stroke="#2563eb" strokeWidth={1.4} strokeDasharray="5 3" />
              {selEntry.ann.type !== 'ink' && selEntry.ann.type !== 'note' && (
                <rect x={selEntry.css.x + selEntry.css.w - 4} y={selEntry.css.y + selEntry.css.h - 4} width={9} height={9} fill="#2563eb" stroke="#fff" strokeWidth={1} />
              )}
            </g>
          )}
        </svg>

        {inline && inlineInput && (
          <textarea
            className="inline-input"
            style={{
              left: inlineInput.left,
              top: inlineInput.top,
              width: inlineInput.width,
              fontSize: inlineInput.fontSize,
              lineHeight: 1.2,
              minHeight: Math.max(30, inlineInput.fontSize * 1.5),
            }}
            autoFocus
            rows={1}
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitInline();
              } else if (e.key === 'Escape') {
                setInline(null);
                setInlineText('');
              }
            }}
            onBlur={() => commitInline()}
            placeholder={inline.mode === 'new-text' ? 'Type and press Enter…' : inline.mode === 'new-edit' ? 'Replace text, press Enter' : inline.mode === 'note' ? 'Note…' : ''}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
});
