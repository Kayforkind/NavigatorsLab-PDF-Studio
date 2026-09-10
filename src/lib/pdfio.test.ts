import { describe, expect, it } from 'vitest';
import { groupIntoLines, type RawTextItem } from './pdfio';

function item(str: string, x: number, y: number, w: number, size = 11): RawTextItem {
  return { str, x, y, w, size };
}

describe('groupIntoLines — table cells', () => {
  it('splits rows into per-cell hits at recurring column starts', () => {
    const items: RawTextItem[] = [
      // header row (y=700)
      item('Description', 50, 700, 90, 10),
      item('Qty', 400, 700, 20, 10),
      item('Rate', 460, 700, 30, 10),
      // data rows
      item('Design system', 50, 680, 80),
      item('1', 400, 680, 8),
      item('$3,200', 460, 680, 40),
      item('User research', 50, 660, 80),
      item('6', 400, 660, 8),
      item('$120', 460, 660, 30),
      item('Prototype', 50, 640, 60),
      item('2', 400, 640, 8),
      item('$90', 460, 640, 28),
    ];
    const hits = groupIntoLines(items);
    // every cell becomes its own hit — no row-level merges across columns
    const desc = hits.filter((h) => h.text.includes('Design'));
    expect(desc).toHaveLength(1);
    const descHit = desc[0];
    expect(descHit.text).toBe('Design system');
    expect(descHit.cell).toBe(false); // first column = left margin, not a cell
    // column 2+ cells are marked as cells with the gap recorded
    const qty = hits.find((h) => h.text === '1');
    expect(qty).toBeDefined();
    expect(qty!.cell).toBe(true);
    expect(qty!.gapBefore).toBeGreaterThan(200);
    // no hit contains text from two columns
    for (const h of hits) {
      expect(h.text).not.toContain('Design system1');
      expect(h.text).not.toMatch(/Design system\$3,200/);
    }
    // the y of every hit sits within its row band
    expect(descHit.y).toBeGreaterThan(660);
    expect(descHit.y).toBeLessThan(700);
  });

  it('splits a single wide run that spans two table columns', () => {
    // Some generators paint an entire row as ONE show-text operator (one wide
    // run); a separate cell item that recurs at x=330 in every row marks that
    // x as a table column boundary, so the wide run is cut there.
    const items: RawTextItem[] = [];
    for (const y of [700, 680, 660]) {
      items.push(item('Invoice #42  1', 50, y, 330, 11)); // wide run → cell 1
      items.push(item('Qty', 330, y, 20, 10)); // separate cell 2 (recurring)
    }
    items.push(item('Prose line below', 50, 640, 90, 11)); // prose (not a table)
    const hits = groupIntoLines(items);
    // the 3 wide runs are split at the x=330 boundary…
    const leftCells = hits.filter((h) => h.x < 100 && h.text.includes('Invoice #42'));
    expect(leftCells.length).toBe(3);
    expect(leftCells[0].text).toBe('Invoice #42');
    // …the right fragment carries the tail ("1") and the separate cell is
    // its own hit — never merged together
    const rightFrags = hits.filter((h) => h.x > 150 && h.text === '1');
    expect(rightFrags.length).toBe(3);
    const qtyCells = hits.filter((h) => h.text === 'Qty');
    expect(qtyCells.length).toBe(3);
    expect(qtyCells[0].cell).toBe(true);
    // the standalone prose line stays intact
    const prose = hits.find((h) => h.text === 'Prose line below');
    expect(prose).toBeDefined();
    expect(prose!.text).toBe('Prose line below');
  });

  it('keeps prose paragraphs as one hit', () => {
    const items: RawTextItem[] = [];
    for (let r = 0; r < 4; r++) {
      const y = 700 - r * 14;
      // prose: the continuation run starts right after the first — and its
      // start varies slightly per line (justified/wrapped text), so no
      // x-position recurs across rows the way table columns do
      const off = [0, 2, -2, 4][r];
      items.push(item('The quick brown fox', 50, y, 120, 11));
      items.push(item('jumps over the lazy', 170 + off, y, 110, 11));
    }
    const hits = groupIntoLines(items);
    // each line is one hit: same-baseline runs join, rows stay separate
    expect(hits).toHaveLength(4);
    expect(hits[0].text).toContain('The quick brown fox');
    expect(hits[0].text).toContain('jumps over the lazy');
    expect(hits[0].cell).toBe(false);
  });
});