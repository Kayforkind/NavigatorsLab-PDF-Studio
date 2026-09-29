/**
 * Minimal ambient types for pngjs (it ships no .d.ts). Only the surface we
 * use is declared: synchronous PNG decode of a complete PNG byte buffer.
 */
declare module 'pngjs' {
  export class PNG {
    width: number;
    height: number;
    /** RGBA pixel data, normalized by pngjs regardless of source color type. */
    data: Uint8Array;
    static sync: {
      read(buffer: Uint8Array): { width: number; height: number; data: Uint8Array };
    };
  }
}
