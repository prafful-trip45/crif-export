import type { FormatId, FormatSpec } from '../core/types.js';
import { commercialUcrfFlat, commercialUcrfFlatV310 } from './commercial-ucrf-flat.js';
import { consumerUcrf12Flat } from './consumer-ucrf12-flat.js';
import { consumerUcrf12 } from './consumer-ucrf12.js';
import { mfiCdf } from './mfi-cdf.js';

/** Registry of all supported bureau formats, keyed by id. */
export const FORMATS: Record<FormatId, FormatSpec> = {
  'commercial-ucrf-flat-v310': commercialUcrfFlatV310,
  'commercial-ucrf-flat': commercialUcrfFlat,
  'mfi-cdf': mfiCdf,
  'consumer-tudf': consumerUcrf12,
  'consumer-ucrf12': consumerUcrf12,
  'consumer-ucrf12-flat': consumerUcrf12Flat,
} as Record<FormatId, FormatSpec>;

export function getFormat(id: FormatId): FormatSpec {
  const spec = FORMATS[id];
  if (!spec) throw new Error(`Unknown format: ${id}`);
  return spec;
}

/** UI-friendly list of available formats for dropdowns. */
export function listFormats(): Array<{ id: FormatId; label: string; version: string }> {
  const seen = new Set<string>();
  const list: Array<{ id: FormatId; label: string; version: string }> = [];
  for (const [id, f] of Object.entries(FORMATS)) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    list.push({ id: id as FormatId, label: f.label, version: f.version });
  }
  return list;
}
