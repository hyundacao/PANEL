import { fromBuffer } from 'yauzl';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 80 * 1024 * 1024;

export const assertImportRequest = (request: Request) => {
  const size = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(size) || size < 0 || size > 2 * MAX_IMPORT_BYTES + 65536) throw new Error('IMPORT_TOO_LARGE');
};

// Validate actual decompressed sizes with a streaming ZIP parser, before SheetJS.
export const assertSpreadsheetArchive = (bytes: Buffer): Promise<void> => new Promise((resolve, reject) => {
  fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) { reject(new Error('INVALID_IMPORT_ARCHIVE')); return; }
    let expanded = 0;
    let entries = 0;
    let finished = false;
    const fail = (reason: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      zip.close();
      reject(reason);
    };
    const timer = setTimeout(() => fail(new Error('IMPORT_TOO_LARGE')), 15000);
    zip.on('error', () => fail(new Error('INVALID_IMPORT_ARCHIVE')));
    zip.on('end', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      zip.close();
      resolve();
    });
    zip.on('entry', entry => {
      if (finished) return;
      if (++entries > 2000 || entry.isEncrypted() || entry.uncompressedSize > MAX_EXPANDED_BYTES - expanded) {
        fail(new Error('IMPORT_TOO_LARGE')); return;
      }
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) { fail(new Error('INVALID_IMPORT_ARCHIVE')); return; }
        stream.on('error', () => fail(new Error('INVALID_IMPORT_ARCHIVE')));
        stream.on('data', (chunk: Buffer) => {
          expanded += chunk.length;
          if (expanded > MAX_EXPANDED_BYTES || finished) {
            stream.destroy();
            fail(new Error('IMPORT_TOO_LARGE'));
          }
        });
        stream.on('end', () => { if (!finished) zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
});

export const assertImportFile = async (file: File, extensions: string[]) => {
  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) throw new Error('IMPORT_TOO_LARGE');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!extensions.includes(extension)) throw new Error('INVALID_IMPORT_TYPE');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (extension === 'xlsx') await assertSpreadsheetArchive(bytes);
  if (extension === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('INVALID_IMPORT_TYPE');
};
