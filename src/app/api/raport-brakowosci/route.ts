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

const readPdfText = async (pdfBuffer: Buffer) => {
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
