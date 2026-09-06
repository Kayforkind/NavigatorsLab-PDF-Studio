import { describe, expect, it } from 'vitest';
import { docModelReducer, emptyModel, pagesForSource } from './docModel';
import type { Annotation, DocModel, PageRec, Source } from '../types';

function src(pages = 3): Source {
  return {
    id: 's1',
    name: 't.pdf',
    bytes: new Uint8Array([1]),
    pages: Array.from({ length: pages }, () => ({ w: 612, h: 792, bx: 0, by: 0, rot: 0 })),
  };
}

function openDoc(n = 3): { model: DocModel; pages: PageRec[]; source: Source } {
  const source = src(n);
  const pages = pagesForSource(source);
  return {
    source,
    pages,
    model: docModelReducer(emptyModel, { type: 'open', name: 't.pdf', sources: [source], pages }),
  };
}

const ann = (id: string, pageId: string): Annotation => ({
  id,
  pageId,
  type: 'note',
  x: 10,
  y: 10,
  text: '',
  color: '#ffd43b',
  n: 1,
});

describe('docModel', () => {
  it('opens a source into ordered pages', () => {
    const { model } = openDoc(4);
    expect(model.doc.pages).toHaveLength(4);
    expect(model.past).toHaveLength(0);
  });

  it('undoes and redoes page ops and annotations', () => {
    const { model, pages } = openDoc();
    const m1 = docModelReducer(model, { type: 'rotate', pageId: pages[0].id, cw: true });
    expect(m1.doc.pages[0].rot).toBe(90);
    const m2 = docModelReducer(m1, { type: 'annAdd', ann: ann('a1', pages[1].id) });
    expect(m2.doc.anns).toHaveLength(1);
    // undo the annotation first, then the rotation (one history step each)
    const u1 = docModelReducer(m2, { type: 'undo' });
    expect(u1.doc.anns).toHaveLength(0);
    expect(u1.doc.pages[0].rot).toBe(90);
    const u2 = docModelReducer(u1, { type: 'undo' });
    expect(u2.doc.pages[0].rot).toBe(0);
    const r = docModelReducer(u2, { type: 'redo' });
    expect(r.doc.pages[0].rot).toBe(90);
  });

  it('deleting a page removes its annotations only', () => {
    const { model, pages } = openDoc();
    let m = docModelReducer(model, { type: 'annAdd', ann: ann('a1', pages[0].id) });
    m = docModelReducer(m, { type: 'annAdd', ann: ann('a2', pages[1].id) });
    m = docModelReducer(m, { type: 'deletePage', pageId: pages[0].id });
    expect(m.doc.pages).toHaveLength(2);
    expect(m.doc.anns.map((a) => a.id)).toEqual(['a2']);
  });

  it('reorders pages and duplicates content pages', () => {
    const { model, pages } = openDoc(3);
    const ids = pages.map((p) => p.id);
    const m1 = docModelReducer(model, { type: 'reorder', fromId: ids[2], toId: ids[0] });
    expect(m1.doc.pages[0].id).toBe(ids[2]);
    const m2 = docModelReducer(m1, { type: 'duplicatePage', pageId: ids[0] });
    expect(m2.doc.pages).toHaveLength(4);
    // duplicate is inserted right after the original (which now sits at index 1)
    expect(m2.doc.pages[2].id).not.toBe(ids[0]);
    expect(m2.doc.pages[2].src).toBe('s1');
    expect(m2.doc.pages[2].page).toBe(0);
  });

  it('inserts blanks after a given page and merges after current', () => {
    const { model, pages } = openDoc(3);
    const m1 = docModelReducer(model, { type: 'insertBlank', afterPageId: pages[0].id, w: 612, h: 792 });
    expect(m1.doc.pages[1].src).toBeNull();
    // merging a second source places pages after the current page (default last)
    const s2 = src(2);
    s2.id = 's2';
    const m2 = docModelReducer(m1, {
      type: 'merge',
      sources: [s2],
      pages: pagesForSource(s2),
      afterPageId: null,
    });
    expect(m2.doc.pages).toHaveLength(6);
    expect(m2.doc.sources.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('setPageRots re-encodes rotation once (single history entry)', () => {
    const { model, pages } = openDoc();
    const m1 = docModelReducer(model, { type: 'setPageRots', rots: { [pages[0].id]: 270, [pages[2].id]: 90 } });
    expect(m1.doc.pages[0].rot).toBe(270);
    expect(m1.doc.pages[2].rot).toBe(90);
    expect(m1.past).toHaveLength(1);
    const back = docModelReducer(m1, { type: 'undo' });
    expect(back.doc.pages[0].rot).toBe(0);
  });
});
