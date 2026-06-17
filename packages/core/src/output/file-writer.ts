import type { FormatSpec } from '../core/types.js';

/**
 * Encode the assembled output string to a byte-exact Buffer using the format's
 * declared encoding. `latin1` (1 byte/char) is critical: CRIF fixed-width byte
 * counts must not be inflated by multi-byte UTF-8.
 */
export function toBuffer(format: FormatSpec, text: string): Buffer {
  const enc: BufferEncoding = format.fileEncoding === 'ascii' ? 'ascii' : 'latin1';
  return Buffer.from(text, enc);
}
