import type { NotebookCellOutput } from 'vscode';

export const DEFAULT_OUTPUT_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface CellOutput {
  outputType: string; mimeType: string; data: string; encoding: 'text' | 'base64';
  byteLength: number; returnedBytes: number; truncated: boolean;
}

function isText(mime: string): boolean {
  return mime.startsWith('text/') || /(?:json|xml|javascript)(?:;|$)/.test(mime)
    || mime.startsWith('application/vnd.code.notebook.') || mime.startsWith('application/x.notebook.stream.');
}

/** Limits encoded payload bytes across the read; never emits partial binary data. */
export function serializeOutputs(outputs: readonly NotebookCellOutput[], maxBytes = DEFAULT_OUTPUT_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OUTPUT_BYTES) {
    throw new Error(`max_bytes must be an integer between 1 and ${MAX_OUTPUT_BYTES}.`);
  }
  let remaining = maxBytes;
  let totalBytes = 0;
  let returnedBytes = 0;
  let truncated = false;
  const groups: Array<{ output_index: number; items: CellOutput[] }> = [];
  let descriptors = 0;
  for (let outputIndex = 0; outputIndex < Math.min(outputs.length, 1000); outputIndex++) {
    const output = outputs[outputIndex];
    const items: CellOutput[] = [];
    for (const item of output.items) {
      if (descriptors++ >= 1000) { truncated = true; break; }
      const bytes = Buffer.from(item.data.buffer, item.data.byteOffset, item.data.byteLength);
      totalBytes += bytes.length;
      const encoding = isText(item.mime) ? 'text' : 'base64';
      const encodedSize = encoding === 'text' ? bytes.length : 4 * Math.ceil(bytes.length / 3);
      let data = encoding === 'text'
        ? new TextDecoder().decode(bytes.subarray(0, remaining), { stream: bytes.length > remaining })
        : encodedSize <= remaining ? bytes.toString('base64') : '';
      while (Buffer.byteLength(data) > remaining) { data = data.slice(0, -1); }
      const size = Buffer.byteLength(data);
      const omitted = encoding === 'text' ? bytes.length > size : encodedSize > size;
      truncated ||= omitted;
      remaining -= size;
      returnedBytes += size;
      items.push({ outputType: item.mime === 'application/vnd.code.notebook.error' ? 'error'
        : String(output.metadata?.outputType ?? 'unknown'), mimeType: item.mime, data, encoding,
      byteLength: bytes.length, returnedBytes: size, truncated: omitted });
    }
    groups.push({ output_index: outputIndex, items });
    if (descriptors >= 1000) { truncated ||= outputIndex < outputs.length - 1; break; }
  }
  const descriptorsLimited = descriptors >= 1000 || outputs.length > 1000;
  return { outputs: groups, total_bytes: totalBytes, total_bytes_complete: !descriptorsLimited,
    returned_bytes: returnedBytes, truncated: truncated || descriptorsLimited,
    descriptors_limited: descriptorsLimited, max_bytes: maxBytes };
}

export function imageContent(groups: Array<{ items: CellOutput[] }>) {
  return groups.flatMap(group => group.items.filter(item => IMAGE_MIMES.has(item.mimeType)
    && item.encoding === 'base64' && !item.truncated && item.data.length > 0)
    .map(item => ({ type: 'image' as const, data: item.data, mimeType: item.mimeType })));
}
