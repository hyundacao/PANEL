export const PLANNING_SAVE_JSON_LIMIT = 32 * 1024 * 1024;
export const PLANNING_SAVE_WIRE_LIMIT = 4_000_000;
const COMPRESSION_THRESHOLD = 256_000;

export class PlanningSaveTransportError extends Error {
  readonly code = 'PLANNING_PAYLOAD_TOO_LARGE';
}

export const encodePlanningSave = async (value: unknown) => {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > PLANNING_SAVE_JSON_LIMIT) throw new PlanningSaveTransportError();
  if (bytes.byteLength >= COMPRESSION_THRESHOLD && typeof CompressionStream !== 'undefined') {
    try {
      const compressed = await new Response(new Blob([bytes]).stream()
        .pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      if (compressed.byteLength < bytes.byteLength && compressed.byteLength <= PLANNING_SAVE_WIRE_LIMIT) {
        return { body: compressed, headers: { 'content-type': 'application/gzip' }, keepalive: compressed.byteLength < 60000 };
      }
    } catch {
      // Older browsers may expose CompressionStream without supporting gzip.
    }
  }
  if (bytes.byteLength > PLANNING_SAVE_WIRE_LIMIT) throw new PlanningSaveTransportError();
  return { body: json, headers: { 'content-type': 'application/json' }, keepalive: bytes.byteLength < 60000 };
};
