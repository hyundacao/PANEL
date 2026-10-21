import type { CellValue, Workbook } from 'exceljs';
import type { OriginalInventoryErpSnapshotEntry, PaintTapeInventoryCategory, PaintTapeInventoryData } from '@/lib/api/types';
import { buildPaintTapeInventoryErpLookup, findPaintTapeInventoryErpSnapshot } from './paintTapeInventoryErp';

const categoryLabels: Record<PaintTapeInventoryCategory, string> = {
  FARBY: 'Farba', FOLIE: 'Folia', ROZCIENCZALNIKI: 'Rozcieńczalnik', TASMY: 'Taśma', DODATKI: 'Dodatek'
};
const unitKey = (value: string) => {
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\s]/g, '');
  if (['l', 'litr', 'litry', 'litrow'].includes(key)) return 'l';
  if (['szt', 'sztuka', 'sztuki', 'sztuk'].includes(key)) return 'szt';
  return key;
};
const roundQty = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 1000) / 1000 || 0;
const dateLabel = (value: string) => value.split('-').reverse().join('.');

export const buildPaintTapeInventoryExport = (data: PaintTapeInventoryData, snapshots: readonly OriginalInventoryErpSnapshotEntry[], dateKey: string) => {
  if (!data.session || data.session.inventoryDate !== dateKey) throw new Error('INVENTORY_EXPORT_DATE_MISMATCH');
  const frozen = data.session.status === 'CLOSED' && Boolean(data.comparison);
  const archive = data.comparison && (frozen || snapshots.length === 0) ? data.comparison : null;
  if (archive && archive.inventoryDate !== dateKey) throw new Error('INVENTORY_EXPORT_DATE_MISMATCH');
  if (!frozen && snapshots.some((row) => row.snapshotDate !== dateKey)) throw new Error('INVENTORY_EXPORT_DATE_MISMATCH');
  const lookup = buildPaintTapeInventoryErpLookup(snapshots);
  const archivedRows = new Map(archive?.rows.map((row) => [row.item.id, row]) ?? []);
  const items = frozen ? data.comparison!.rows.map((row) => row.item) : data.catalog;
  const byId = new Map(items.map((item) => [item.id, item]));
  const byItem = new Map<string, typeof data.entries>();
  for (const entry of data.entries) {
    if (entry.sessionId !== data.session.id || !byId.has(entry.catalogItemId)) throw new Error('INVENTORY_EXPORT_INCOMPLETE');
    const entries = byItem.get(entry.catalogItemId) ?? [];
    entries.push(entry);
    byItem.set(entry.catalogItemId, entries);
  }
  const rows = items.filter((item) => byItem.has(item.id)).map((item) => {
    const entries = byItem.get(item.id)!;
    const physicalQty = frozen ? archivedRows.get(item.id)?.physicalQty ?? null : entries.reduce((sum, entry) => sum + entry.qty, 0);
    const erp = archive ? archivedRows.get(item.id)?.erp : findPaintTapeInventoryErpSnapshot(lookup, item);
    const unitsMatch = !erp || unitKey(erp.unit) === unitKey(item.unit);
    const difference = physicalQty !== null && erp && unitsMatch ? roundQty(physicalQty - erp.realQty) : null;
    const status = physicalQty === null ? 'Brak stanu fizycznego' : !erp ? 'Brak stanu ERP' : !unitsMatch ? 'Niezgodna jednostka'
      : difference === 0 ? 'Stan zgodny' : difference! > 0 ? 'Nadwyżka fizyczna' : 'Niedobór fizyczny';
    return { item, physicalQty, erpQty: erp?.realQty ?? null, erpUnit: erp?.unit ?? '', difference, status, measurements: entries.length };
  });
  return {
    rows,
    measurements: data.entries.map((entry) => ({ entry, item: byId.get(entry.catalogItemId)! })),
    erpSource: archive ? frozen ? 'Archiwum zamkniętego spisu.' : 'Archiwum ERP. Stan fizyczny z zapisanych pomiarów otwartego spisu.'
      : snapshots.length ? `Import ERP z dnia ${dateLabel(dateKey)}.` : `Brak importu ERP z dnia ${dateLabel(dateKey)}.`,
    status: data.session.status === 'CLOSED' ? 'Zamknięty' : 'Otwarty'
  };
};

type Column = { name: string; width: number; format?: string; align?: 'left' | 'center' | 'right' };
const qtyFormat = '#,##0.000';
const differenceFormat = '+#,##0.000;-#,##0.000;0.000';
const headerRowNumber = 4;
const firstDataRow = headerRowNumber + 1;
const colors = {
  text: 'FF20232A', muted: 'FF5B616B', purple: 'FF5B45D6', orange: 'FFC45100',
  header: 'FFF3F4F6', stripe: 'FFFAFAFC', border: 'FFD8DBE2', white: 'FFFFFFFF',
  physical: 'FF176347', physicalFill: 'FFEDF7F1', erp: 'FF07638C', erpFill: 'FFEDF6FC',
  negative: 'FFAE2536', negativeFill: 'FFFCEEF0', positiveFill: 'FFF2EEFC',
  warning: 'FF805400', warningFill: 'FFFFF6DD'
};
const solidFill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

const addInventoryTable = (workbook: Workbook, sheetName: string, tableName: string, columns: Column[], rows: CellValue[][],
  dateKey: string, status: string, itemCount: number, measurementCount: number, source: string) => {
  const sheet = workbook.addWorksheet(sheetName, {
    // Keep the active cell in the scrollable pane; do not split the material-name column.
    views: [{ state: 'frozen', ySplit: headerRowNumber, xSplit: 0, topLeftCell: `A${firstDataRow}`,
      activeCell: `A${firstDataRow}`, showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: sheetName === 'Spis' ? colors.purple : colors.orange } },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `1:${headerRowNumber}`, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } }
  });
  columns.forEach((column, i) => { sheet.getColumn(i + 1).width = column.width; });
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell('A1').value = sheetName === 'Spis' ? 'Spis farb i taśm' : 'Pomiary spisu farb i taśm';
  sheet.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: colors.purple } };
  sheet.getCell('A1').alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 30;
  sheet.getCell('A2').value = 'Data spisu';
  sheet.getCell('B2').value = new Date(`${dateKey}T00:00:00Z`);
  sheet.getCell('B2').numFmt = 'dd.mm.yyyy';
  sheet.getCell('C2').value = 'Status';
  sheet.getCell('D2').value = status;
  sheet.getCell('E2').value = 'Pozycje';
  sheet.getCell('F2').value = itemCount;
  sheet.getCell('G2').value = 'Pomiary';
  sheet.getCell('H2').value = measurementCount;
  sheet.getRow(2).height = 25;
  sheet.getRow(2).eachCell((cell, column) => {
    cell.font = { name: 'Calibri', size: 11, bold: column % 2 === 0, color: { argb: column % 2 === 0 ? colors.text : colors.muted } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  sheet.mergeCells(3, 1, 3, columns.length);
  sheet.getCell('A3').value = `ERP: ${source}`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: colors.muted } };
  sheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle', indent: 1 };
  sheet.getRow(3).height = 24;
  // Table column names stay single-line; Excel wraps the visible header cells.
  sheet.addTable({ name: tableName, ref: `A${headerRowNumber}`, headerRow: true, totalsRow: false,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: columns.map((column) => ({ name: column.name, filterButton: true })), rows });
  sheet.getRow(headerRowNumber).height = 36;
  for (let r = headerRowNumber; r <= rows.length + headerRowNumber; r++) {
    const row = sheet.getRow(r);
    const isHeader = r === headerRowNumber;
    let lines = 1;
    columns.forEach((column, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { name: 'Calibri', size: 11, bold: isHeader || i === 0, color: { argb: colors.text } };
      cell.alignment = { vertical: 'middle', wrapText: true,
        horizontal: isHeader ? 'left' : column.align ?? (column.format ? 'right' : 'left'), indent: 1 };
      cell.fill = solidFill(isHeader ? colors.header : (r - firstDataRow) % 2 === 0 ? colors.white : colors.stripe);
      cell.border = {
        bottom: { style: 'thin', color: { argb: isHeader ? colors.purple : colors.border } },
        right: { style: 'thin', color: { argb: colors.border } }
      };
      if (!isHeader) {
        cell.numFmt = column.format ?? '@';
        if (i === 0) cell.font = { ...cell.font, color: { argb: colors.orange } };
        if (i === 1 || i === 2) cell.font = { ...cell.font, color: { argb: colors.purple } };
      }
      if (typeof cell.value === 'string') lines = Math.max(lines, ...cell.value.split('\n').map((line) => Math.ceil(line.length / Math.max(8, column.width - 5))));
    });
    if (!isHeader) row.height = Math.min(409, Math.max(28, lines * 16 + 8));
  }
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns.length).letter}${rows.length + headerRowNumber}`;
  sheet.headerFooter.oddFooter = `&L Spis ${dateLabel(dateKey)} &R Strona &P z &N`;
  return sheet;
};

// Excel dates have no time zone. Preserve the measurement's Warsaw wall-clock time.
const warsawExcelDate = (timestamp: string) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('INVENTORY_EXPORT_INVALID_DATE');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
};

export const createPaintTapeInventoryWorkbook = async (inventory: PaintTapeInventoryData, snapshots: readonly OriginalInventoryErpSnapshotEntry[], dateKey: string) => {
  const data = buildPaintTapeInventoryExport(inventory, snapshots, dateKey);
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'APKA DLA KAMILA';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const metadata = [dateKey, data.status, data.rows.length, data.measurements.length, data.erpSource] as const;
  const summary = addInventoryTable(workbook, 'Spis', 'SpisFarbITasm', [
    { name: 'Nazwa', width: 46 }, { name: 'Indeks', width: 24 }, { name: 'Kod', width: 11 }, { name: 'Kategoria', width: 17 },
    { name: 'Stan fizyczny', width: 17, format: qtyFormat }, { name: 'J.m.', width: 8, align: 'center' },
    { name: 'Stan ERP', width: 17, format: qtyFormat }, { name: 'J.m. ERP', width: 9, align: 'center' },
    { name: 'Różnica (fizyczny - ERP)', width: 18, format: differenceFormat }, { name: 'Porównanie', width: 25 },
    { name: 'Pomiary', width: 11, format: '0', align: 'center' }
  ], data.rows.map((row, index) => [
    row.item.name, row.item.itemIndex, row.item.itemCode ?? '', categoryLabels[row.item.category], row.physicalQty, row.item.unit,
    row.erpQty, row.erpUnit, row.difference === null ? null : { formula: `ROUND(E${index + firstDataRow}-G${index + firstDataRow},3)`, result: row.difference },
    row.status, row.measurements
  ]), ...metadata);
  for (let row = headerRowNumber; row < firstDataRow + data.rows.length; row++) {
    for (const [column, color, fill] of [[5, colors.physical, colors.physicalFill], [6, colors.physical, colors.physicalFill],
      [7, colors.erp, colors.erpFill], [8, colors.erp, colors.erpFill]] as const) {
      const cell = summary.getCell(row, column);
      cell.fill = solidFill(fill);
      cell.font = { name: 'Calibri', size: row === headerRowNumber || column % 2 === 0 ? 11 : 12,
        bold: row === headerRowNumber || column % 2 !== 0, color: { argb: color } };
    }
    if (row === headerRowNumber) continue;
    const item = data.rows[row - firstDataRow];
    const color = item.difference === null ? colors.warning : item.difference < 0 ? colors.negative : item.difference > 0 ? colors.purple : colors.physical;
    const fill = item.difference === null ? colors.warningFill : item.difference < 0 ? colors.negativeFill : item.difference > 0 ? colors.positiveFill : colors.physicalFill;
    for (const column of [9, 10]) {
      const cell = summary.getCell(row, column);
      cell.fill = solidFill(fill);
      cell.font = { name: 'Calibri', size: column === 9 ? 12 : 11, bold: true, color: { argb: color } };
    }
  }
  const measurements = addInventoryTable(workbook, 'Pomiary', 'PomiarySpisu', [
    { name: 'Nazwa', width: 46 }, { name: 'Indeks', width: 24 }, { name: 'Kod', width: 11 },
    { name: 'Ilość', width: 17, format: qtyFormat }, { name: 'J.m.', width: 9, align: 'center' }, { name: 'Lokalizacja', width: 22 },
    { name: 'Uwagi', width: 40 }, { name: 'Osoba', width: 20 }, { name: 'Data pomiaru (Warszawa)', width: 26, format: 'dd.mm.yyyy hh:mm:ss', align: 'left' }
  ], data.measurements.map(({ entry, item }) => [
    item.name, item.itemIndex, item.itemCode ?? '', entry.qty, item.unit, entry.location ?? '', entry.note ?? '', entry.checkedBy, warsawExcelDate(entry.checkedAt)
  ]), ...metadata);
  for (let row = headerRowNumber; row < firstDataRow + data.measurements.length; row++) {
    const cell = measurements.getCell(row, 4);
    cell.fill = solidFill(colors.physicalFill);
    cell.font = { name: 'Calibri', size: row === headerRowNumber ? 11 : 12, bold: true, color: { argb: colors.physical } };
  }
  return workbook;
};
