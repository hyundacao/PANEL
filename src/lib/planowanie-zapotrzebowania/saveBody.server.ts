import { gunzipSync } from 'node:zlib';
import { PLANNING_SAVE_JSON_LIMIT, PLANNING_SAVE_WIRE_LIMIT } from './saveTransport';

export class PlanningSaveBodyError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export const readPlanningSaveBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers?.get('content-type')?.split(';')[0].trim();
  // Existing tabs and older clients continue to send ordinary JSON.
  if (contentType !== 'application/gzip') return request.json();
  if (Number(request.headers.get('content-length')) > PLANNING_SAVE_WIRE_LIMIT) {
    throw new PlanningSaveBodyError('PLANNING_PAYLOAD_TOO_LARGE', 413);
  }
  if (!request.body) throw new PlanningSaveBodyError('INVALID_JSON', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PLANNING_SAVE_WIRE_LIMIT) {
        await reader.cancel();
        throw new PlanningSaveBodyError('PLANNING_PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const expanded = gunzipSync(Buffer.concat(chunks), { maxOutputLength: PLANNING_SAVE_JSON_LIMIT });
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(expanded));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new PlanningSaveBodyError('PLANNING_PAYLOAD_TOO_LARGE', 413);
    }
    throw new PlanningSaveBodyError('INVALID_JSON', 400);
  }
};
