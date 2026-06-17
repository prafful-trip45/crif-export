import type { FormatId, FormatSpec } from '../core/types.js';
import { commercialUcrf } from './commercial-ucrf.js';
import { mfiCdf } from './mfi-cdf.js';

/** Registry of all supported bureau formats, keyed by id. */
export const FORMATS: Record<FormatId, FormatSpec> = {
  'commercial-ucrf': commercialUcrf,
  'mfi-cdf': mfiCdf,
  // 'consumer-ucrf12' registered in M3.
} as Record<FormatId, FormatSpec>;

export function getFormat(id: FormatId): FormatSpec {
  const spec = FORMATS[id];
  if (!spec) throw new Error(`Unknown format: ${id}`);
  return spec;
}

/** UI-friendly list of available formats for dropdowns. */
export function listFormats(): Array<{ id: FormatId; label: string; version: string }> {
  return Object.values(FORMATS).map((f) => ({ id: f.id, label: f.label, version: f.version }));
}
