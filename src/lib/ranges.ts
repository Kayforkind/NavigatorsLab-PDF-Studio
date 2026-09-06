/** Parse a user "range" string like "1-3,5" into zero-based sorted indices. */
export function parseRanges(spec: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const t = part.trim();
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= pageCount) out.add(i - 1);
    } else if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n >= 1 && n <= pageCount) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

