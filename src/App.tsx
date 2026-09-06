import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import type { Annotation, DocModel, PageRec, Point, ToolId, ToolSettings } from './types';
import { BLANK_SIZES, uid } from './types';
import { docModelReducer, emptyModel, pagesForSource } from './lib/docModel';
import { loadSource, makeViewport, cssToContent, pagePlainText } from './lib/pdfio';
import type { Source } from './types';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { runOcr } from './lib/ocr';
import { buildPdf, downloadBytes, niceFileName, type DocMeta } from './lib/exportPdf';
import { makeSamplePdf } from './lib/sample';
import { PageSheet } from './components/PageSheet';
import { ToolRail } from './components/ToolRail';
import { ThumbStrip } from './components/Thumbs';
import { Inspector } from './components/Inspector';
import { ExportDialog, HelpModal, SignPadModal, type ExportPayload } from './components/modals';
import { AIDialog } from './components/AIDialog';
import { FormsDialog, type FormValuesBySource } from './components/FormsDialog';
import { CompareDialog } from './components/CompareDialog';
import { searchDocument, type SearchMatch } from './lib/search';
import { fieldsForSource, clearFieldCache } from './lib/formOverlay';
import type { FieldDesc } from './lib/forms';
import { Icon } from './components/icons';
import { Landing } from './components/Landing';

let toastSeq = 0;

const SESSION_KEY = 'nl-pdf-studio.session.v1';

interface SessionBlob {
  name: string;
  at: number;
  files: Array<{ id: string; name: string; b64: string }>; // source files, base64
  pages: Array<{ id: string; src: string | null; page: number | null; w: number; h: number; bx: number; by: number; rot: number }>;
  anns: Annotation[];
  meta: DocMeta;
  formValues: FormValuesBySource;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function App() {
  const [model, dispatch] = useReducer(docModelReducer, emptyModel);
  const { doc } = model;
  const proxiesRef = useRef<Map<string, PDFDocumentProxy>>(new Map());
  const noteCounter = useRef(0);

  const [tool, setTool] = useState<ToolId>('select');
  const [settings, setSettingsState] = useState<ToolSettings>({ color: '#ffd400', width: 2.5, opacity: 0.45, fontSize: 14 });
  const setSettings = useCallback((s: Partial<ToolSettings>) => setSettingsState((p) => ({ ...p, ...s })), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100); // % of fit-to-width
  const [fitScale, setFitScale] = useState(1);
  const [meta, setMeta] = useState<DocMeta>({ title: '', author: '', subject: '', keywords: '' });
  const [modal, setModal] = useState<'export' | 'help' | 'ai' | 'forms' | 'compare' | null>(null);
  const [formValues, setFormValues] = useState<FormValuesBySource>({});
  const [searchState, setSearchState] = useState<{ q: string; matches: SearchMatch[]; idx: number; busy: boolean } | null>(null);
  const [showFormWidgets, setShowFormWidgets] = useState(false);
  const [formFieldsBySource, setFormFieldsBySource] = useState<Map<string, FieldDesc[]>>(new Map());
  const [focusedFormField, setFocusedFormField] = useState<string | null>(null);

  // enumerate form fields lazily when the toggle is on
  useEffect(() => {
    if (!showFormWidgets || doc.sources.length === 0) return;
    let alive = true;
    void (async () => {
      const map = new Map<string, FieldDesc[]>();
      for (const s of doc.sources) map.set(s.id, await fieldsForSource(s));
      if (alive) setFormFieldsBySource(map);
    })();
    return () => {
      alive = false;
    };
  }, [showFormWidgets, doc.sources]);
  const [signOpen, setSignOpen] = useState(false);
  const [ocrBusy, setOcrBusy] = useState('');
  const [busy, setBusy] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string }>>([]);
  const [dropState, setDropState] = useState<'none' | 'over'>('none');
  const [rotNoticeDismissed, setRotNoticeDismissed] = useState(false);

  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<{ dataUrl: string; w: number; h: number } | null>(null);
  const pendingSpecial = useRef<{ kind: 'sign' | 'image'; pt: Point; pageId: string } | null>(null);

  const selectedAnn = useMemo(() => (selectedId ? (doc.anns.find((a) => a.id === selectedId) ?? null) : null), [selectedId, doc.anns]);
  const currentPage = doc.pages.find((p) => p.id === currentPageId) ?? null;

  /** pages whose file metadata marks them as rotated (camera scans are 90/270; some generators emit 180) */
  const sidewaysPages = useMemo(() => {
    if (rotNoticeDismissed) return [];
    const found: Array<{ id: string; intrinsic: number }> = [];
    for (const p of doc.pages) {
      if (!p.src || p.page === null || p.rot !== 0) continue;
      const src = doc.sources.find((s) => s.id === p.src);
      const intrinsic = src?.pages[p.page]?.rot ?? 0;
      if (intrinsic !== 0) found.push({ id: p.id, intrinsic });
    }
    return found;
  }, [doc.pages, doc.sources, rotNoticeDismissed]);

  const toast = useCallback((msg: string) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  /* ---------------- document lifecycle ---------------- */
  const adoptSource = useCallback(async (bytes: Uint8Array, name: string) => {
    const ls = await loadSource(bytes, name);
    return ls;
  }, []);

  /** total display rotation of a page: intrinsic /Rotate of the source + user rotation */
  const rotationFor = useCallback(
    (p: PageRec) => {
      if (!p.src || p.page === null) return 0;
      const src = doc.sources.find((s) => s.id === p.src);
      const intrinsic = src?.pages[p.page]?.rot ?? 0;
      return ((intrinsic + p.rot) % 360 + 360) % 360;
    },
    [doc.sources],
  );

  const openBytes = useCallback(
    async (bytes: Uint8Array, name: string, isSample = false) => {
      setBusy(`Opening ${name}…`);
      try {
        proxiesRef.current.clear();
        clearFieldCache();
        const ls = await adoptSource(bytes, name);
        proxiesRef.current.set(ls.source.id, ls.js);
        const pages = pagesForSource(ls.source);
        dispatch({ type: 'open', name, sources: [ls.source], pages });
        noteCounter.current = 0;
        setRotNoticeDismissed(false);
        setSelectedId(null);
        setCurrentPageId(pages[0]?.id ?? null);
        const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
        setMeta({
          title: (await lib.getTitle()) ?? name.replace(/\.pdf$/i, ''),
          author: (await lib.getAuthor()) ?? '',
          subject: (await lib.getSubject()) ?? '',
          keywords: (await lib.getKeywords()) ?? '',
        });
        if (!isSample) setZoom(100);
        toast(`Opened “${name}” — ${ls.source.pages.length} page${ls.source.pages.length === 1 ? '' : 's'}`);
      } catch (err) {
        toast(`Could not open ${name} — it may be encrypted or not a valid PDF.`);
        console.error(err);
      } finally {
        setBusy('');
      }
    },
    [adoptSource, toast],
  );

  const openFile = useCallback(
    async (file: File) => {
      const buf = await file.arrayBuffer();
      await openBytes(new Uint8Array(buf), file.name);
    },
    [openBytes],
  );

  const loadDemo = useCallback(async () => {
    if (busy) return;
    setBusy('Building demo document…');
    try {
      const bytes = await makeSamplePdf();
      await openBytes(bytes, 'PDF-Studio-demo.pdf', true);
    } finally {
      setBusy('');
    }
  }, [busy, openBytes]);

  /* ---------------- session restore ---------------- */
  const [savedSession, setSavedSession] = useState<{ name: string; at: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const blob = JSON.parse(raw) as SessionBlob;
      if (blob?.pages?.length && blob?.files?.length) setSavedSession({ name: blob.name, at: blob.at });
    } catch {
      /* corrupt session — ignore */
    }
  }, []);

  const restoreSession = useCallback(async () => {
    setBusy('Restoring your session…');
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const blob = JSON.parse(raw) as SessionBlob;
      const sources: Source[] = [];
      const proxies = new Map<string, PDFDocumentProxy>();
      for (const f of blob.files) {
        const ls = await loadSource(b64ToBytes(f.b64), f.name);
        const src = { ...ls.source, id: f.id };
        sources.push(src);
        proxies.set(src.id, ls.js);
      }
      proxiesRef.current = proxies;
      dispatch({ type: 'open', name: blob.name, sources, pages: blob.pages, anns: blob.anns });
      noteCounter.current = Math.max(0, ...blob.anns.map((a) => (a.type === 'note' ? a.n : 0)));
      setRotNoticeDismissed(false);
      setSelectedId(null);
      setCurrentPageId(blob.pages[0]?.id ?? null);
      setMeta(blob.meta ?? { title: '', author: '', subject: '', keywords: '' });
      setFormValues(blob.formValues ?? {});
      toast(`Restored “${blob.name}” from this device.`);
    } catch (e) {
      console.error(e);
      toast('Could not restore the saved session.');
    } finally {
      setBusy('');
    }
  }, [toast]);

  const mergeFile = useCallback(
    async (file: File) => {
      if (doc.pages.length === 0) {
        await openFile(file);
        return;
      }
      setBusy(`Merging ${file.name}…`);
      try {
        const buf = await file.arrayBuffer();
        const ls = await adoptSource(new Uint8Array(buf), file.name);
        proxiesRef.current.set(ls.source.id, ls.js);
        const pages = pagesForSource(ls.source);
        dispatch({ type: 'merge', sources: [ls.source], pages, afterPageId: currentPageId });
        toast(`Merged ${file.name} (${pages.length} page${pages.length === 1 ? '' : 's'}) after the current page.`);
      } catch {
        toast(`Could not merge ${file.name}.`);
      } finally {
        setBusy('');
      }
    },
    [doc.pages.length, adoptSource, openFile, currentPageId, toast],
  );

  /* ---------------- export ---------------- */
  const doExport = useCallback(
    async (payload: ExportPayload) => {
      setMeta(payload.meta);
      const { bytes, pages } = await buildPdf({ doc, meta: payload.meta, range: payload.range, formValues, stamps: payload.stamps });
      const base = niceFileName(doc.name, payload.range.trim() ? 'extract' : 'edited');
      downloadBytes(bytes, base);
      toast(`Downloaded ${base} (${pages} page${pages === 1 ? '' : 's'}).`);
    },
    [doc, toast, formValues],
  );

  const doSplit = useCallback(
    async (payload: ExportPayload) => {
      setMeta(payload.meta);
      const n = doc.pages.length;
      const names: string[] = [];
      for (let i = 1; i <= n; i++) {
        const { bytes, pages } = await buildPdf({ doc, meta: payload.meta, range: String(i), formValues });
        if (pages === 0) continue;
        const fn = niceFileName(doc.name, 'page', i);
        downloadBytes(bytes, fn);
        names.push(fn);
      }
      toast(`Split into ${names.length} file${names.length === 1 ? '' : 's'}.`);
    },
    [doc, toast, formValues],
  );

  const quickSave = useCallback(() => {
    void doExport({ range: '', meta });
  }, [doExport, meta]);

  /** export with the form values burned into the pages (fields become static) */
  const exportFlattenedForms = useCallback(async () => {
    setBusy('Exporting filled form…');
    try {
      const { bytes, pages } = await buildPdf({ doc, meta, range: '', formValues, flattenForms: true });
      const base = niceFileName(doc.name, 'filled');
      downloadBytes(bytes, base);
      toast(`Downloaded ${base} (${pages} page${pages === 1 ? '' : 's'}) with form values flattened in.`);
      setModal(null);
    } finally {
      setBusy('');
    }
  }, [doc, meta, formValues, toast]);

  const setFormValue = useCallback((sourceId: string, field: string, v: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [sourceId]: { ...(prev[sourceId] ?? {}), [field]: v } }));
  }, []);

  /* ---------------- page ops ---------------- */
  const onGoTo = useCallback((id: string) => {
    setCurrentPageId(id);
    requestAnimationFrame(() => {
      document.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  /* ---------------- full-document search ---------------- */
  const runSearch = useCallback(
    async (q: string) => {
      const query = q.trim();
      if (query.length < 2) {
        setSearchState(null);
        return;
      }
      setSearchState({ q: query, matches: [], idx: 0, busy: true });
      const matches = await searchDocument(query, doc.pages, doc.sources, proxiesRef.current);
      setSearchState((prev) => (prev && prev.q === query ? { q: query, matches, idx: matches.length ? 0 : -1, busy: false } : prev));
      if (matches.length) {
        const first = matches[0];
        onGoTo(doc.pages[first.pageIndex]?.id ?? '');
      }
    },
    [doc.pages, doc.sources, onGoTo],
  );

  const gotoMatch = useCallback(
    (delta: number) => {
      setSearchState((prev) => {
        if (!prev || prev.matches.length === 0) return prev;
        const idx = (prev.idx + delta + prev.matches.length) % prev.matches.length;
        const m = prev.matches[idx];
        const p = doc.pages[m.pageIndex];
        if (p) onGoTo(p.id);
        return { ...prev, idx };
      });
    },
    [doc.pages, onGoTo],
  );

  const rotatePage = useCallback(
    (id: string, cw: boolean) => {
      const p = doc.pages.find((pg) => pg.id === id);
      if (!p || p.src === null) return; // rotating blank pages is disabled
      dispatch({ type: 'rotate', pageId: id, cw });
    },
    [doc.pages],
  );

  const flipPage = useCallback(
    (id: string, mode: 'h' | 'v') => {
      const p = doc.pages.find((pg) => pg.id === id);
      if (!p || p.src === null) return;
      dispatch({ type: 'flipPage', pageId: id, mode });
      toast(`Page mirrored ${mode === 'h' ? 'horizontally' : 'vertically'} (undo anytime).`);
    },
    [doc.pages, toast],
  );

  /** re-encode /Rotate so pages carrying intrinsic rotation display upright */
  const makePagesUpright = useCallback(() => {
    const rots: Record<string, number> = {};
    for (const p of doc.pages) {
      if (!p.src || p.page === null || p.rot !== 0) continue;
      const src = doc.sources.find((s) => s.id === p.src);
      const intrinsic = src?.pages[p.page]?.rot ?? 0;
      if (intrinsic !== 0) rots[p.id] = ((360 - intrinsic) % 360 + 360) % 360;
    }
    const n = Object.keys(rots).length;
    if (!n) return;
    dispatch({ type: 'setPageRots', rots });
    setRotNoticeDismissed(true);
    toast(`Turned ${n} rotated page${n === 1 ? '' : 's'} upright (undo anytime).`);
  }, [doc.pages, doc.sources, toast]);

  /** plain-text context of every page (used by the private AI panel) */
  const gatherContext = useCallback(async (): Promise<string> => {
    const parts: string[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      const p = doc.pages[i];
      if (p.src && p.page !== null) {
        const proxy = proxiesRef.current.get(p.src);
        if (proxy) {
          try {
            const pp = await proxy.getPage(p.page + 1);
            const text = await pagePlainText(pp);
            parts.push(`\n--- Page ${i + 1} ---\n${text}`);
            continue;
          } catch {
            /* fall through to placeholder */
          }
        }
      }
      parts.push(`\n--- Page ${i + 1} (blank) ---`);
    }
    return parts.join('\n') || '(the document contains no extractable text)'; // eslint-disable-line no-control-regex
  }, [doc.pages]);

  const addBlankAfter = useCallback(
    (afterId: string | null, size: keyof typeof BLANK_SIZES = 'Letter') => {
      const { w, h } = BLANK_SIZES[size];
      dispatch({ type: 'insertBlank', afterPageId: afterId, w, h });
      toast('Blank page inserted.');
    },
    [toast],
  );

  /** OCR the current page (Tesseract WASM, fully local) and rewrite its text as editable annotations */
  const runOcrOnCurrent = useCallback(async () => {
    const page = doc.pages.find((p) => p.id === currentPageId);
    if (!page || page.src === null) {
      toast('Pick a page first (it needs rendered content).');
      return;
    }
    if (rotationFor(page) % 180 !== 0) {
      toast('Rotate the page upright first — OCR reads horizontal text.');
      return;
    }
    const el = document.querySelector(`[data-page-id="${page.id}"] .sheet-canvas`) as HTMLCanvasElement | null;
    if (!el) return;
    setOcrBusy('OCR starting…');
    try {
      const lines = await runOcr(el, (m) => setOcrBusy(`OCR: ${m}`));
      if (!lines.length) {
        toast('OCR found no confident text — try again with a larger zoom.');
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const s = fitScale * (zoom / 100);
      const vp = makeViewport({ x: page.bx, y: page.by, w: page.w, h: page.h }, s, 0);
      const ctx = el.getContext('2d', { willReadFrequently: true });
      const sample = (px0: number, py0: number, px1: number, py1: number): string => {
        if (!ctx) return '#ffffff';
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let gx = 0; gx < 5; gx++) {
          for (let gy = 0; gy < 3; gy++) {
            const sx = Math.min(el.width - 2, Math.max(1, Math.round(px0 + ((px1 - px0) * gx) / 4)));
            const sy = Math.min(el.height - 2, Math.max(1, Math.round(py0 + ((py1 - py0) * gy) / 2)));
            const d = ctx.getImageData(sx, sy, 1, 1).data;
            r += d[0];
            g += d[1];
            b += d[2];
            n++;
          }
        }
        const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
      };
      const toContent = (px: number, py: number) => cssToContent(vp, { x: px / dpr, y: py / dpr });
      let added = 0;
      for (const ln of lines) {
        const tl = toContent(ln.x0, ln.y0);
        const br = toContent(ln.x1, ln.y1);
        const x = Math.max(0, Math.min(tl.x, br.x));
        const y = Math.max(0, Math.min(tl.y, br.y));
        const w = Math.min(page.w - x, Math.abs(br.x - tl.x));
        const h = Math.min(page.h - y, Math.abs(br.y - tl.y));
        if (w < 3 || h < 3) continue;
        const ann: Annotation = {
          id: uid(),
          pageId: page.id,
          type: 'edit',
          x,
          y,
          w,
          h,
          text: ln.text,
          size: Math.max(5, Math.min(40, h * 0.85)),
          color: '#17171b',
          bg: sample(ln.x0, ln.y0, ln.x1, ln.y1),
        };
        dispatch({ type: 'annAdd', ann });
        added++;
      }
      toast(`OCR rewrote ${added} line${added === 1 ? '' : 's'} into editable text (fully local — undo anytime).`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrBusy('');
    }
  }, [doc.pages, currentPageId, rotationFor, fitScale, zoom, toast]);

  const deletePage = useCallback(
    (id: string) => {
      const idx = doc.pages.findIndex((pg) => pg.id === id);
      if (idx < 0) return;
      dispatch({ type: 'deletePage', pageId: id });
      if (currentPageId === id) {
        const next = doc.pages[idx + 1] ?? doc.pages[idx - 1];
        setCurrentPageId(next?.id ?? null);
      }
      if (selectedId && doc.anns.some((a) => a.pageId === id && a.id === selectedId)) setSelectedId(null);
      toast('Page deleted.');
    },
    [doc.pages, currentPageId, selectedId, doc.anns, toast],
  );

  const dupPage = useCallback(
    (id: string) => {
      dispatch({ type: 'duplicatePage', pageId: id });
      toast('Page duplicated.');
    },
    [toast],
  );

  const onReorder = useCallback(
    (fromId: string, toId: string) => {
      dispatch({ type: 'reorder', fromId, toId });
      toast('Pages reordered.');
    },
    [toast],
  );

  /* ---------------- annotation ops ---------------- */
  const addAnn = useCallback(
    (ann: Annotation) => {
      dispatch({ type: 'annAdd', ann });
      setSelectedId(ann.id);
    },
    [],
  );
  const updAnn = useCallback((id: string, patch: Partial<Annotation>) => dispatch({ type: 'annUpd', id, patch }), []);
  const delAnn = useCallback(
    (id: string) => {
      dispatch({ type: 'annDel', id });
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  const getNextNoteN = useCallback(() => ++noteCounter.current, []);

  /* ---------------- signature / image placement ---------------- */
  const placeSpecialAt = useCallback(
    (kind: 'sign' | 'image', pt: Point, pageId: string, dataUrl: string, aspect: number, label: string) => {
      const page = doc.pages.find((p) => p.id === pageId);
      if (!page) return;
      const isSign = kind === 'sign';
      let w = isSign ? Math.min(170, page.w * 0.4) : 200;
      if (!isSign) w = Math.min(240, page.w * 0.7);
      let h = Math.max(12, w / aspect);
      if (h > page.h * 0.45) {
        h = page.h * 0.45;
        w = h * aspect;
      }
      let x = pt.x - w / 2;
      let y = pt.y - h / 2;
      x = Math.max(2, Math.min(x, page.w - w - 2));
      y = Math.max(2, Math.min(y, page.h - h - 2));
      const ann: Annotation = {
        id: uid(),
        pageId,
        type: 'image',
        x,
        y,
        w,
        h,
        dataUrl,
        label,
      };
      dispatch({ type: 'annAdd', ann });
      setSelectedId(ann.id);
      if (isSign) {
        signRef.current = { dataUrl, w, h };
        setSignOpen(false);
        toast('Signature stamped. Drag to position it.');
        setTool('select');
      } else {
        toast('Image placed — drag to position, corner handle to scale.');
      }
    },
    [doc.pages],
  );

  const onPlaceSpecial = useCallback(
    (kind: 'sign' | 'image', pt: Point, pageId: string) => {
      if (kind === 'sign' && signRef.current) {
        placeSpecialAt(kind, pt, pageId, signRef.current.dataUrl, signRef.current.w / signRef.current.h, 'signature');
        return;
      }
      pendingSpecial.current = { kind, pt, pageId };
      if (kind === 'sign') setSignOpen(true);
      else imageInputRef.current?.click();
    },
    [placeSpecialAt],
  );

  const onImageChosen = useCallback(
    async (file: File | undefined) => {
      const pending = pendingSpecial.current;
      if (!file || !pending) return;
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = rej;
        im.src = dataUrl;
      });
      placeSpecialAt('image', pending.pt, pending.pageId, dataUrl, dims.w / dims.h, file.name);
      pendingSpecial.current = null;
    },
    [placeSpecialAt],
  );

  /* ---------------- fit & zoom ---------------- */
  const measureFit = useCallback(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const maxW = doc.pages.reduce((m, p) => {
      const r = p.rot % 180 === 90 ? 90 : 0;
      const w = r ? p.h : p.w;
      return Math.max(m, w);
    }, 0);
    if (maxW <= 0) return;
    setFitScale(Math.min(3, Math.max(0.2, (el.clientWidth - 64) / maxW)));
  }, [doc.pages]);

  useEffect(() => {
    measureFit();
    const onResize = () => measureFit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureFit]);

  const scale = fitScale * (zoom / 100);

  /* ---------------- autosave / session restore ---------------- */
  const saveSession = useRef<number | null>(null);
  const hasDocNow = doc.pages.length > 0;
  useEffect(() => {
    if (!hasDocNow) return;
    if (saveSession.current) window.clearTimeout(saveSession.current);
    saveSession.current = window.setTimeout(() => {
      try {
        const blob: SessionBlob = {
          name: doc.name,
          at: Date.now(),
          files: doc.sources.map((s) => ({ id: s.id, name: s.name, b64: bytesToB64(s.bytes) })),
          pages: doc.pages.map((p) => ({ id: p.id, src: p.src, page: p.page, w: p.w, h: p.h, bx: p.bx, by: p.by, rot: p.rot })),
          anns: doc.anns,
          meta,
          formValues,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(blob));
      } catch {
        /* quota — session too large to persist; acceptable */
      }
    }, 900);
    return () => {
      if (saveSession.current) window.clearTimeout(saveSession.current);
    };
  }, [doc, meta, formValues, hasDocNow]);
  useEffect(() => {
    if (currentPageId && !doc.pages.some((p) => p.id === currentPageId)) setCurrentPageId(null);
  }, [doc.pages, currentPageId]);
  // clear stale selection
  useEffect(() => {
    if (selectedId && !doc.anns.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [doc.anns, selectedId]);

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (modal || signOpen) return;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openInputRef.current?.click();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        quickSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'redo' });
        else dispatch({ type: 'undo' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          delAnn(selectedId);
        }
        return;
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoom((z) => Math.min(400, Math.round(z * 1.2)));
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(20, Math.round(z / 1.2)));
        return;
      }
      if (e.key === '0') {
        setZoom(100);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, signOpen, selectedId, delAnn, quickSave]);

  /* ---------------- drag & drop ---------------- */
  const onGlobalDrop = useCallback(
    async (e: React.DragEvent, mode: 'open' | 'merge') => {
      e.preventDefault();
      setDropState('none');
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) {
        toast('Please drop a PDF file.');
        return;
      }
      if (mode === 'open') await openFile(file);
      else await mergeFile(file);
    },
    [openFile, mergeFile, toast],
  );

  /* ================= render ================= */
  const hasDoc = doc.pages.length > 0;
  const undoCount = model.past.length;
  const redoCount = model.future.length;
  const currentIndex = currentPageId ? doc.pages.findIndex((p) => p.id === currentPageId) : -1;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">
            <Icon.logo />
          </span>
          <span className="brand-name">
            NavigatorsLab PDF Studio
            <small>by navigatorslab.com</small>
          </span>
        </div>

        {hasDoc ? (
          <>
            <div className="docname" title={doc.name}>
              <Icon.file />
              <span>{doc.name}</span>
              <b>{doc.pages.length} p.</b>
            </div>
            <div className="tb-sep" />
            <button className="tb-btn" onClick={() => openInputRef.current?.click()} title="Open PDF (Ctrl+O)">
              <Icon.open /> Open
            </button>
            <button className="tb-btn" onClick={() => mergeInputRef.current?.click()} title="Merge another PDF after the current page">
              Merge PDF
            </button>
            <div className="tb-sep" />
            <button className="tb-btn icon" disabled={!undoCount} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl+Z)">
              <Icon.undo />
            </button>
            <button className="tb-btn icon" disabled={!redoCount} onClick={() => dispatch({ type: 'redo' })} title="Redo (Ctrl+Y)">
              <Icon.redo />
            </button>
            <span className="tb-spacer" />
            <input
              className="search-box"
              type="search"
              placeholder="Search document…"
              value={searchState?.q ?? ''}
              onChange={(e) => {
                const q = e.target.value;
                if (!q.trim()) setSearchState(null);
                else void runSearch(q);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  gotoMatch(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {searchState && (
              <span className="search-count">
                {searchState.busy ? '…' : searchState.matches.length ? `${searchState.idx + 1}/${searchState.matches.length}` : '0'}
              </span>
            )}
            <button className="tb-btn" onClick={() => setModal('forms')} title="Detect and fill PDF form fields (AcroForm)">
              <Icon.check /> Forms
            </button>
            <button className="tb-btn" onClick={() => setModal('compare')} title="Compare the text of two PDFs side by side">
              <Icon.copy /> Compare
            </button>
            <button className="tb-btn icon" onClick={() => setModal('ai')} title="Private on-device AI (ask / summarize this document)">
              <Icon.sparkle />
            </button>
            <button className="tb-btn icon" onClick={() => setModal('help')} title="Help">
              <Icon.info />
            </button>
            <button className="tb-btn icon" onClick={() => setModal('export')} title="Export options & document properties">
              <Icon.props />
            </button>
            <button className="tb-btn icon" onClick={quickSave} title="Save a copy (Ctrl+S)">
              <Icon.download />
            </button>
            <button className="btn primary save-cta" onClick={quickSave}>
              <Icon.download /> Save
            </button>
          </>
        ) : (
          <>
            <span className="tb-spacer" />
            <button className="tb-btn" onClick={() => setModal('help')} title="Help">
              <Icon.info /> Help
            </button>
          </>
        )}
      </header>

      {!hasDoc ? (
        <Landing
          busy={!!busy}
          onOpen={() => openInputRef.current?.click()}
          onDemo={loadDemo}
          saved={savedSession}
          onRestore={() => void restoreSession()}
          onDropFile={(e) => {
            void onGlobalDrop(e, 'open');
          }}
        />
      ) : (
        <div className="app-body">
          <ToolRail tool={tool} onTool={setTool} />
          <ThumbStrip
            pages={doc.pages}
            proxies={proxiesRef.current}
            currentId={currentPageId}
            rotationFor={rotationFor}
            onGoTo={onGoTo}
            onReorder={onReorder}
            onRotate={rotatePage}
            onFlip={flipPage}
            onDelete={deletePage}
            onDuplicate={dupPage}
            onInsertBlank={(afterId) => addBlankAfter(afterId)}
            onAddBlankAtEnd={() => addBlankAfter(null)}
          />

          <main
            className="canvas-area"
            data-tool={tool}
            ref={canvasAreaRef}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoom((z) => Math.min(400, Math.max(20, Math.round(z * (e.deltaY < 0 ? 1.1 : 0.9)))));
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setDropState('over');
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropState('none');
            }}
            onDrop={(e) => {
              if (dropState === 'over') {
                void onGlobalDrop(e, 'merge');
              }
            }}
          >
            {sidewaysPages.length > 0 && (
              <div className="normalize-banner">
                <span>📱 {sidewaysPages.length} page(s) carry rotation metadata and are not shown upright.</span>
                <button className="btn primary tiny" onClick={makePagesUpright}>
                  Turn upright
                </button>
                <button className="btn ghost tiny" onClick={() => setRotNoticeDismissed(true)}>
                  Not now
                </button>
              </div>
            )}
            <div className="page-column">
              {doc.pages.map((p, i) => (
                <PageSheet
                  key={p.id}
                  page={p}
                  index={i}
                  proxy={p.src ? (proxiesRef.current.get(p.src) ?? null) : null}
                  scale={scale}
                  rotation={p.src ? rotationFor(p) : 0}
                  anns={doc.anns.filter((a) => a.pageId === p.id)}
                  searchHits={(searchState?.matches ?? []).filter((m) => m.pageId === p.id).map((m) => m.rect)}
                  formFields={
                    showFormWidgets && p.src
                      ? (formFieldsBySource.get(p.src) ?? [])
                          .filter((f) => f.pageIndex === p.page)
                          .map((f) => ({
                            name: f.name,
                            kind: f.kind,
                            rect: f.rect,
                            filled: f.kind === 'checkbox' ? formValues[p.src!]?.[f.name] === true : String(formValues[p.src!]?.[f.name] ?? '').length > 0,
                            focused: focusedFormField === f.name,
                          }))
                      : undefined
                  }
                  onFormFieldClick={(name) => {
                    setFocusedFormField(name);
                    setModal('forms');
                    setTimeout(() => {
                      document.querySelector(`[data-field="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }, 60);
                  }}
                  tool={tool}
                  settings={settings}
                  selectedId={selectedId}
                  isCurrent={p.id === currentPageId}
                  onSetCurrent={setCurrentPageId}
                  onSelect={setSelectedId}
                  onAdd={addAnn}
                  onUpd={updAnn}
                  onDel={delAnn}
                  getNextNoteN={getNextNoteN}
                  onPlaceSpecial={onPlaceSpecial}
                />
              ))}
              <button className="add-page-bottom" onClick={() => addBlankAfter(null)}>
                <Icon.plus /> Add blank page at end
              </button>
            </div>
            <div className="empty-hint-space" />
          </main>

          <Inspector
            tool={tool}
            settings={settings}
            onSettings={setSettings}
            selected={selectedAnn}
            onUpd={updAnn}
            onDel={delAnn}
            onOcr={() => void runOcrOnCurrent()}
            ocrBusy={ocrBusy}
          />

          {dropState === 'over' && (
            <div
              className="drop-veil"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => void onGlobalDrop(e, 'merge')}
              onClick={() => setDropState('none')}
            >
              <div className="drop-card" onClick={(e) => e.stopPropagation()}>
                <h2>Drop to merge into the current document</h2>
                <p>Dropping merges the file after the current page · everything stays on this device.</p>
                <p className="muted small">(To replace instead, cancel and choose <b>Open</b> in the toolbar.)</p>
                <div className="drop-actions">
                  <button className="btn ghost" onClick={() => setDropState('none')}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {hasDoc && (
        <footer className="statusbar">
          <span className="st-left">
            {currentIndex >= 0 ? `Page ${currentIndex + 1} of ${doc.pages.length}` : `${doc.pages.length} pages`}
            {' · '}
            {doc.anns.length} mark{doc.anns.length === 1 ? '' : 's'}
            {' · '}
            tool: <b>{tool}</b>
            {tool === 'edit' && (
              <button className="mini-btn ocr-mini" disabled={!!ocrBusy} onClick={() => void runOcrOnCurrent()}>
                {ocrBusy ? '…' : '⇪ OCR page'}
              </button>
            )}
          </span>
          <span className="st-right">
            <span className="privacy-chip">● private · nothing leaves this device</span>
            <button className="mini-btn" onClick={() => setZoom((z) => Math.max(20, Math.round(z * 0.8)))} title="Zoom out">
              −
            </button>
            <button className="mini-btn pct" onClick={() => setZoom(100)} title="Fit to width (0)">
              {Math.round(zoom)}%
            </button>
            <button className="mini-btn" onClick={() => setZoom((z) => Math.min(400, Math.round(z * 1.25)))} title="Zoom in">
              +
            </button>
          </span>
        </footer>
      )}

      {/* hidden file inputs */}
      <input
        ref={openInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openFile(f);
        }}
      />
      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void mergeFile(f);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onImageChosen(f);
        }}
      />

      {modal === 'export' && (
        <ExportDialog fileName={doc.name} pageCount={doc.pages.length} meta={meta} onExport={(p) => void doExport(p)} onSplit={(p) => void doSplit(p)} onClose={() => setModal(null)} />
      )}
      {modal === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal === 'compare' && <CompareDialog onClose={() => setModal(null)} />}
      {modal === 'forms' && (
        <FormsDialog
          docName={doc.name}
          sources={doc.sources}
          pages={doc.pages}
          values={formValues}
          onChange={setFormValue}
          onJump={(i) => {
            const p = doc.pages[i];
            if (p) onGoTo(p.id);
          }}
          onExport={() => void exportFlattenedForms()}
          showOnPages={showFormWidgets}
          onToggleShow={(v) => setShowFormWidgets(v)}
          focusedField={focusedFormField}
          onClose={() => {
            setFocusedFormField(null);
            setModal(null);
          }}
        />
      )}
      {modal === 'ai' && <AIDialog docName={doc.name} getContext={gatherContext} onClose={() => setModal(null)} />}
      {signOpen && (
        <SignPadModal
          onSave={(dataUrl) => {
            const dims = new Image();
            dims.src = dataUrl;
            dims.onload = () => {
              const pending = pendingSpecial.current;
              if (pending) placeSpecialAt('sign', pending.pt, pending.pageId, dataUrl, dims.naturalWidth / dims.naturalHeight, 'signature');
              pendingSpecial.current = null;
            };
          }}
          onClose={() => {
            setSignOpen(false);
            pendingSpecial.current = null;
          }}
        />
      )}

      {busy && (
        <div className="busy-veil">
          <div className="busy-card">
            <span className="spinner" />
            {busy}
          </div>
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
