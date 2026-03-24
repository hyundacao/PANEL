import {
  normalizeOriginalInventoryName,
  normalizeOriginalInventoryNameKey
} from '@/lib/utils/originalInventoryName';

export type OriginalInventoryErpPdfItem = {
  name: string;
  realQty: number;
  availableQty: number;
  unit: string;
};

type PdfObject = {
  body: string;
  stream?: Uint8Array;
};

type PdfFont = {
  cmap: Map<number, string>;
  widths: Map<number, number>;
};

type PdfTextSegment = {
  x: number;
  y: number;
  text: string;
};

const PDF_EXTENSION = '.pdf';
const PDF_ROW_MIN_Y = 175;
const PDF_ROW_CODE_MAX_X = 60;
const PDF_NAME_MIN_X = 170;
const PDF_NAME_MAX_X = 440;
const PDF_UNIT_MIN_X = 440;
const PDF_UNIT_MAX_X = 485;
const PDF_REAL_MIN_X = 520;
const PDF_REAL_MAX_X = 620;
const PDF_AVAILABLE_MIN_X = 680;
const PDF_AVAILABLE_MAX_X = 740;
const PDF_AVAILABLE_FALLBACK_MIN_X = 600;

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizePdfName = (value: string) =>
  normalizeOriginalInventoryName(
    value
      .replace(/\s+Objętość:.*$/i, '')
      .replace(/\s+Graffiti\.ERP.*$/i, '')
  );

const normalizeNameKey = (value: unknown) => normalizeOriginalInventoryNameKey(value);

const parseSnapshotQty = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = normalizeImportCell(value).replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isQtyText = (value: string) => /[\d]/.test(value);

const getPdfFileName = (file: File) => file.name.trim().toLowerCase();

export const isOriginalInventoryErpSnapshotPdfFile = (file: File) =>
  file.type === 'application/pdf' || getPdfFileName(file).endsWith(PDF_EXTENSION);

const inflatePdfStream = async (bytes: Uint8Array) => {
  const chunk = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
};

const parsePdfObjects = async (bytes: Uint8Array) => {
  const text = new TextDecoder('latin1').decode(bytes);
  const objects = new Map<number, PdfObject>();
  const objectRegex = /(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(text))) {
    const objectId = Number(match[1]);
    const fullText = match[0];
    const body = match[2];
    const objectStart = match.index;
    const streamMarker = fullText.indexOf('stream');

    let stream: Uint8Array | undefined;
    if (streamMarker >= 0) {
      let streamStart = objectStart + streamMarker + 'stream'.length;
      if (text[streamStart] === '\r' && text[streamStart + 1] === '\n') {
        streamStart += 2;
      } else if (text[streamStart] === '\n') {
        streamStart += 1;
      }
      const streamEnd = objectStart + fullText.lastIndexOf('endstream');
      let rawStream = bytes.slice(streamStart, streamEnd);
      while (
        rawStream.length > 0 &&
        (rawStream[rawStream.length - 1] === 0x0a || rawStream[rawStream.length - 1] === 0x0d)
      ) {
        rawStream = rawStream.slice(0, rawStream.length - 1);
      }
      stream = body.includes('/FlateDecode') ? await inflatePdfStream(rawStream) : rawStream;
    }

    objects.set(objectId, { body, stream });
  }

  return objects;
};

const parsePdfWidths = (body: string) => {
  const widthMatch = body.match(/\[([\s\S]*)\]/);
  if (!widthMatch) return new Map<number, number>();
  const numbers = Array.from(widthMatch[1].matchAll(/-?\d+(?:\.\d+)?/g), (match) =>
    Number(match[0])
  );
  const widths = new Map<number, number>();
  for (let index = 0; index + 2 < numbers.length; index += 3) {
    const from = Math.trunc(numbers[index]);
    const to = Math.trunc(numbers[index + 1]);
    const width = numbers[index + 2];
    for (let code = from; code <= to; code += 1) {
      widths.set(code, width);
    }
  }
  return widths;
};

const parsePdfCmap = (stream: Uint8Array | undefined) => {
  const cmap = new Map<number, string>();
  if (!stream) return cmap;
  const text = new TextDecoder('latin1').decode(stream);
  const regex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match[1].length !== 4 || match[2].length !== 4) continue;
    cmap.set(Number.parseInt(match[1], 16), String.fromCharCode(Number.parseInt(match[2], 16)));
  }
  return cmap;
};

const decodePdfHexText = (hexText: string, font: PdfFont) => {
  let result = '';
  let advance = 0;
  for (let index = 0; index < hexText.length; index += 4) {
    const rawCode = hexText.slice(index, index + 4);
    if (rawCode.length < 4) continue;
    const code = Number.parseInt(rawCode, 16);
    result += font.cmap.get(code) ?? '';
    advance += font.widths.get(code) ?? 500;
  }
  return { text: result, advance };
};

const parsePdfTextArraySegments = (
  arrayContent: string,
  font: PdfFont,
  startX: number,
  fontSize: number
) => {
  const segments: PdfTextSegment[] = [];
  const splitDelta = Math.max(fontSize * 0.8, 8);
  let x = startX;
  let segmentStartX = startX;
  let segmentText = '';

  const pushSegment = () => {
    const normalized = normalizeImportCell(segmentText);
    if (normalized) {
      segments.push({ x: segmentStartX, y: 0, text: normalized });
    }
    segmentText = '';
  };

  const tokenRegex = /<([0-9A-Fa-f]+)>|(-?\d+(?:\.\d+)?)/g;
  let token: RegExpExecArray | null;
  while ((token = tokenRegex.exec(arrayContent))) {
    if (token[1]) {
      const decoded = decodePdfHexText(token[1], font);
      segmentText += decoded.text;
      x += (decoded.advance * fontSize) / 1000;
      continue;
    }

    const adjustment = Number(token[2]);
    const delta = (-adjustment * fontSize) / 1000;
    if (Math.abs(delta) > splitDelta) {
      pushSegment();
      segmentStartX = x + delta;
    }
    x += delta;
  }

  pushSegment();
  return segments;
};

const extractPdfTextSegments = async (bytes: Uint8Array) => {
  const objects = await parsePdfObjects(bytes);
  const fonts = new Map<number, PdfFont>();

  objects.forEach((object, objectId) => {
    if (!object.body.includes('/Subtype /Type0')) return;
    const toUnicodeMatch = object.body.match(/\/ToUnicode (\d+) 0 R/);
    const widthsMatch = object.body.match(/\/W (\d+) 0 R/);
    if (!toUnicodeMatch || !widthsMatch) return;
    const cmapObject = objects.get(Number(toUnicodeMatch[1]));
    const widthsObject = objects.get(Number(widthsMatch[1]));
    if (!cmapObject || !widthsObject) return;
    fonts.set(objectId, {
      cmap: parsePdfCmap(cmapObject.stream),
      widths: parsePdfWidths(widthsObject.body)
    });
  });

  const segments: PdfTextSegment[] = [];
  const pageEntries: Array<{ resourcesId: number; contentIds: number[] }> = [];

  objects.forEach((object) => {
    if (!object.body.includes('/Type /Page')) return;
    const resourcesMatch = object.body.match(/\/Resources (\d+) 0 R/);
    const contentsMatch = object.body.match(/\/Contents \[([^\]]+)\]/);
    if (!resourcesMatch || !contentsMatch) return;
    pageEntries.push({
      resourcesId: Number(resourcesMatch[1]),
      contentIds: Array.from(contentsMatch[1].matchAll(/(\d+) 0 R/g), (match) => Number(match[1]))
    });
  });

  for (const [pageIndex, page] of pageEntries.entries()) {
    const resourcesObject = objects.get(page.resourcesId);
    if (!resourcesObject) continue;
    const pageYOffset = pageIndex * 2000;

    const pageFonts = new Map<string, PdfFont>();
    const fontSection = resourcesObject.body.match(/\/Font <<([\s\S]*?)>>/);
    if (fontSection) {
      for (const match of fontSection[1].matchAll(/\/(F\d+) (\d+) 0 R/g)) {
        const font = fonts.get(Number(match[2]));
        if (font) {
          pageFonts.set(match[1], font);
        }
      }
    }

    for (const contentId of page.contentIds) {
      const contentObject = objects.get(contentId);
      if (!contentObject?.stream) continue;
      const content = new TextDecoder('latin1').decode(contentObject.stream);
      const tokenRegex =
        /\/(F\d+)\s+([0-9.]+)\s+Tf|([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s+([0-9.\-]+)\s+Tm|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f]+)>\s*Tj/g;
      let currentFont: PdfFont | null = null;
      let currentFontSize = 0;
      let currentX = 0;
      let currentY = 0;
      let token: RegExpExecArray | null;

      while ((token = tokenRegex.exec(content))) {
        if (token[1]) {
          currentFont = pageFonts.get(token[1]) ?? null;
          currentFontSize = Number(token[2]);
          continue;
        }

        if (token[7]) {
          currentX = Number(token[7]);
          currentY = Number(token[8]);
          continue;
        }

        if (!currentFont || currentFontSize <= 0) continue;

        if (token[9] !== undefined) {
          const parsedSegments = parsePdfTextArraySegments(
            token[9],
            currentFont,
            currentX,
            currentFontSize
          );
          parsedSegments.forEach((segment) => {
            segments.push({ ...segment, y: currentY + pageYOffset });
          });
          continue;
        }

        if (token[10]) {
          const decoded = decodePdfHexText(token[10], currentFont).text;
          const normalized = normalizeImportCell(decoded);
          if (normalized) {
            segments.push({ x: currentX, y: currentY + pageYOffset, text: normalized });
          }
        }
      }
    }
  }

  return segments;
};

const buildPdfSnapshotRows = (segments: PdfTextSegment[]) => {
  const rowAnchors = segments
    .filter(
      (segment) =>
        segment.x <= PDF_ROW_CODE_MAX_X &&
        segment.y >= PDF_ROW_MIN_Y &&
        isQtyText(segment.text)
    )
    .sort((left, right) => left.y - right.y)
    .reduce<number[]>((accumulator, segment) => {
      const last = accumulator[accumulator.length - 1];
      if (last === undefined || Math.abs(last - segment.y) > 1) {
        accumulator.push(segment.y);
      }
      return accumulator;
    }, []);

  return rowAnchors.map((anchorY, index) => {
    const nextAnchorY = rowAnchors[index + 1] ?? Number.POSITIVE_INFINITY;
    const rowMaxY = Math.min(nextAnchorY - 0.5, anchorY + 40);
    const rowSegments = segments
      .filter((segment) => segment.y >= anchorY - 0.5 && segment.y < rowMaxY)
      .sort((left, right) => (left.y === right.y ? left.x - right.x : left.y - right.y));
    const numericSegments = rowSegments.filter((segment) => isQtyText(segment.text));

    const name = sanitizePdfName(
      rowSegments
        .filter((segment) => segment.x >= PDF_NAME_MIN_X && segment.x < PDF_NAME_MAX_X)
        .map((segment) => segment.text)
        .join(' ')
    );
    const unit =
      normalizeImportCell(
        rowSegments.find(
          (segment) =>
            segment.x >= PDF_UNIT_MIN_X &&
            segment.x < PDF_UNIT_MAX_X &&
            /[a-zA-Z]/.test(segment.text)
        )?.text
      ) || 'kg';
    const realQtySegment = numericSegments.find(
      (segment) => segment.x >= PDF_REAL_MIN_X && segment.x < PDF_REAL_MAX_X
    );
    const availableQtySegment =
      numericSegments.find((segment) => segment.x >= PDF_AVAILABLE_MIN_X && segment.x < PDF_AVAILABLE_MAX_X) ??
      numericSegments
        .filter(
          (segment) =>
            segment.x >= PDF_AVAILABLE_FALLBACK_MIN_X &&
            segment.x < PDF_AVAILABLE_MIN_X &&
            (!realQtySegment || segment.x > realQtySegment.x + 30)
        )
        .at(-1);
    const realQty = parseSnapshotQty(realQtySegment?.text);
    const availableQty = parseSnapshotQty(availableQtySegment?.text);

    return {
      name,
      unit,
      realQty,
      availableQty
    };
  });
};

export const parseOriginalInventoryErpSnapshotPdfFile = async (
  file: File
): Promise<OriginalInventoryErpPdfItem[]> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const segments = await extractPdfTextSegments(bytes);
  const rows = buildPdfSnapshotRows(segments);
  const merged = new Map<string, OriginalInventoryErpPdfItem>();

  rows.forEach((row) => {
    if (!row.name || row.realQty === null || row.availableQty === null) return;
    const key = normalizeNameKey(row.name);
    const existing = merged.get(key);
    if (existing) {
      existing.realQty += row.realQty;
      existing.availableQty += row.availableQty;
      if (!existing.unit && row.unit) {
        existing.unit = row.unit;
      }
      return;
    }

    merged.set(key, {
      name: row.name,
      realQty: row.realQty,
      availableQty: row.availableQty,
      unit: row.unit || 'kg'
    });
  });

  return [...merged.values()];
};
