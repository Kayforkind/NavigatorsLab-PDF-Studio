import type { Action, Annotation, DocModel, DocState, PageRec, Source } from '../types';
import { uid } from '../types';

export const emptyModel: DocModel = {
  doc: { name: '', sources: [], pages: [], anns: [] },
  past: [],
  future: [],
};

function snapshotOf(doc: DocState) {
  return { pages: doc.pages, anns: doc.anns };
}

function pushHistory(m: DocModel): DocModel {
  const past = [...m.past, snapshotOf(m.doc)];
  if (past.length > 80) past.shift();
  return { ...m, past, future: [] };
}

/** Build PageRec[] for an opened/merged source. */
export function pagesForSource(source: Source, rot = 0): PageRec[] {
  return source.pages.map((p, i) => ({
    id: uid(),
    src: source.id,
    page: i,
    w: p.w,
    h: p.h,
    bx: p.bx ?? 0,
    by: p.by ?? 0,
    rot,
  }));
}

export function pageLabel(p: PageRec, index: number): string {
  return p.src === null ? `Blank ${index + 1}` : `Page ${index + 1}`;
}

export function docModelReducer(m: DocModel, action: Action): DocModel {
  switch (action.type) {
    case 'open': {
      return {
        doc: { name: action.name, sources: action.sources, pages: action.pages, anns: action.anns ? [...action.anns] : [] },
        past: [],
        future: [],
      };
    }
    case 'merge': {
      if (action.pages.length === 0) return m;
      const next = pushHistory(m);
      const { pages } = next.doc;
      const after = action.afterPageId ? pages.findIndex((p) => p.id === action.afterPageId) : pages.length - 1;
      const idx = after >= 0 ? after + 1 : pages.length;
      return {
        ...next,
        doc: {
          ...next.doc,
          sources: [...next.doc.sources, ...action.sources],
          pages: [...pages.slice(0, idx), ...action.pages, ...pages.slice(idx)],
        },
      };
    }
    case 'reorder': {
      const { pages } = m.doc;
      const from = pages.findIndex((p) => p.id === action.fromId);
      const to = pages.findIndex((p) => p.id === action.toId);
      if (from < 0 || to < 0 || from === to) return m;
      const next = [...pages];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...pushHistory(m), doc: { ...m.doc, pages: next } };
    }
    case 'rotate': {
      const pages = m.doc.pages.map((p) =>
        p.id === action.pageId ? { ...p, rot: (p.rot + (action.cw ? 90 : 270)) % 360 } : p,
      );
      return { ...pushHistory(m), doc: { ...m.doc, pages } };
    }
    case 'flipPage': {
      // flip in DISPLAY space: mirror the page content and re-anchor annotations
      // into the mirrored coordinate system so their visual position is stable.
      const bit = action.mode === 'h' ? 1 : 2;
      const pages = m.doc.pages.map((p) => (p.id === action.pageId ? { ...p, flip: ((p.flip ?? 0) ^ bit) & 3 } : p));
      const page = m.doc.pages.find((p) => p.id === action.pageId);
      let anns = m.doc.anns;
      if (page) {
        anns = m.doc.anns.map((a) => {
          if (a.pageId !== action.pageId) return a;
          if (action.mode === 'h') {
            if (a.type === 'ink') return { ...a, pts: a.pts.map((q) => ({ x: 2 * page.bx + page.w - q.x, y: q.y })) } as typeof a;
            if ('x' in a) {
              const nx = 2 * page.bx + page.w - (a.x as number) - (('w' in a ? (a.w as number) : 0) as number);
              return { ...a, x: nx } as typeof a;
            }
            return a;
          }
          // vertical flip
          if (a.type === 'ink') return { ...a, pts: a.pts.map((q) => ({ x: q.x, y: 2 * page.by + page.h - q.y })) } as typeof a;
          if ('y' in a) {
            const ny = 2 * page.by + page.h - (a.y as number) - (('h' in a ? (a.h as number) : 0) as number);
            return { ...a, y: ny } as typeof a;
          }
          return a;
        });
      }
      return { ...pushHistory(m), doc: { ...m.doc, pages, anns } };
    }
    case 'setPageRots': {
      const pages = m.doc.pages.map((p) => (action.rots[p.id] !== undefined ? { ...p, rot: action.rots[p.id] } : p));
      return { ...pushHistory(m), doc: { ...m.doc, pages } };
    }
    case 'deletePage': {
      const pages = m.doc.pages.filter((p) => p.id !== action.pageId);
      const anns = m.doc.anns.filter((a) => a.pageId !== action.pageId);
      return { ...pushHistory(m), doc: { ...m.doc, pages, anns } };
    }
    case 'duplicatePage': {
      const srcPage = m.doc.pages.find((p) => p.id === action.pageId);
      if (!srcPage) return m;
      const pages = [...m.doc.pages];
      const idx = pages.findIndex((p) => p.id === action.pageId);
      pages.splice(idx + 1, 0, { ...srcPage, id: uid(), bx: srcPage.src ? srcPage.bx : 0, by: srcPage.src ? srcPage.by : 0 });
      return { ...pushHistory(m), doc: { ...m.doc, pages } };
    }
    case 'insertBlank': {
      const pages = [...m.doc.pages];
      const after = action.afterPageId ? pages.findIndex((p) => p.id === action.afterPageId) : pages.length - 1;
      const blank: PageRec = {
        id: uid(),
        src: null,
        page: null,
        w: action.w,
        h: action.h,
        bx: 0,
        by: 0,
        rot: 0,
      };
      pages.splice(after + 1, 0, blank);
      return { ...pushHistory(m), doc: { ...m.doc, pages } };
    }
    case 'annAdd': {
      return { ...pushHistory(m), doc: { ...m.doc, anns: [...m.doc.anns, action.ann] } };
    }
    case 'annUpd': {
      const anns = m.doc.anns.map((a) => (a.id === action.id ? ({ ...a, ...action.patch } as Annotation) : a));
      return { ...pushHistory(m), doc: { ...m.doc, anns } };
    }
    case 'annDel': {
      const anns = m.doc.anns.filter((a) => a.id !== action.id);
      return { ...pushHistory(m), doc: { ...m.doc, anns } };
    }
    case 'undo': {
      if (m.past.length === 0) return m;
      const prev = m.past[m.past.length - 1];
      return {
        doc: { ...m.doc, pages: prev.pages, anns: prev.anns },
        past: m.past.slice(0, -1),
        future: [snapshotOf(m.doc), ...m.future],
      };
    }
    case 'redo': {
      if (m.future.length === 0) return m;
      const next = m.future[0];
      return {
        doc: { ...m.doc, pages: next.pages, anns: next.anns },
        past: [...m.past, snapshotOf(m.doc)],
        future: m.future.slice(1),
      };
    }
    default:
      return m;
  }
}
