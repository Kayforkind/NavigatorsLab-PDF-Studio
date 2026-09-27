import { describe, expect, it } from 'vitest';
import { clampCompress, COMPRESS_PRESETS } from './compress';
import { TOOL_SHORTCUTS } from '../components/ToolRail';

describe('compress presets', () => {
  it('clamps out-of-range options into sane bounds', () => {
    expect(clampCompress({ maxSide: 99999, quality: 99 })).toEqual({ maxSide: 4000, quality: 0.95 });
    expect(clampCompress({ maxSide: 10, quality: 0.01 })).toEqual({ maxSide: 400, quality: 0.3 });
    expect(clampCompress({ maxSide: 1500, quality: 0.7 })).toEqual({ maxSide: 1500, quality: 0.7 });
  });

  it('ships high/medium/low presets within clamp bounds', () => {
    for (const p of Object.values(COMPRESS_PRESETS)) {
      expect(clampCompress(p.opts)).toEqual(p.opts);
    }
  });
});

describe('tool shortcuts', () => {
  it('maps every declared rail key to a tool, with no duplicate keys', () => {
    const keys = Object.keys(TOOL_SHORTCUTS);
    expect(keys.length).toBeGreaterThan(10);
    expect(new Set(keys).size).toBe(keys.length);
    // spot-check the headline tools
    expect(TOOL_SHORTCUTS['v']).toBe('select');
    expect(TOOL_SHORTCUTS['t']).toBe('text');
    expect(TOOL_SHORTCUTS['h']).toBe('highlight');
    expect(TOOL_SHORTCUTS['b']).toBe('redact');
    expect(TOOL_SHORTCUTS['f']).toBe('formtext');
  });
});
