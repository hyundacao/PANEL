import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { analyzeBrakowosc, getWorkbookSheets } from '@/lib/brakowosc/analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const latestReportPath = path.join(process.cwd(), '.runtime', 'raport-brakowosci-latest.json');

const readFileBuffer = async (file: File | null) => {
  if (!file) return null;
  return Buffer.from(await file.arrayBuffer());
};

const readLatestReport = async () => {
  try {
    const content = await readFile(latestReportPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const writeLatestReport = async (payload: unknown) => {
  await mkdir(path.dirname(latestReportPath), { recursive: true });
  await writeFile(latestReportPath, JSON.stringify(payload, null, 2), 'utf8');
};

export async function GET() {
  const latest = await readLatestReport();
  return NextResponse.json({ latest });
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

    PDFParse.setWorker(
      pathToFileURL(
        path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
      ).toString()
    );
    const parser = new PDFParse({ data: pdfBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();

    const analysis = analyzeBrakowosc({ pdfText: pdfData.text, excelBuffer, selectedSheet });
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
