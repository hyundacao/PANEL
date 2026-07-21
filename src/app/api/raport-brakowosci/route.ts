import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest, NextResponse } from 'next/server';
import { analyzeBrakowosc, getWorkbookSheets } from '@/lib/brakowosc/analyzer';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const latestReportId = 'latest';

const readFileBuffer = async (file: File | null) => {
  if (!file) return null;
  return Buffer.from(await file.arrayBuffer());
};

class SimpleDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | DOMMatrixInit) {
    if (Array.isArray(init)) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = [
        init[0] ?? 1,
        init[1] ?? 0,
        init[2] ?? 0,
        init[3] ?? 1,
        init[4] ?? 0,
        init[5] ?? 0
      ];
      return;
    }
    if (init) {
      this.a = init.a ?? init.m11 ?? this.a;
      this.b = init.b ?? init.m12 ?? this.b;
      this.c = init.c ?? init.m21 ?? this.c;
      this.d = init.d ?? init.m22 ?? this.d;
      this.e = init.e ?? init.m41 ?? this.e;
      this.f = init.f ?? init.m42 ?? this.f;
    }
  }

  get m11() {
    return this.a;
  }
  get m12() {
    return this.b;
  }
  get m21() {
    return this.c;
  }
  get m22() {
    return this.d;
  }
  get m41() {
    return this.e;
  }
  get m42() {
    return this.f;
  }

  multiplySelf(other: SimpleDOMMatrix | DOMMatrix) {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other: SimpleDOMMatrix | DOMMatrix) {
    const matrix = new SimpleDOMMatrix([other.a, other.b, other.c, other.d, other.e, other.f]);
    matrix.multiplySelf(this);
    this.a = matrix.a;
    this.b = matrix.b;
    this.c = matrix.c;
    this.d = matrix.d;
    this.e = matrix.e;
    this.f = matrix.f;
    return this;
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) {
      this.a = Number.NaN;
      this.b = Number.NaN;
      this.c = Number.NaN;
      this.d = Number.NaN;
      this.e = Number.NaN;
      this.f = Number.NaN;
      return this;
    }
    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  translate(x = 0, y = 0) {
    return new SimpleDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(x, y);
  }

  translateSelf(x = 0, y = 0) {
    return this.multiplySelf(new SimpleDOMMatrix([1, 0, 0, 1, x, y]));
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new SimpleDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(
      scaleX,
      scaleY
    );
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf(new SimpleDOMMatrix([scaleX, 0, 0, scaleY, 0, 0]));
  }
}

const ensurePdfDomPolyfills = () => {
  const globalWithDomMatrix = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
  };
  if (!globalWithDomMatrix.DOMMatrix) {
    globalWithDomMatrix.DOMMatrix = SimpleDOMMatrix as unknown as typeof DOMMatrix;
  }
};

const readPdfText = async (pdfBuffer: Buffer) => {
  ensurePdfDomPolyfills();
  const { PDFParse } = await import('pdf-parse');
  PDFParse.setWorker(
    pathToFileURL(
      path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
    ).toString()
  );
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const pdfData = await parser.getText();
    return pdfData.text;
  } finally {
    await parser.destroy();
  }
};

const readLatestReport = async () => {
  const { data, error } = await supabaseAdmin
    .from('raport_brakowosci_latest')
    .select('payload')
    .eq('id', latestReportId)
    .maybeSingle();

  if (error) {
    const missingTable =
      error.code === '42P01' || String(error.message ?? '').includes('raport_brakowosci_latest');
    if (missingTable) return null;
    throw error;
  }

  return data?.payload ?? null;
};

const writeLatestReport = async (payload: unknown) => {
  const { error } = await supabaseAdmin.from('raport_brakowosci_latest').upsert({
    id: latestReportId,
    payload,
    updated_at: new Date().toISOString()
  });

  if (error) {
    const missingTable =
      error.code === '42P01' || String(error.message ?? '').includes('raport_brakowosci_latest');
    if (missingTable) {
      throw new Error('Brakuje tabeli raport_brakowosci_latest. Uruchom migracje Supabase.');
    }
    throw error;
  }
};

export async function GET() {
  try {
    const latest = await readLatestReport();
    return NextResponse.json({ latest });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie pobrac raportu.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get('mesPdf');
    const excelFile = formData.get('brigadierExcel');
    const selectedSheet = String(formData.get('sheet') ?? '');

    if (!(pdfFile instanceof File) || !(excelFile instanceof File)) {
      return NextResponse.json(
        { error: 'Wgraj PDF MES i raport brygadzisty XLSX.' },
        { status: 400 }
      );
    }

    const pdfBuffer = await readFileBuffer(pdfFile);
    const excelBuffer = await readFileBuffer(excelFile);
    if (!pdfBuffer || !excelBuffer) {
      return NextResponse.json({ error: 'Nie udalo sie odczytac plikow.' }, { status: 400 });
    }

    const sheets = getWorkbookSheets(excelBuffer);
    if (!selectedSheet) {
      return NextResponse.json({ sheets, rows: [], summary: null });
    }

    const pdfText = await readPdfText(pdfBuffer);
    const analysis = analyzeBrakowosc({ pdfText, excelBuffer, selectedSheet });
    const latest = {
      ...analysis,
      selectedSheet,
      updatedAt: new Date().toISOString()
    };
    await writeLatestReport(latest);

    return NextResponse.json(latest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie przetworzyc raportu.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
