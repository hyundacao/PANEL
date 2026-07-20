import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { analyzeBrakowosc, getWorkbookSheets } from '@/lib/brakowosc/analyzer';

export const runtime = 'nodejs';

const readFileBuffer = async (file: File | null) => {
  if (!file) return null;
  return Buffer.from(await file.arrayBuffer());
};

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
      return NextResponse.json({ error: 'Nie udało się odczytać plików.' }, { status: 400 });
    }

    const sheets = getWorkbookSheets(excelBuffer);
    if (!selectedSheet) {
      return NextResponse.json({ sheets, rows: [], summary: null });
    }

    PDFParse.setWorker(
      pathToFileURL(path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).toString()
    );
    const parser = new PDFParse({ data: pdfBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    const analysis = analyzeBrakowosc({ pdfText: pdfData.text, excelBuffer, selectedSheet });

    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się przetworzyć raportu.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
