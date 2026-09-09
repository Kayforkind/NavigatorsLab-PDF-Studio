import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageRec } from '../types';
import { beginRender } from '../lib/pdfio';
import { Icon } from './icons';

export interface ThumbsProps {
  pages: PageRec[];
  proxies: ReadonlyMap<string, PDFDocumentProxy>;
  currentId: string | null;
  /** total display rotation for a page (intrinsic + user) */
  rotationFor: (p: PageRec) => number;
  onGoTo: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onRotate: (id: string, cw: boolean) => void;
  onFlip: (id: string, mode: 'h' | 'v') => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onInsertBlank: (afterId: string) => void;
  onAddBlankAtEnd: () => void;
}

function Thumb({
  page,
  index,
  proxy,
  rotation,
  isCurrent,
  onGoTo,
  onReorder,
  onRotate,
  onFlip,
  onDelete,
  onDuplicate,
  onInsertBlank,
}: {
  page: PageRec;
  index: number;
  proxy: PDFDocumentProxy | null;
  rotation: number;
  isCurrent: boolean;
  onGoTo: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onRotate: (id: string, cw: boolean) => void;
  onFlip: (id: string, mode: 'h' | 'v') => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onInsertBlank: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);
  const genRef = useRef(0);
  const [ready, setReady] = useState(false);
  const dragId = useRef<string | null>(null);
  const isBlank = page.src === null;
  const rot = isBlank ? 0 : rotation;
  const flip = isBlank ? 0 : (page.flip ?? 0);

  const effW = rot % 180 === 90 ? page.h : page.w;
  const effH = rot % 180 === 90 ? page.w : page.h;
  const thumbW = 100;
  const thumbH = Math.max(46, Math.round((thumbW * effH) / effW));

  useEffect(() => {
    if (isBlank) {
      setReady(true);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !proxy || page.page === null) return;
    const gen = ++genRef.current;
    const pg = page.page;
    let alive = true;
    const scale = thumbW / effW;
    void (async () => {
      try {
        const prev = taskRef.current;
        if (prev) {
          try {
            await prev.cancel();
          } catch {
            /* done */
          }
          taskRef.current = null;
        }
        if (!alive || gen !== genRef.current) return;
        // page.page is 0-based; pdf.js getPage() is 1-based — the missing +1
        // made page 1 throw (blank thumb) and page N render page N-1.
        const pp = await proxy.getPage(pg + 1);
        if (!alive || gen !== genRef.current) return;
        const task = beginRender(canvas, pp, { scale, dpr: window.devicePixelRatio || 1, rotation: rot, flip });
        taskRef.current = task;
        await task.promise;
        if (taskRef.current === task) taskRef.current = null;
        if (alive && gen === genRef.current) setReady(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.page, page.id, proxy, rot, flip, effW, thumbW, thumbH]);

  return (
    <div
      className={`thumb ${isCurrent ? 'thumb-current' : ''}`}
      draggable
      onDragStart={(e) => {
        dragId.current = page.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', page.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = dragId.current ?? e.dataTransfer.getData('text/plain');
        dragId.current = null;
        if (from && from !== page.id) onReorder(from, page.id);
      }}
      onDragEnd={() => {
        dragId.current = null;
      }}
    >
      <div className="thumb-stage" onClick={() => onGoTo(page.id)}>
        <div className="thumb-num">
          {index + 1}
          {page.rot !== 0 && ` · ${page.rot}°`}
        </div>
        <div className="thumb-page" style={{ width: thumbW, height: thumbH }}>
          <canvas
            ref={canvasRef}
            style={{ width: thumbW, height: thumbH, display: isBlank || !ready ? 'none' : 'block' }}
          />
          {isBlank && <div className="thumb-blank">Blank</div>}
        </div>
      </div>
      <div className="thumb-actions">
        <button title="Insert blank page after" onClick={() => onInsertBlank(page.id)}>
          <Icon.plus />
        </button>
        <button title="Duplicate page" onClick={() => onDuplicate(page.id)}>
          <Icon.copy />
        </button>
        <button title="Rotate clockwise" disabled={page.src === null} onClick={() => onRotate(page.id, true)}>
          <Icon.rotateCw />
        </button>
        <button title="Mirror page horizontally" disabled={page.src === null} className={flip & 1 ? 'active' : ''} onClick={() => onFlip(page.id, 'h')}>
          ⇋
        </button>
        <button title="Mirror page vertically" disabled={page.src === null} className={flip & 2 ? 'active' : ''} onClick={() => onFlip(page.id, 'v')}>
          ⇵
        </button>
        <button title="Delete page" className="danger" onClick={() => onDelete(page.id)}>
          <Icon.trash />
        </button>
      </div>
    </div>
  );
}

export function ThumbStrip(props: ThumbsProps) {
  const { pages, proxies, rotationFor, onFlip } = props;
  return (
    <aside className="thumb-strip" aria-label="Pages">
      <div className="thumb-strip-head">
        <span>Pages</span>
        <b>{pages.length}</b>
      </div>
      <div className="thumb-list">
        {pages.map((p, i) => (
          <Thumb
            key={p.id}
            page={p}
            index={i}
            proxy={p.src ? (proxies.get(p.src) ?? null) : null}
            rotation={p.src ? rotationFor(p) : 0}
            isCurrent={p.id === props.currentId}
            onGoTo={props.onGoTo}
            onReorder={props.onReorder}
            onRotate={props.onRotate}
            onFlip={onFlip}
            onDelete={props.onDelete}
            onDuplicate={props.onDuplicate}
            onInsertBlank={props.onInsertBlank}
          />
        ))}
      </div>
      <button className="thumb-add" onClick={props.onAddBlankAtEnd}>
        <Icon.plus /> Add blank page
      </button>
    </aside>
  );
}
