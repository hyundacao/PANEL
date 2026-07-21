import * as XLSX from 'xlsx';

export type BrakowoscRow = {
  sheet: string;
  row: number;
  machine: string;
  detail: string;
  index: string;
  brigadierShifts: BrigadierShiftScrap[];
  brigadierScrapQty: number | null;
  brigadierScrapPct: number | null;
  brigadierReasons: string;
  brigadierNote: string;
  mesScrapQty: number;
  mesScrapPct: number;
  mesReasons: string;
  mesIgnoredReasons: string;
  mesProductionQty: number;
};

export type BrigadierShiftScrap = {
  shift: 'I' | 'II' | 'III';
  label: string;
  scrapQty: number | null;
  scrapPct: number | null;
  reasons: string;
  note: string;
};

export type BrakowoscAnalysis = {
  sheets: string[];
  rows: BrakowoscRow[];
  summary: {
    rowCount: number;
    machineCount: number;
    mesScrapTotal: number;
    brigadierScrapTotal: number;
  };
};

type MesReason = {
  reason: string;
  qty: number;
  sharePct: number;
};

type MesMachine = {
  machine: string;
  mesScrapQty: number;
  mesScrapPct: number;
  mesProductionQty: number;
  mesReasons: MesReason[];
  mesIgnoredReasons: MesReason[];
};

const machineRegex = /\bWTR\s*0*(\d{1,2})\b/i;

const parseDecimal = (value: string) => Number(value.replaceAll(' ', '').replace(',', '.'));

const parseNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u00a0/g, ' ').trim();
  if (!text) return null;
  const numbers = text.replaceAll(' ', '').match(/\d+(?:[,.]\d+)?/g);
  if (!numbers?.length) return null;
  return numbers.reduce((sum, number) => sum + Number(number.replace(',', '.')), 0);
};

const normalizeMachineCode = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const match = String(value).match(machineRegex);
  if (!match) return null;
  return `WTR${String(Number(match[1])).padStart(2, '0')}`;
};

const extractIndex = (item: string) => {
  const matches = [...item.matchAll(/\(([^()]+)\)/g)];
  return matches.at(-1)?.[1]?.trim() ?? '';
};

const normalizeReason = (text: string) => {
  const cleaned = text
    .replace(/\b\d{1,6}\s*(?:szt\.?|sztuk|brak(?:i|ów)?)\b/gi, ' ')
    .replace(/\b(ok|kilka|koniec|produkcji|wznowienie)\b/gi, ' ')
    .replace(/[-:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-;/|,.]+|[-;/|,.]+$/g, '');
  return cleaned.slice(0, 80);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const extractBrigadierScrap = (values: unknown[]) => {
  const fragments: string[] = [];
  const reasons: string[] = [];
  let total = 0;

  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;

    for (const match of text.matchAll(/(?:^|[^\w])(\d{1,6})\s*(?:szt\.?|sztuk|brak(?:i|ów)?)\b[^/|;]*/gi)) {
      const qty = Number(match[1]);
      const reason = normalizeReason(match[0]);
      total += qty;
      fragments.push(match[0].trim().replace(/^[-;/|]+|[-;/|]+$/g, ''));
      if (reason) reasons.push(reason);
    }

    for (const match of text.matchAll(/\b([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż /-]{3,40})[-:]\s*(\d{1,6})\s*szt\.?/gi)) {
      const qty = Number(match[2]);
      const reason = normalizeReason(match[1]);
      total += qty;
      fragments.push(match[0].trim().replace(/^[-;/|]+|[-;/|]+$/g, ''));
      if (reason) reasons.push(reason);
    }
    for (const fragment of text.split(/[\n;]+/)) {
      const match = fragment.trim().match(/^([^\d]{3,80}?)[\s:-]+(\d{1,6})(?:\s*szt\.?)?$/i);
      if (!match) continue;
      const reason = normalizeReason(match[1]);
      if (!reason) continue;
      const qty = Number(match[2]);
      total += qty;
      fragments.push(fragment.trim().replace(/^[-;/|]+|[-;/|]+$/g, ''));
      reasons.push(reason);
    }
  }

  return {
    qty: total || null,
    note: [...new Set(fragments.filter(Boolean))].join('; '),
    reasons: [...new Set(reasons.filter(Boolean))].join('; ')
  };
};

const formatReasonList = (reasons: MesReason[]) =>
  reasons
    .map((reason) => `${reason.reason} (${reason.qty} szt., ${reason.sharePct.toFixed(2)}%)`)
    .join('; ');

const extractBrigadierScrapClean = (values: unknown[]) => {
  const fragments: string[] = [];
  const reasons: string[] = [];
  const counted = new Set<string>();
  let total = 0;

  const addScrap = (qty: number, reason: string, fragment: string) => {
    if (!qty || qty < 0) return;
    const cleanedReason = normalizeReason(reason);
    const cleanedFragment = fragment.trim().replace(/^[-;/|,.]+|[-;/|,.]+$/g, '');
    const key = `${qty}:${cleanedReason || cleanedFragment.toLowerCase()}`;
    if (counted.has(key)) return;
    counted.add(key);
    total += qty;
    if (cleanedFragment) fragments.push(cleanedFragment);
    if (cleanedReason) reasons.push(cleanedReason);
  };

  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;

    const normalizedText = text.replace(
      /(\d{1,6})\s+(?=[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3})/g,
      '$1; '
    );
    const parts = normalizedText
      .split(/[\n;,]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const reasonThenQty = part.match(/^(.{3,90}?)[\s:-]+(\d{1,6})(?:\s*szt\.?)?$/i);
      if (reasonThenQty && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(reasonThenQty[1])) {
        addScrap(Number(reasonThenQty[2]), reasonThenQty[1], part);
        continue;
      }

      const qtyThenReason = part.match(/^(\d{1,6})\s*(?:szt\.?|sztuk|brak(?:i|ów)?)\s*(.*)$/i);
      if (qtyThenReason) {
        addScrap(Number(qtyThenReason[1]), qtyThenReason[2], part);
      }
    }
  }

  return {
    qty: total || null,
    note: [...new Set(fragments.filter(Boolean))].join('; '),
    reasons: [...new Set(reasons.filter(Boolean))].join('; ')
  };
};

const extractBrigadierShifts = (row: unknown[], plannedQty: number | null): BrigadierShiftScrap[] => {
  const shiftColumns: Array<{ shift: BrigadierShiftScrap['shift']; label: string; scrapColumn: number }> = [
    { shift: 'I', label: 'I zmiana', scrapColumn: 12 },
    { shift: 'II', label: 'II zmiana', scrapColumn: 14 },
    { shift: 'III', label: 'III zmiana', scrapColumn: 16 }
  ];

  return shiftColumns.map(({ shift, label, scrapColumn }) => {
    const scrap = extractBrigadierScrapClean([row[scrapColumn]]);
    const scrapPct =
      plannedQty && scrap.qty ? Number(((scrap.qty / plannedQty) * 100).toFixed(2)) : null;
    return {
      shift,
      label,
      scrapQty: scrap.qty,
      scrapPct,
      reasons: scrap.reasons,
      note: scrap.note
    };
  });
};

export const extractMesMachines = (pdfText: string, thresholdPct = 2): Record<string, MesMachine> => {
  const machinePattern =
    /^\[\s*(WTR\d{2})\s*\]\s+(.+?)\s+(\d+:\d{2}:\d{2})\s+(\d+:\d{2}:\d{2})\s+(\d+:\d{2}:\d{2})\s+([\d ]+)\s+([\d ]+)\s+([\d ]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)$/;
  const reversedMachinePattern =
    /^\[\s*(WTR\d{2})\s*\]\s+(.+?)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+:\d{2}:\d{2}\s+\d+:\d{2}:\d{2}\s+[0-9]+,[0-9]+\s+\d+:\d{2}:\d{2}$/;

  const machines: Record<string, MesMachine> = {};
  let currentMachine: string | null = null;
  let reasonSection: 'mesReasons' | 'mesIgnoredReasons' | null = null;

  for (const rawLine of pdfText.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, ' ');
    const match = line.match(machinePattern);
    if (match) {
      const scrapPct = parseDecimal(match[9]);
      currentMachine = match[1];
      reasonSection = null;
      if (scrapPct <= thresholdPct) continue;
      machines[currentMachine] = {
        machine: currentMachine,
        mesScrapQty: Number(match[8].replaceAll(' ', '')),
        mesScrapPct: scrapPct,
        mesProductionQty: Number(match[7].replaceAll(' ', '')),
        mesReasons: [],
        mesIgnoredReasons: []
      };
      continue;
    }
    const reversedMatch = line.match(reversedMachinePattern);
    if (reversedMatch) {
      const scrapPct = parseDecimal(reversedMatch[6]);
      currentMachine = reversedMatch[1];
      reasonSection = null;
      if (scrapPct <= thresholdPct) continue;
      machines[currentMachine] = {
        machine: currentMachine,
        mesScrapQty: Number(reversedMatch[7]),
        mesScrapPct: scrapPct,
        mesProductionQty: Number(reversedMatch[8]),
        mesReasons: [],
        mesIgnoredReasons: []
      };
      continue;
    }

    if (!currentMachine || !machines[currentMachine]) continue;
    const normalizedHeader = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (
      normalizedHeader === 'powod braku braki udzial' ||
      normalizedHeader === 'udzial braki powod braku'
    ) {
      reasonSection = 'mesReasons';
      continue;
    }
    if (
      normalizedHeader === 'powod braku (ignorowane) braki udzial' ||
      normalizedHeader === 'udzial braki (ignorowane) powod braku'
    ) {
      reasonSection = 'mesIgnoredReasons';
      continue;
    }
    if (line === 'Powód braku Braki Udział' || line === 'Udział Braki Powód braku') {
      reasonSection = 'mesReasons';
      continue;
    }
    if (
      line === 'Powód braku (ignorowane) Braki Udział' ||
      line === 'Udział Braki (ignorowane) Powód braku'
    ) {
      reasonSection = 'mesIgnoredReasons';
      continue;
    }
    if (line.startsWith('Przegląd maszyny') || line.startsWith('Okres:')) {
      reasonSection = null;
      continue;
    }
    if (reasonSection) {
      const reasonMatch = line.match(/^(.+?)\s+(\d+)\s+([0-9]+,[0-9]+)$/);
      if (reasonMatch) {
        machines[currentMachine][reasonSection].push({
          reason: reasonMatch[1],
          qty: Number(reasonMatch[2]),
          sharePct: parseDecimal(reasonMatch[3])
        });
      }
      const reversedReasonMatch = line.match(/^([0-9]+,[0-9]+)\s+(\d+)\s+(.+)$/);
      if (reversedReasonMatch) {
        machines[currentMachine][reasonSection].push({
          reason: reversedReasonMatch[3],
          qty: Number(reversedReasonMatch[2]),
          sharePct: parseDecimal(reversedReasonMatch[1])
        });
      }
    }
  }

  return machines;
};

export const getWorkbookSheets = (excelBuffer: Buffer) => {
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  return workbook.SheetNames;
};

export const analyzeBrakowosc = ({
  pdfText,
  excelBuffer,
  selectedSheet
}: {
  pdfText: string;
  excelBuffer: Buffer;
  selectedSheet: string;
}): BrakowoscAnalysis => {
  const mesMachines = extractMesMachines(pdfText);
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  const sheets = workbook.SheetNames;
  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) {
    throw new Error('Wybrany arkusz nie istnieje w raporcie brygadzisty.');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const rows: BrakowoscRow[] = [];
  let reachedPlannedMoldChanges = false;

  matrix.forEach((row, index) => {
    if (reachedPlannedMoldChanges) return;
    const rowText = row
      .map((cell) => String(cell ?? '').trim())
      .join(' ')
      .toUpperCase();
    if (rowText.includes('PLANOWANE ZMIANY FORM')) {
      reachedPlannedMoldChanges = true;
      return;
    }

    const machine = normalizeMachineCode(row[3]);
    if (!machine || !mesMachines[machine]) return;

    const detail = String(row[1] ?? '').trim();
    const plannedQty = parseNumber(row[2]);
    const brigadierShifts = extractBrigadierShifts(row, plannedQty);
    const brigadierScrapQty = brigadierShifts.reduce(
      (sum, shift) => sum + (shift.scrapQty ?? 0),
      0
    );
    const brigadierScrapPct =
      plannedQty && brigadierScrapQty ? Number(((brigadierScrapQty / plannedQty) * 100).toFixed(2)) : null;
    const brigadierReasons = [
      ...new Set(
        brigadierShifts.flatMap((shift) =>
          shift.reasons
            .split(';')
            .map((reason) => reason.trim())
            .filter(Boolean)
        )
      )
    ].join('; ');
    const mes = mesMachines[machine];

    rows.push({
      sheet: selectedSheet,
      row: index + 1,
      machine,
      detail,
      index: extractIndex(detail),
      brigadierShifts,
      brigadierScrapQty: brigadierScrapQty || null,
      brigadierScrapPct,
      brigadierReasons,
      brigadierNote: brigadierShifts
        .filter((shift) => shift.note)
        .map((shift) => `${shift.label}: ${shift.note}`)
        .join('; '),
      mesScrapQty: mes.mesScrapQty,
      mesScrapPct: mes.mesScrapPct,
      mesReasons: formatReasonList(mes.mesReasons),
      mesIgnoredReasons: formatReasonList(mes.mesIgnoredReasons),
      mesProductionQty: mes.mesProductionQty
    });
  });

  return {
    sheets,
    rows,
    summary: {
      rowCount: rows.length,
      machineCount: new Set(rows.map((row) => row.machine)).size,
      mesScrapTotal: rows.reduce((sum, row) => sum + row.mesScrapQty, 0),
      brigadierScrapTotal: rows.reduce((sum, row) => sum + (row.brigadierScrapQty ?? 0), 0)
    }
  };
};
