'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  addWarehouseTransferItemIssue,
  addWarehouseTransferItemReceipt,
  closeWarehouseTransferDocument,
  createWarehouseTransferDocument,
  getWarehouseTransferDocument,
  getWarehouseTransferDocuments,
  removeWarehouseTransferDocument,
  updateWarehouseTransferItemIssue,
  updateWarehouseTransferItemReceipt
} from '@/lib/api';
import type {
  WarehouseTransferDocumentDetails,
  WarehouseTransferItemPriority,
  WarehouseTransferItemStatus
} from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toggle } from '@/components/ui/Toggle';
import { useToastStore } from '@/components/ui/Toast';
import { canSeeTab } from '@/lib/auth/access';
import { useUiStore, type ErpWorkspaceTab } from '@/lib/store/ui';

type ParsedItemInput = {
  lineNo: number;
  priority?: WarehouseTransferItemPriority;
  erpCode?: string;
  indexCode: string;
  indexCode2?: string;
  name: string;
  batch?: string;
  location?: string;
  unit: string;
  plannedQty: number;
};

type ParsedDocumentItems = {
  items: ParsedItemInput[];
  skipped: number;
  total: number;
};

type SplitMode = 'delimited' | 'whitespace';
type SplitLineResult = {
  tokens: string[];
  mode: SplitMode;
};

type OcrTextBlock = {
  rawValue?: string;
  boundingBox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
};

type OcrDocumentMeta = {
  documentNumber?: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
};

type OcrEngine = 'native' | 'tesseract';

type TesseractWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  lineKey: string;
};

type TesseractLine = {
  top: number;
  words: TesseractWord[];
};

const textAreaClass =
  'w-full rounded-xl border border-border bg-[rgba(0,0,0,0.40)] px-3 py-2 text-sm text-body placeholder:text-dim hover:border-borderStrong focus:border-[rgba(255,106,0,0.55)] focus:outline-none focus:ring-2 focus:ring-ring disabled:text-disabled disabled:opacity-55';

const itemStatusConfig: Record<
  WarehouseTransferItemStatus,
  { label: string; tone: 'default' | 'warning' | 'success' | 'danger' }
> = {
  PENDING: { label: 'Oczekuje', tone: 'default' },
  PARTIAL: { label: 'Cz臋艣ciowo', tone: 'warning' },
  DONE: { label: 'Zrealizowane', tone: 'success' },
  OVER: { label: 'Nadwy偶ka', tone: 'danger' }
};

const warehouseTransferPriorityConfig: Record<
  WarehouseTransferItemPriority,
  { label: string; tone: 'default' | 'info' | 'danger'; order: number }
> = {
  CRITICAL: { label: 'Pilne', tone: 'danger', order: 0 },
  HIGH: { label: 'Pilne', tone: 'danger', order: 0 },
  NORMAL: { label: 'Normalny', tone: 'info', order: 1 },
  LOW: { label: 'Normalny', tone: 'default', order: 1 }
};

const normalizeWarehouseTransferPriority = (value: unknown): WarehouseTransferItemPriority => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  if (normalized in warehouseTransferPriorityConfig) {
    return normalized as WarehouseTransferItemPriority;
  }
  return 'NORMAL';
};

const toBinaryWarehouseTransferPriority = (value: unknown): WarehouseTransferItemPriority =>
  warehouseTransferPriorityConfig[normalizeWarehouseTransferPriority(value)].order === 0
    ? 'CRITICAL'
    : 'NORMAL';

const getParsedItemPriorityKey = (item: ParsedItemInput, index: number) =>
  `${item.lineNo}|${item.indexCode}|${item.name}|${index}`;

const formatValue = (value: number) =>
  new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(value);

const formatQty = (value: number, unit?: string) => `${formatValue(value)} ${unit || 'kg'}`;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));

const displayItemName = (value: string) => {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const withoutPrice = normalized.replace(/(?:\s*[|,;:-]\s*|\s+)0[.,]0+\s*$/i, '').trim();
  const withoutQty = withoutPrice.replace(
    /(?:\s*[|,;:-]\s*|\s+)\d[\d\s.,]*\s*(?:szt\.?|kg|g|l|ltr|m2|m3|mb|kpl|op)\.?\s*$/i,
    ''
  );

  const cleaned = withoutQty.replace(/[|,;:-]\s*$/g, '').trim();
  return cleaned || normalized;
};

const displayWarehouseNumber = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim();
  return normalized || '-';
};

const normalizeUnitToken = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (!normalized) return null;

  if (normalized === 'kg' || normalized === 'kgs' || normalized === 'kq') return 'kg';
  if (normalized === 'g') return 'g';
  if (normalized === 'l' || normalized === 'ltr' || normalized === 'litr') return 'l';
  if (
    normalized === 'szt' ||
    normalized === 'sztuk' ||
    normalized === 'sztuka' ||
    normalized === 'sztuki' ||
    normalized === 'sat' ||
    normalized === 's2t' ||
    normalized === 'szl' ||
    normalized === 'pc' ||
    normalized === 'pcs'
  ) {
    return 'szt';
  }
  if (normalized === 'm' || normalized === 'mb' || normalized === 'm2' || normalized === 'm3') {
    return normalized;
  }
  if (normalized === 'kpl' || normalized === 'op') return normalized;
  return null;
};

const isLikelyUnit = (value: string) => normalizeUnitToken(value) !== null;

const isLikelyIndexCode = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length < 2) return false;
  return /[A-Za-z]/.test(normalized) || normalized.includes('-') || normalized.includes('/');
};

const parseLineNoToken = (value: string) => {
  const match = String(value ?? '').trim().match(/^\D*(\d{1,3})\D*$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isLineNumberToken = (value: string) => parseLineNoToken(value) !== null;

const isStrongIndexCode = (value: string) => {
  const normalized = value.trim();
  if (normalized.length < 4) return false;
  if (!/\d/.test(normalized)) return false;
  return /[A-Za-z]/.test(normalized) || normalized.includes('-') || normalized.includes('/');
};

const normalizeIndexToken = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();

const isCompositeIndexCode = (value: string) =>
  isStrongIndexCode(value) && /[-/:]/.test(value);

const isLikelyIndex2Token = (token: string, primaryIndex?: string) => {
  const normalized = token.trim();
  if (!normalized || normalized === '-') return true;
  if (isLikelyUnit(normalized)) return false;
  if (/^\d{4,}$/.test(normalized)) return true;

  if (primaryIndex) {
    const tokenNormalized = normalizeIndexToken(normalized);
    const primaryNormalized = normalizeIndexToken(primaryIndex);
    if (tokenNormalized && primaryNormalized) {
      if (tokenNormalized === primaryNormalized) return true;
      if (tokenNormalized.includes(primaryNormalized) || primaryNormalized.includes(tokenNormalized)) {
        return true;
      }
    }
  }

  return isCompositeIndexCode(normalized);
};

const cleanStreamToken = (value: string) =>
  value
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9,./\-]+$/, '')
    .trim();

const cleanWordToken = (value: string) =>
  String(value ?? '')
    .replace(/[|娄]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:._]+/, '')
    .replace(/[,;:._]+$/, '')
    .trim();

const tokenizeForStream = (raw: string) =>
  raw
    .replace(/\r?\n/g, ' ')
    .replace(/[;|\t]/g, ' ')
    .split(/\s+/)
    .map(cleanStreamToken)
    .filter(Boolean);

const splitLine = (line: string): SplitLineResult => {
  if (line.includes('\t')) return { tokens: line.split(/\t+/), mode: 'delimited' };
  if (line.includes(';')) return { tokens: line.split(';'), mode: 'delimited' };
  if (line.includes('|')) return { tokens: line.split('|'), mode: 'delimited' };
  if (/\s{2,}/.test(line)) return { tokens: line.split(/\s{2,}/), mode: 'delimited' };
  return { tokens: line.split(/\s+/), mode: 'whitespace' };
};

const parseQtyToken = (value: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '').replace(/[^\d,.\-]/g, '');
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');
  let normalized = compact;

  if (hasComma && hasDot) {
    if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = compact.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const tryParseQtyFromParts = (parts: string[]) => {
  const compactParts = parts.map((part) => String(part ?? '').replace(/\s+/g, '').trim()).filter(Boolean);
  if (compactParts.length === 0) return null;
  const candidates: string[] = [];
  candidates.push(compactParts.join(''));
  candidates.push(compactParts.join(','));
  candidates.push(compactParts.join('.'));
  if (
    compactParts.length === 2 &&
    /^\d+$/.test(compactParts[0]) &&
    /^\d+$/.test(compactParts[1]) &&
    compactParts[1].length >= 2
  ) {
    candidates.push(`${compactParts[0]},${compactParts[1]}`);
    candidates.push(`${compactParts[0]}.${compactParts[1]}`);
  }

  const parsedCandidates = candidates
    .map((value) => parseQtyToken(value))
    .filter((value): value is number => value !== null && value > 0);
  if (parsedCandidates.length === 0) return null;
  return Math.min(...parsedCandidates);
};

const areReasonableQtyParts = (parts: string[]) => {
  const cleaned = parts.map((part) => String(part ?? '').trim()).filter(Boolean);
  if (cleaned.length === 0) return false;
  if (!cleaned.every((part) => /^[0-9.,-]+$/.test(part))) return false;
  if (cleaned.length === 1) return true;

  const prefixes = cleaned.slice(0, -1);
  if (!prefixes.every((part) => /^\d{1,3}$/.test(part))) return false;

  const tail = cleaned[cleaned.length - 1];
  return /^\d{1,3}(?:[.,]\d+)?$/.test(tail) || /^\d{3}$/.test(tail);
};

const findQtyTokenFromEnd = (tokens: string[], minIndex = 0) => {
  for (let end = tokens.length - 1; end >= minIndex; end -= 1) {
    for (let start = end - 1; start >= Math.max(minIndex, end - 2); start -= 1) {
      const slice = tokens.slice(start, end + 1);
      if (!areReasonableQtyParts(slice)) continue;
      const qtyCombined = tryParseQtyFromParts(slice);
      if (qtyCombined !== null) {
        return { qty: qtyCombined, qtyStartIndex: start, qtyEndIndex: end };
      }
    }

    const qtySingle = parseQtyToken(tokens[end]);
    if (qtySingle !== null && qtySingle > 0) {
      return { qty: qtySingle, qtyStartIndex: end, qtyEndIndex: end };
    }
  }
  return null;
};

const findQtyBeforeUnitToken = (tokens: string[], unitIndex: number, minIndex = 0) => {
  const maxWidth = Math.min(3, unitIndex - minIndex);
  for (let width = maxWidth; width >= 1; width -= 1) {
    const start = unitIndex - width;
    if (start < minIndex) continue;
    const slice = tokens.slice(start, unitIndex);
    if (slice.length === 0) continue;
    if (!slice.every((token) => /\d/.test(token) && !/[A-Za-z]/.test(token))) continue;
    if (!areReasonableQtyParts(slice)) continue;
    const qty = tryParseQtyFromParts(slice);
    if (qty !== null && qty > 0) {
      return { qty, qtyStartIndex: start, qtyEndIndex: unitIndex - 1 };
    }
  }
  return null;
};

const normalizeOcrLine = (value: string) =>
  value
    .replace(/[|娄]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mergeWrappedLines = (lines: string[]) => {
  const merged: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let current = normalizeOcrLine(lines[index]);
    if (!current) continue;

    const currentTokens = splitLine(current).tokens
      .map((token) => token.trim())
      .filter(Boolean);
    const currentHasIndex = currentTokens.some((token) => isLikelyIndexCode(token));
    const currentHasQty = Boolean(findQtyTokenFromEnd(currentTokens));

    if (currentHasIndex && !currentHasQty && index + 1 < lines.length) {
      let lookAhead = index + 1;
      const tail: string[] = [];
      while (lookAhead < lines.length) {
        const next = normalizeOcrLine(lines[lookAhead]);
        if (!next) {
          lookAhead += 1;
          continue;
        }
        const nextTokens = splitLine(next).tokens
          .map((token) => token.trim())
          .filter(Boolean);
        const nextHasQty = Boolean(findQtyTokenFromEnd(nextTokens));
        const nextHasIndex = nextTokens.some((token) => isLikelyIndexCode(token));

        if (nextHasIndex && tail.length === 0) {
          break;
        }
        if (nextHasIndex && !nextHasQty) {
          break;
        }

        tail.push(next);
        if (nextHasQty) {
          current = `${current} ${tail.join(' ')}`.trim();
          index = lookAhead;
          break;
        }

        lookAhead += 1;
      }
    }

    merged.push(current);
  }
  return merged;
};

const extractMetaFromOcrText = (rawText: string): OcrDocumentMeta => {
  const normalized = rawText.replace(/\u00a0/g, ' ');
  const documentMatch =
    normalized.match(/dokument.*?nr[:\s-]*([A-Za-z0-9/.\- ]{4,})/i) ??
    normalized.match(/\bnr[:\s-]*([A-Za-z0-9/.\- ]{4,})/i);
  const sourceMatch = normalized.match(/z magazynu[:\s-]*([A-Za-z0-9]+)/i);
  const targetMatch = normalized.match(/do magazynu[:\s-]*([A-Za-z0-9]+)/i);
  const documentNumber = documentMatch?.[1]?.trim().replace(/\s{2,}/g, ' ');
  return {
    documentNumber: documentNumber || undefined,
    sourceWarehouse: sourceMatch?.[1]?.trim() || undefined,
    targetWarehouse: targetMatch?.[1]?.trim() || undefined
  };
};

const mergeOcrBlocksIntoLines = (blocks: OcrTextBlock[]) => {
  const words = blocks
    .map((block) => ({
      text: String(block.rawValue ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      x: typeof block.boundingBox?.x === 'number' ? block.boundingBox.x : 0,
      y: typeof block.boundingBox?.y === 'number' ? block.boundingBox.y : 0
    }))
    .filter((word) => word.text.length > 0)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
  words.forEach((word) => {
    let foundIndex = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (Math.abs(lines[index].y - word.y) <= 10) {
        foundIndex = index;
        break;
      }
    }
    if (foundIndex === -1) {
      lines.push({ y: word.y, parts: [{ x: word.x, text: word.text }] });
      return;
    }
    lines[foundIndex].parts.push({ x: word.x, text: word.text });
  });

  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
};

const getClipboardImageFile = (clipboardData?: DataTransfer | null) => {
  if (!clipboardData?.items) return null;
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
};

const normalizeHeaderToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseTesseractTsvWords = (tsv: string): TesseractWord[] => {
  const rows = tsv.split(/\r?\n/);
  if (rows.length <= 1) return [];

  return rows
    .slice(1)
    .map((row) => row.split('\t'))
    .filter((cols) => cols.length >= 12)
    .filter((cols) => Number(cols[0]) === 5)
    .map((cols) => {
      const text = cols.slice(11).join('\t').replace(/\s+/g, ' ').trim();
      return {
        text,
        left: Number(cols[6]),
        top: Number(cols[7]),
        width: Number(cols[8]),
        height: Number(cols[9]),
        conf: Number(cols[10]),
        lineKey: `${cols[1]}-${cols[2]}-${cols[3]}-${cols[4]}`
      } satisfies TesseractWord;
    })
    .filter((word) => word.text.length > 0)
    .filter((word) => !Number.isFinite(word.conf) || word.conf < 0 || word.conf >= 10)
    .map((word) => ({
      ...word,
      left: Number.isFinite(word.left) ? word.left : 0,
      top: Number.isFinite(word.top) ? word.top : 0,
      width: Number.isFinite(word.width) ? word.width : 0,
      height: Number.isFinite(word.height) ? word.height : 0
    }));
};

const groupTesseractWordsIntoLines = (words: TesseractWord[]): TesseractLine[] => {
  if (words.length === 0) return [];
  const byLineKey = new Map<string, TesseractWord[]>();
  words.forEach((word) => {
    if (!word.lineKey) return;
    const list = byLineKey.get(word.lineKey) ?? [];
    list.push(word);
    byLineKey.set(word.lineKey, list);
  });

  if (byLineKey.size > 0) {
    return Array.from(byLineKey.values())
      .map((lineWords) => ({
        top: average(lineWords.map((word) => word.top)),
        words: [...lineWords].sort((a, b) => a.left - b.left)
      }))
      .sort((a, b) => a.top - b.top);
  }

  const sorted = [...words].sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  const heights = sorted
    .map((word) => word.height)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 14;
  const lineGap = Math.max(7, Math.round(medianHeight * 0.75));

  const lines: TesseractLine[] = [];
  sorted.forEach((word) => {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.top - word.top) > lineGap) {
      lines.push({ top: word.top, words: [word] });
      return;
    }
    last.words.push(word);
    last.top = (last.top * (last.words.length - 1) + word.top) / last.words.length;
  });

  lines.forEach((line) => {
    line.words.sort((a, b) => a.left - b.left);
  });
  return lines;
};

const findHeaderLine = (lines: TesseractLine[]) => {
  if (lines.length === 0) return null;
  const scored = lines.map((line) => {
    const keys = line.words.map((word) => normalizeHeaderToken(word.text));
    const score =
      Number(keys.some((key) => key === 'lp' || key === 'kod')) +
      Number(keys.some((key) => key.startsWith('indeks'))) +
      Number(keys.some((key) => key.startsWith('nazwa'))) +
      Number(keys.some((key) => key.startsWith('jm') || key === 'im')) +
      Number(keys.some((key) => key.startsWith('ilos')));
    return { line, score };
  });
  const best = scored.reduce((acc, item) => (item.score > acc.score ? item : acc));
  return best.score >= 3 ? best.line : null;
};

const average = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const parseDocumentItemsFromTesseractTsv = (tsv: string): ParsedDocumentItems => {
  const words = parseTesseractTsvWords(tsv);
  if (words.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }
  const lines = groupTesseractWordsIntoLines(words);
  if (lines.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }

  const headerLine = findHeaderLine(lines);
  const headerTop = headerLine?.top ?? -Infinity;
  const headerHeight =
    headerLine && headerLine.words.length > 0
      ? average(
          headerLine.words
            .map((word) => word.height)
            .filter((value) => Number.isFinite(value) && value > 0)
        ) || 12
      : 12;
  const dataLines = lines.filter((line) => line.top > headerTop + Math.max(5, headerHeight * 0.6));
  const rowBlocks: Array<{
    lineNo?: number;
    erpCode?: string;
    indexCode: string;
    indexCode2?: string;
    nameParts: string[];
    unit?: string;
    qty?: number;
  }> = [];

  const flushRow = (row: {
    lineNo?: number;
    erpCode?: string;
    indexCode: string;
    indexCode2?: string;
    nameParts: string[];
    unit?: string;
    qty?: number;
  } | null) => {
    if (!row) return;
    rowBlocks.push(row);
  };

  let currentRow: {
    lineNo?: number;
    erpCode?: string;
    indexCode: string;
    indexCode2?: string;
    nameParts: string[];
    unit?: string;
    qty?: number;
  } | null = null;
  let autoLineNo = 1;

  dataLines.forEach((line) => {
    const tokens = line.words
      .map((word) => cleanWordToken(word.text))
      .filter((token) => token.length > 0)
      .filter((token) => !/^[-_=|.]+$/.test(token));
    if (tokens.length === 0) return;

    const joined = tokens.join(' ').toLowerCase();
    const headerHits = ['lp', 'kod', 'indeks', 'indeks2', 'nazwa', 'partia', 'lokalizacja', 'jm', 'ilosc']
      .filter((token) => joined.includes(token))
      .length;
    if (headerHits >= 3) return;
    if (joined.includes('rodzaj dokumentu') || joined.includes('z magazynu') || joined.includes('do magazynu')) {
      return;
    }

    const indexPositions = tokens
      .map((token, position) => (isStrongIndexCode(token) ? position : -1))
      .filter((position) => position >= 0);

    if (indexPositions.length === 0) {
      if (!currentRow) return;
      const qtyToken = findQtyTokenFromEnd(tokens);
      let tail = tokens;
      if (qtyToken && !currentRow.qty) {
        currentRow.qty = qtyToken.qty;
        let end = qtyToken.qtyStartIndex;
        const unitBeforeQty = end > 0 ? normalizeUnitToken(tokens[end - 1]) : null;
        if (unitBeforeQty) {
          currentRow.unit = currentRow.unit || unitBeforeQty;
          end -= 1;
        }
        const unitAfterQty = tokens[qtyToken.qtyEndIndex + 1];
        const normalizedUnitAfterQty = unitAfterQty ? normalizeUnitToken(unitAfterQty) : null;
        if (!currentRow.unit && normalizedUnitAfterQty) {
          currentRow.unit = normalizedUnitAfterQty;
        }
        tail = tokens.slice(0, end);
      }
      const extra = tail.filter((token) => token !== '-').join(' ').trim();
      if (extra) currentRow.nameParts.push(extra);
      return;
    }

    indexPositions.forEach((startIndex, segmentIndex) => {
      const endIndex =
        segmentIndex + 1 < indexPositions.length ? indexPositions[segmentIndex + 1] : tokens.length;
      const segment = tokens.slice(startIndex, endIndex);
      if (segment.length === 0) return;

      if (segmentIndex === 0 && currentRow && startIndex > 0) {
        const prefix = tokens.slice(0, startIndex).filter((token) => !isLineNumberToken(token));
        const prefixText = prefix.join(' ').trim();
        if (prefixText) currentRow.nameParts.push(prefixText);
      }

      flushRow(currentRow);

      const prefixTokens = segmentIndex === 0 ? tokens.slice(0, startIndex) : [];
      const lineNoToken = prefixTokens.find((token) => isLineNumberToken(token));
      const parsedLineNo = lineNoToken ? parseLineNoToken(lineNoToken) : null;
      const erpCodeToken = prefixTokens.find((token) => /\d/.test(token) && !isLineNumberToken(token));

      let cursor = 1;
      const possibleIndex2 = segment[cursor] ?? '';
      let indexCode2: string | undefined;
      if (possibleIndex2 && isLikelyIndex2Token(possibleIndex2, segment[0])) {
        // indeks2 pomijamy
        if (possibleIndex2 !== '-') {
          indexCode2 = possibleIndex2;
        }
        cursor += 1;
      }

      const qtyToken = findQtyTokenFromEnd(segment, cursor);
      let nameEnd = segment.length;
      let unit: string | undefined;
      if (qtyToken) {
        nameEnd = qtyToken.qtyStartIndex;
        const unitBeforeQty = nameEnd > cursor ? normalizeUnitToken(segment[nameEnd - 1]) : null;
        if (unitBeforeQty) {
          unit = unitBeforeQty;
          nameEnd -= 1;
        }
        const unitAfterQty = segment[qtyToken.qtyEndIndex + 1];
        const normalizedUnitAfterQty = unitAfterQty ? normalizeUnitToken(unitAfterQty) : null;
        if (!unit && normalizedUnitAfterQty) {
          unit = normalizedUnitAfterQty;
        }
      }

      const name = segment
        .slice(cursor, nameEnd)
        .filter((token) => token !== '-')
        .join(' ')
        .trim();

      currentRow = {
        lineNo: parsedLineNo ?? autoLineNo,
        erpCode: erpCodeToken || undefined,
        indexCode: segment[0],
        indexCode2,
        nameParts: name ? [name] : [],
        unit,
        qty: qtyToken?.qty
      };
      autoLineNo += 1;
    });
  });

  flushRow(currentRow);

  const items = rowBlocks
    .map((row, index): ParsedItemInput | null => {
      const name = row.nameParts.join(' ').replace(/\s+/g, ' ').trim();
      const qty = row.qty ?? null;
      if (!row.indexCode || !name || qty === null || qty <= 0) {
        return null;
      }
      return {
        lineNo: row.lineNo && row.lineNo > 0 ? row.lineNo : index + 1,
        erpCode: row.erpCode,
        indexCode: row.indexCode,
        indexCode2: row.indexCode2,
        name,
        unit: row.unit || 'kg',
        plannedQty: qty
      };
    })
    .filter((item): item is ParsedItemInput => item !== null);

  return {
    items,
    skipped: Math.max(0, rowBlocks.length - items.length),
    total: rowBlocks.length
  };
};

const parseDocumentItemsFromTesseractGrid = (tsv: string): ParsedDocumentItems => {
  const words = parseTesseractTsvWords(tsv);
  if (words.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }
  const lines = groupTesseractWordsIntoLines(words);
  if (lines.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }

  const pageWidth = Math.max(...words.map((word) => word.left + word.width), 1);
  const pageHeight = Math.max(...words.map((word) => word.top + word.height), 1);
  const headerLine = findHeaderLine(lines);
  const headerTop = headerLine?.top ?? -Infinity;
  const headerHeight =
    headerLine && headerLine.words.length > 0
      ? average(
          headerLine.words
            .map((word) => word.height)
            .filter((value) => Number.isFinite(value) && value > 0)
        ) || 12
      : 12;

  const isNoiseLine = (line: TesseractLine) => {
    const lineText = line.words
      .map((word) => cleanWordToken(word.text))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!lineText.trim()) return true;
    if (lineText.includes('rodzaj dokumentu') || lineText.includes('dokument w buforze')) return true;
    if (lineText.includes('z magazynu') || lineText.includes('do magazynu')) return true;
    const headerHits = ['lp', 'kod', 'indeks', 'nazwa', 'partia', 'lokalizacja', 'jm', 'ilosc']
      .filter((token) => lineText.includes(token))
      .length;
    return headerHits >= 3;
  };

  const dataLines = lines.filter((line) => {
    if (line.top <= headerTop + Math.max(5, headerHeight * 0.55)) return false;
    if (line.top < pageHeight * 0.12) return false;
    return !isNoiseLine(line);
  });

  const getHeaderAnchor = (matcher: (token: string) => boolean) => {
    if (!headerLine) return null;
    const hits = headerLine.words.filter((word) => matcher(normalizeHeaderToken(word.text)));
    if (hits.length === 0) return null;
    return average(hits.map((word) => word.left + word.width / 2));
  };
  const getHeaderAnchors = (matcher: (token: string) => boolean) => {
    if (!headerLine) return [] as number[];
    return headerLine.words
      .filter((word) => matcher(normalizeHeaderToken(word.text)))
      .map((word) => word.left + word.width / 2)
      .sort((a, b) => a - b);
  };

  const defaultAnchors = {
    lp: pageWidth * 0.04,
    code: pageWidth * 0.11,
    index: pageWidth * 0.23,
    index2: pageWidth * 0.35,
    name: pageWidth * 0.62,
    qty: pageWidth * 0.91,
    unit: pageWidth * 0.97
  };
  const indexHeaderAnchors = getHeaderAnchors(
    (token) => token === 'indeks' || token.startsWith('indeks')
  );
  const detectedAnchors = {
    lp: getHeaderAnchor((token) => token === 'lp') ?? defaultAnchors.lp,
    code: getHeaderAnchor((token) => token === 'kod') ?? defaultAnchors.code,
    index: indexHeaderAnchors[0] ?? defaultAnchors.index,
    index2:
      getHeaderAnchor((token) => token === 'indeks2' || token === 'index2') ??
      indexHeaderAnchors[1] ??
      defaultAnchors.index2,
    name: getHeaderAnchor((token) => token.startsWith('nazwa')) ?? defaultAnchors.name,
    unit:
      getHeaderAnchor((token) => token === 'jm' || token === 'im' || token.startsWith('jedn')) ??
      defaultAnchors.unit,
    qty:
      getHeaderAnchor((token) => token.startsWith('ilos') || token.startsWith('ilo')) ??
      defaultAnchors.qty
  };
  const minGap = Math.max(pageWidth * 0.045, 10);
  const lpAnchor = detectedAnchors.lp;
  const codeAnchor = Math.max(detectedAnchors.code, lpAnchor + minGap);
  const indexAnchor = Math.max(detectedAnchors.index, codeAnchor + minGap);
  const index2Anchor = Math.max(detectedAnchors.index2, indexAnchor + minGap);
  const nameAnchor = Math.max(detectedAnchors.name, index2Anchor + minGap);
  const qtyAnchor = Math.max(detectedAnchors.qty, nameAnchor + minGap);
  const unitAnchor = Math.max(detectedAnchors.unit, qtyAnchor + minGap);
  const boundaryLpCode = (lpAnchor + codeAnchor) / 2;
  const boundaryCodeIndex = (codeAnchor + indexAnchor) / 2;
  const boundaryIndexIndex2 = (indexAnchor + index2Anchor) / 2;
  const boundaryIndex2Name = (index2Anchor + nameAnchor) / 2;
  const boundaryNameQty = (nameAnchor + qtyAnchor) / 2;
  const boundaryQtyUnit = (qtyAnchor + unitAnchor) / 2;

  const rowBlocks: Array<{
    lineNo?: number;
    erpCode?: string;
    indexCode: string;
    indexCode2?: string;
    nameParts: string[];
    unit?: string;
    qty?: number;
  }> = [];
  let currentRow: {
    lineNo?: number;
    erpCode?: string;
    indexCode: string;
    indexCode2?: string;
    nameParts: string[];
    unit?: string;
    qty?: number;
  } | null = null;
  let autoLineNo = 1;

  const flushCurrent = () => {
    if (!currentRow) return;
    rowBlocks.push(currentRow);
    currentRow = null;
  };

  const removeFirstOccurrence = (tokens: string[], target: string) => {
    const index = tokens.findIndex((token) => token === target);
    if (index >= 0) tokens.splice(index, 1);
  };

  dataLines.forEach((line) => {
    const cols = {
      lp: [] as string[],
      code: [] as string[],
      index: [] as string[],
      index2: [] as string[],
      name: [] as string[],
      unit: [] as string[],
      qty: [] as string[]
    };

    line.words.forEach((word) => {
      const token = cleanWordToken(word.text);
      if (!token || /^[-_=|.]+$/.test(token)) return;
      const x = word.left + word.width / 2;
      if (x < boundaryLpCode) {
        cols.lp.push(token);
      } else if (x < boundaryCodeIndex) {
        cols.code.push(token);
      } else if (x < boundaryIndexIndex2) {
        cols.index.push(token);
      } else if (x < boundaryIndex2Name) {
        cols.index2.push(token);
      } else if (x < boundaryNameQty) {
        cols.name.push(token);
      } else if (x < boundaryQtyUnit) {
        cols.qty.push(token);
      } else {
        cols.unit.push(token);
      }
    });

    if (
      cols.lp.length +
        cols.code.length +
        cols.index.length +
        cols.index2.length +
        cols.name.length +
        cols.unit.length +
        cols.qty.length ===
      0
    ) {
      return;
    }

    let lpToken = cols.lp.map(parseLineNoToken).find((value) => value !== null) ?? null;
    const codeToken = cols.code.find((token) => token !== '-' && !isLineNumberToken(token)) ?? '';
    const indexTokens = [...cols.index];
    if (lpToken === null && indexTokens.length > 1 && isLineNumberToken(indexTokens[0])) {
      lpToken = parseLineNoToken(indexTokens.shift() ?? '');
    }

    const indexToken =
      indexTokens.find((token) => isStrongIndexCode(token)) ??
      indexTokens.find(
        (token) =>
          isLikelyIndexCode(token) &&
          /\d/.test(token) &&
          token.length >= 5 &&
          (token.includes('-') || token.includes('/'))
      ) ??
      '';
    const index2Token =
      cols.index2.find((token) => token !== '-' && !isLikelyUnit(token)) ??
      indexTokens.find((token) => isLikelyIndex2Token(token, indexToken)) ??
      '';

    const qtyFromQtyColumn =
      findQtyTokenFromEnd(cols.qty)?.qty ??
      findQtyTokenFromEnd(cols.qty.filter((token) => !isLikelyUnit(token)))?.qty ??
      null;
    const qtyFromUnitColumn = findQtyTokenFromEnd(cols.unit)?.qty ?? null;
    const qty = qtyFromQtyColumn ?? qtyFromUnitColumn ?? undefined;
    let unit = cols.unit
      .map((token) => normalizeUnitToken(token))
      .find(
        (token): token is Exclude<ReturnType<typeof normalizeUnitToken>, null> =>
          token !== null
      );
    if (!unit) {
      unit = cols.qty
        .map((token) => normalizeUnitToken(token))
        .find(
          (token): token is Exclude<ReturnType<typeof normalizeUnitToken>, null> =>
            token !== null
        );
    }

    const rowNameTokens = [...cols.name].filter(
      (token) => token !== '-' && !/^[-_=|.]+$/.test(token)
    );

    if (index2Token) {
      removeFirstOccurrence(rowNameTokens, index2Token);
    }
    if (indexToken) {
      removeFirstOccurrence(rowNameTokens, indexToken);
    }
    if (codeToken) {
      removeFirstOccurrence(rowNameTokens, codeToken);
    }
    while (rowNameTokens.length > 0 && isLikelyIndex2Token(rowNameTokens[0], indexToken)) {
      // usuwamy potencjalny indeks2 (czesto wpada do kolumny nazwy)
      rowNameTokens.shift();
    }

    const nameText = rowNameTokens.join(' ').replace(/\s+/g, ' ').trim();
    const effectiveIndex =
      indexToken ||
      (codeToken && isStrongIndexCode(codeToken) ? codeToken : '') ||
      (index2Token && isStrongIndexCode(index2Token) ? index2Token : '');
    if (effectiveIndex && (lpToken !== null || cols.index.length > 0 || cols.code.length > 0 || !currentRow)) {
      flushCurrent();
      const lineNo = lpToken ?? autoLineNo;
      currentRow = {
        lineNo,
        erpCode: codeToken || undefined,
        indexCode: effectiveIndex,
        indexCode2: index2Token || undefined,
        nameParts: nameText ? [nameText] : [],
        unit: unit || undefined,
        qty: qty
      };
      autoLineNo = lineNo + 1;
      return;
    }

    if (!currentRow) return;
    if (nameText) currentRow.nameParts.push(nameText);
    if (!currentRow.unit && unit) currentRow.unit = unit;
    if (!currentRow.qty && qty) currentRow.qty = qty;
  });

  flushCurrent();

  const items = rowBlocks
    .map((row, index): ParsedItemInput | null => {
      const name = row.nameParts.join(' ').replace(/\s+/g, ' ').trim();
      const qty = row.qty ?? null;
      if (!row.indexCode || !name || qty === null || qty <= 0) {
        return null;
      }
      return {
        lineNo: row.lineNo && row.lineNo > 0 ? row.lineNo : index + 1,
        erpCode: row.erpCode,
        indexCode: row.indexCode,
        indexCode2: row.indexCode2,
        name,
        unit: row.unit || 'kg',
        plannedQty: qty
      };
    })
    .filter((item): item is ParsedItemInput => item !== null);

  return {
    items,
    skipped: Math.max(0, rowBlocks.length - items.length),
    total: rowBlocks.length
  };
};

const mergeTesseractTsvIntoLines = (tsv: string) => {
  return groupTesseractWordsIntoLines(parseTesseractTsvWords(tsv))
    .map((line) => line.words.map((word) => word.text).join(' ').trim())
    .filter(Boolean)
    .join('\n');
};

const scoreOcrText = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let score = lines.length * 0.2;
  lines.forEach((line) => {
    if (/[0-9]/.test(line)) score += 1;
    if (/[A-Za-z].*\d|\d.*[A-Za-z]/.test(line)) score += 1.5;
    if (/\d+[.,]\d+/.test(line)) score += 2;
    if (/(kg|kgs|szt|l|litr|litr\.)/i.test(line)) score += 1;
    if (/(indeks|nazwa|ilosc|partia)/i.test(line)) score += 0.5;
  });
  return score;
};

const loadImageElement = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('IMAGE_DECODE_FAILED'));
    };
    image.src = url;
  });

type OcrPreprocessMode = 'contrast' | 'binary';

const preprocessImageForOcr = async (file: File, mode: OcrPreprocessMode = 'binary') => {
  const image = await loadImageElement(file);
  const scale =
    image.width < 1100 ? 4 : image.width < 1600 ? 3 : image.width < 2300 ? 2 : 1.4;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('CANVAS_CONTEXT_FAILED');

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let luminanceSum = 0;
  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    luminanceSum += gray;
    const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }
  if (mode === 'binary') {
    const mean = luminanceSum / (data.length / 4);
    const threshold = Math.max(108, Math.min(198, mean * 0.9));
    for (let index = 0; index < data.length; index += 4) {
      const binary = data[index] > threshold ? 255 : 0;
      data[index] = binary;
      data[index + 1] = binary;
      data[index + 2] = binary;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('CANVAS_BLOB_FAILED'));
      }
    }, 'image/png');
  });
};

const readImageWithBrowserOcr = async (file: File) => {
  const detectorConstructor = (
    window as Window & {
      TextDetector?: new () => { detect: (input: ImageBitmapSource) => Promise<OcrTextBlock[]> };
    }
  ).TextDetector;

  if (!detectorConstructor) {
    throw new Error('OCR_UNSUPPORTED');
  }

  let imageBitmap: ImageBitmap | null = null;
  try {
    imageBitmap = await createImageBitmap(file);
    const detector = new detectorConstructor();
    const blocks = await detector.detect(imageBitmap);
    return mergeOcrBlocksIntoLines(blocks);
  } finally {
    if (imageBitmap && typeof imageBitmap.close === 'function') {
      imageBitmap.close();
    }
  }
};

const readImageWithTesseract = async (
  file: File
): Promise<{ text: string; tsv?: string }> => {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('pol+eng').catch(() => createWorker('eng'));
  try {
    const baseParams = {
      preserve_interword_spaces: '1'
    };
    const enhancedContrastImage = await preprocessImageForOcr(file, 'contrast');
    const enhancedBinaryImage = await preprocessImageForOcr(file, 'binary');
    const sources: Array<{ label: string; input: Blob | File }> = [
      { label: 'raw', input: file },
      { label: 'contrast', input: enhancedContrastImage },
      { label: 'binary', input: enhancedBinaryImage }
    ];
    const psmModes = [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK];

    const evaluateCandidate = (text: string, tsv?: string) => {
      const parsedCandidates = [
        parseDocumentItemsFromCanonicalColumns(text),
        tsv ? parseDocumentItemsFromTesseractGrid(tsv) : null,
        tsv ? parseDocumentItemsFromTesseractTsv(tsv) : null,
        parseDocumentItems(text)
      ].filter((candidate): candidate is ParsedDocumentItems => candidate !== null);
      const bestParsed =
        parsedCandidates.reduce((best, candidate) => {
          if (!best) return candidate;
          return scoreParsedDocumentItems(candidate) > scoreParsedDocumentItems(best) ? candidate : best;
        }, null as ParsedDocumentItems | null) ?? { items: [], skipped: 0, total: 0 };
      return {
        parsedScore: scoreParsedDocumentItems(bestParsed),
        parsedItems: bestParsed.items.length,
        ocrScore: scoreOcrText(text)
      };
    };

    const candidates: Array<{
      text: string;
      tsv?: string;
      score: number;
    }> = [];

    for (const psmMode of psmModes) {
      await worker.setParameters({
        ...baseParams,
        tessedit_pageseg_mode: psmMode
      });
      for (const source of sources) {
        const result = await worker.recognize(source.input);
        const text = result.data.tsv
          ? mergeTesseractTsvIntoLines(result.data.tsv)
          : (result.data.text ?? '').trim();
        const tsv = result.data.tsv || undefined;
        const evaluated = evaluateCandidate(text, tsv);
        // Najmocniej premiujemy poprawny parse tabeli, dopiero potem "ladny OCR".
        const score =
          evaluated.parsedItems * 35 + evaluated.parsedScore * 3 + evaluated.ocrScore;
        candidates.push({ text, tsv, score });
      }
    }

    const best =
      candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best), candidates[0]) ??
      { text: '', tsv: undefined, score: -Infinity };
    return { text: best.text, tsv: best.tsv };
  } finally {
    await worker.terminate();
  }
};

const readImageWithAnyOcr = async (
  file: File
): Promise<{ text: string; engine: OcrEngine; tsv?: string }> => {
  try {
    const tesseract = await readImageWithTesseract(file);
    if (tesseract.text.trim()) {
      return { text: tesseract.text, tsv: tesseract.tsv, engine: 'tesseract' };
    }
  } catch {
    // ignore and fallback to native OCR
  }
  const nativeText = await readImageWithBrowserOcr(file);
  return { text: nativeText, engine: 'native' };
};

const parseDocumentItemsFromCanonicalColumns = (raw: string): ParsedDocumentItems => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const looksLikeColumns = lines.some((line) => {
    const delimiterCount = (line.match(/[;\t|]/g) ?? []).length;
    return delimiterCount >= 4;
  });
  if (!looksLikeColumns) {
    return { items: [], skipped: 0, total: 0 };
  }

  const items: ParsedItemInput[] = [];
  let skipped = 0;
  let autoLineNo = 1;

  lines.forEach((line) => {
    const delimiter = line.includes('\t') ? '\t' : line.includes(';') ? ';' : '|';
    const tokens = line.split(delimiter).map((token) => token.trim());
    if (tokens.length < 5) {
      skipped += 1;
      return;
    }

    const joined = tokens.join(' ').toLowerCase();
    const headerHits = ['lp', 'kod', 'indeks', 'indeks2', 'nazwa', 'ilosc', 'jm']
      .filter((token) => joined.includes(token))
      .length;
    if (headerHits >= 3) {
      return;
    }

    const qtyToken = tokens[tokens.length - 2] ?? '';
    const qty = parseQtyToken(qtyToken);
    if (qty === null || qty <= 0) {
      skipped += 1;
      return;
    }
    const unitToken = tokens[tokens.length - 1] ?? '';
    const unit = normalizeUnitToken(unitToken) || 'kg';

    const front = tokens.slice(0, -2);
    if (front.length < 3) {
      skipped += 1;
      return;
    }

    let cursor = 0;
    const parsedLineNo = parseLineNoToken(front[0] ?? '');
    const lineNo = parsedLineNo ?? autoLineNo;
    if (parsedLineNo !== null) cursor = 1;

    const remaining = front.length - cursor;
    if (remaining < 3) {
      skipped += 1;
      return;
    }

    const hasCodeColumn = remaining >= 4;
    const erpCodeRaw = hasCodeColumn ? front[cursor] ?? '' : '';
    if (hasCodeColumn) cursor += 1;

    const indexCodeRaw = front[cursor] ?? '';
    cursor += 1;
    const indexCode2Raw = front[cursor] ?? '';
    cursor += 1;
    const name = front
      .slice(cursor)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const erpCode = erpCodeRaw && erpCodeRaw !== '-' ? erpCodeRaw : undefined;
    const indexCode = indexCodeRaw && indexCodeRaw !== '-' ? indexCodeRaw : erpCodeRaw;
    const indexCode2 = indexCode2Raw && indexCode2Raw !== '-' ? indexCode2Raw : undefined;

    if (!indexCode || !name) {
      skipped += 1;
      return;
    }

    items.push({
      lineNo,
      erpCode,
      indexCode,
      indexCode2,
      name,
      unit,
      plannedQty: qty
    });
    autoLineNo = lineNo + 1;
  });

  return {
    items,
    skipped,
    total: lines.length
  };
};

const parseDocumentItemsFromSheetRows = (rows: Array<Array<unknown>>): ParsedDocumentItems => {
  if (!rows || rows.length === 0) return { items: [], skipped: 0, total: 0 };

  const normalizeCell = (value: unknown) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const findHeader = () => {
    let best:
      | null
      | {
          rowIndex: number;
          lp: number;
          code: number;
          index: number;
          index2: number;
          name: number;
          qty: number;
          unit: number;
          score: number;
        } = null;

    const maxScan = Math.min(rows.length, 30);
    for (let rowIndex = 0; rowIndex < maxScan; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const tokens = row.map((cell) => normalizeHeaderToken(normalizeCell(cell)));
      const lp = tokens.findIndex((token) => token === 'lp');
      const code = tokens.findIndex((token) => token === 'kod');
      const index = tokens.findIndex(
        (token) => (token === 'indeks' || token.startsWith('indeks')) && token !== 'indeks2'
      );
      const index2 = tokens.findIndex((token) => token === 'indeks2' || token === 'index2');
      const name = tokens.findIndex((token) => token.includes('nazwa'));
      const qty = tokens.findIndex((token) => token.startsWith('ilos') || token.startsWith('ilo'));
      const unit = tokens.findIndex(
        (token) => token === 'jm' || token === 'im' || token.startsWith('jedn')
      );
      const score =
        Number(lp >= 0) +
        Number(code >= 0) +
        Number(index >= 0) +
        Number(index2 >= 0) +
        Number(name >= 0) * 2 +
        Number(qty >= 0) * 2 +
        Number(unit >= 0) * 2;
      if (!best || score > best.score) {
        best = { rowIndex, lp, code, index, index2, name, qty, unit, score };
      }
    }

    return best && best.score >= 6 ? best : null;
  };

  const header = findHeader();
  const dataRows = header ? rows.slice(header.rowIndex + 1) : rows;
  const fallbackCols = {
    lp: 0,
    code: 1,
    index: 2,
    index2: 3,
    name: 4,
    qty: 5,
    unit: 6
  };
  const cols = {
    lp: header?.lp ?? fallbackCols.lp,
    code: header?.code ?? fallbackCols.code,
    index: header?.index ?? fallbackCols.index,
    index2: header?.index2 ?? fallbackCols.index2,
    name: header?.name ?? fallbackCols.name,
    qty: header?.qty ?? fallbackCols.qty,
    unit: header?.unit ?? fallbackCols.unit
  };

  const items: ParsedItemInput[] = [];
  let skipped = 0;
  let autoLineNo = 1;

  dataRows.forEach((row) => {
    const cells = (row ?? []).map((cell) => normalizeCell(cell));
    if (cells.every((cell) => !cell)) return;

    const lineNoToken = cols.lp >= 0 ? cells[cols.lp] ?? '' : '';
    const parsedLineNo = parseLineNoToken(lineNoToken);
    const lineNo = parsedLineNo ?? autoLineNo;

    const erpCodeRaw = cols.code >= 0 ? cells[cols.code] ?? '' : '';
    const indexRaw = cols.index >= 0 ? cells[cols.index] ?? '' : '';
    const index2Raw = cols.index2 >= 0 ? cells[cols.index2] ?? '' : '';

    const qtyRaw =
      cols.qty >= 0
        ? cells[cols.qty] ?? ''
        : cells.length >= 2
        ? cells[cells.length - 2] ?? ''
        : '';
    const qty = parseQtyToken(qtyRaw);
    if (qty === null || qty <= 0) {
      skipped += 1;
      return;
    }

    const unitRaw =
      cols.unit >= 0 ? cells[cols.unit] ?? '' : cells.length >= 1 ? cells[cells.length - 1] ?? '' : '';
    const unit = normalizeUnitToken(unitRaw) || 'kg';

    const nameStart = Math.max(0, cols.name);
    const nameStopCandidates = [cols.qty, cols.unit].filter((idx) => idx >= 0 && idx > nameStart);
    const nameStop = nameStopCandidates.length > 0 ? Math.min(...nameStopCandidates) : cells.length;
    const name = cells
      .slice(nameStart, nameStop)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const erpCode = erpCodeRaw && erpCodeRaw !== '-' ? erpCodeRaw : undefined;
    const indexCode = indexRaw && indexRaw !== '-' ? indexRaw : erpCodeRaw;
    const indexCode2 = index2Raw && index2Raw !== '-' ? index2Raw : undefined;

    if (!indexCode || !name) {
      skipped += 1;
      return;
    }

    items.push({
      lineNo,
      erpCode,
      indexCode,
      indexCode2,
      name,
      unit,
      plannedQty: qty
    });
    autoLineNo = lineNo + 1;
  });

  return {
    items,
    skipped,
    total: dataRows.length
  };
};

const parseDocumentItemsFromFixedColumns = (raw: string): ParsedDocumentItems => {
  const lines = raw.split(/\r?\n/).map((line) => line.replace(/\t/g, ' ').trimEnd());
  if (lines.length === 0) return { items: [], skipped: 0, total: 0 };

  const normalizeHeaderLine = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const isHeaderLine = (value: string) => {
    const normalized = normalizeHeaderLine(value);
    if (!normalized) return false;
    const hasLp = /\blp\b/.test(normalized);
    const hasKod = /\bkod\b/.test(normalized);
    const hasIndeks = /\bindeks\b/.test(normalized);
    const hasNazwa = /\bnazwa\b/.test(normalized);
    const hasIlosc = /\bilosc\b/.test(normalized);
    const hasJm = /\bjm\b/.test(normalized);
    return hasLp && hasKod && hasIndeks && hasNazwa && (hasIlosc || hasJm);
  };

  let headerIndex = -1;
  for (let idx = 0; idx < Math.min(lines.length, 8); idx += 1) {
    if (isHeaderLine(lines[idx] ?? '')) {
      headerIndex = idx;
      break;
    }
  }
  if (headerIndex < 0) return { items: [], skipped: 0, total: 0 };

  const dataLines = lines.slice(headerIndex + 1).filter((line) => line.trim().length > 0);
  const items: ParsedItemInput[] = [];
  let skipped = 0;
  let autoLineNo = 1;

  const isIndexToken = (token: string) => isLikelyIndexCode(token) || /^\d{2,}$/.test(token);
  const looksLikeIndex2Token = (token: string, primaryIndex: string) => {
    if (!token) return false;
    if (token === '-') return true;
    if (token === primaryIndex) return true;
    if (normalizeUnitToken(token)) return false;
    return isLikelyIndex2Token(token, primaryIndex) || /^\d{2,}$/.test(token);
  };

  dataLines.forEach((line) => {
    if (isHeaderLine(line)) return;
    const normalizedLine = normalizeHeaderLine(line);
    if (!normalizedLine || normalizedLine.startsWith('razem')) return;

    const tokens = line
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (tokens.length < 6) {
      skipped += 1;
      return;
    }

    let cursor = 0;
    const parsedLineNo = parseLineNoToken(tokens[0] ?? '');
    const lineNo = parsedLineNo ?? autoLineNo;
    if (parsedLineNo !== null) cursor = 1;

    let erpCode: string | undefined;
    if (/^\d+$/.test(tokens[cursor] ?? '')) {
      erpCode = tokens[cursor];
      cursor += 1;
    }

    if (!isIndexToken(tokens[cursor] ?? '') && isIndexToken(tokens[cursor + 1] ?? '')) {
      cursor += 1;
    }

    const indexCode = tokens[cursor] ?? '';
    if (!indexCode) {
      skipped += 1;
      return;
    }
    cursor += 1;

    let indexCode2: string | undefined;
    const maybeIndex2 = tokens[cursor] ?? '';
    if (
      looksLikeIndex2Token(maybeIndex2, indexCode) &&
      tokens.length - (cursor + 1) >= 4
    ) {
      indexCode2 = maybeIndex2 === '-' ? undefined : maybeIndex2;
      cursor += 1;
    }

    const payload = tokens.slice(cursor);
    if (payload.length < 3) {
      skipped += 1;
      return;
    }

    let qty: number | null = null;
    let unit = 'kg';
    let qtyStartIndex = -1;

    for (let index = 0; index < payload.length; index += 1) {
      const normalizedUnit = normalizeUnitToken(payload[index] ?? '');
      if (!normalizedUnit) continue;
      const qtyToken = findQtyBeforeUnitToken(payload, index, 0);
      if (!qtyToken) continue;
      if (qtyToken.qtyStartIndex <= 0) continue;
      qty = qtyToken.qty;
      unit = normalizedUnit;
      qtyStartIndex = qtyToken.qtyStartIndex;
      break;
    }

    if (qty === null || qty <= 0 || qtyStartIndex <= 0) {
      skipped += 1;
      return;
    }

    const name = payload
      .slice(0, qtyStartIndex)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) {
      skipped += 1;
      return;
    }

    items.push({
      lineNo,
      erpCode,
      indexCode,
      indexCode2,
      name,
      unit,
      plannedQty: qty
    });
    autoLineNo = lineNo + 1;
  });

  return { items, skipped, total: dataLines.length };
};

const parseDocumentItemsByLines = (raw: string): ParsedDocumentItems => {
  const sourceLines = raw.split(/\r?\n/);
  const lines = mergeWrappedLines(sourceLines);
  const items: ParsedItemInput[] = [];
  let skipped = 0;

  lines.forEach((line, lineIndex) => {
    const split = splitLine(line);
    const tokens = split.tokens
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (tokens.length === 0) return;

    const joined = tokens.join(' ').toLowerCase();
    if (
      joined.includes('dokument w buforze') ||
      joined.includes('rodzaj dokumentu') ||
      joined.includes('z magazynu') ||
      joined.includes('do magazynu')
    ) {
      return;
    }

    const headerHits = ['kod', 'indeks', 'indeks2', 'nazwa', 'partia', 'lokalizacja', 'jm', 'ilosc']
      .filter((token) => joined.includes(token))
      .length;
    if (headerHits >= 2) {
      return;
    }

    if (tokens.length < 3) {
      skipped += 1;
      return;
    }

    const qtyToken = findQtyTokenFromEnd(tokens, 1);
    if (!qtyToken) {
      skipped += 1;
      return;
    }
    const qty = qtyToken.qty;

    let cursor = 0;
    let lineNo = lineIndex + 1;
    if (/^\d+$/.test(tokens[0])) {
      lineNo = Number(tokens[0]);
      cursor = 1;
    }

    let erpCode: string | undefined;
    if (/^\d+$/.test(tokens[cursor] ?? '') && isLikelyIndexCode(tokens[cursor + 1] ?? '')) {
      erpCode = tokens[cursor];
      cursor += 1;
    }

    let end = qtyToken.qtyStartIndex;
    let unit = 'kg';
    const unitBeforeQty = end - cursor >= 1 ? normalizeUnitToken(tokens[end - 1]) : null;
    if (unitBeforeQty) {
      unit = unitBeforeQty;
      end -= 1;
    }
    const unitAfterQty = tokens[qtyToken.qtyEndIndex + 1];
    const normalizedUnitAfterQty = unitAfterQty ? normalizeUnitToken(unitAfterQty) : null;
    if (normalizedUnitAfterQty) {
      unit = normalizedUnitAfterQty;
    }

    let indexCode = tokens[cursor] ?? '';
    if (!isLikelyIndexCode(indexCode) && isLikelyIndexCode(tokens[cursor + 1] ?? '')) {
      cursor += 1;
      indexCode = tokens[cursor] ?? '';
    }
    if (!indexCode) {
      skipped += 1;
      return;
    }
    cursor += 1;

    const maybeIndex2 = tokens[cursor];
    let indexCode2: string | undefined;
    if (
      maybeIndex2 &&
      end - cursor >= 2 &&
      isLikelyIndex2Token(maybeIndex2, indexCode)
    ) {
      // Ignorujemy indeks 2 - przesuwamy kursor dalej, ale nie zapisujemy tej wartosci.
      indexCode2 = maybeIndex2 === '-' ? undefined : maybeIndex2;
      cursor += 1;
    }

    const details = tokens.slice(cursor, end);
    if (details.length === 0) {
      skipped += 1;
      return;
    }

    const name =
      split.mode === 'whitespace' ? details.join(' ') : details[0];
    const batch =
      split.mode === 'whitespace'
        ? undefined
        : details.length >= 2
        ? details[1]
        : undefined;
    const location =
      split.mode === 'whitespace'
        ? undefined
        : details.length >= 3
        ? details.slice(2).join(' ')
        : undefined;
    items.push({
      lineNo,
      erpCode,
      indexCode,
      indexCode2,
      name,
      batch,
      location,
      unit,
      plannedQty: qty
    });
  });

  return { items, skipped, total: lines.filter((line) => line.trim()).length };
};

const parseDocumentItemsFromTokenStream = (raw: string): ParsedDocumentItems => {
  const tokens = tokenizeForStream(raw);
  if (tokens.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }

  const starts: number[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (isLineNumberToken(tokens[index]) && isStrongIndexCode(tokens[index + 1])) {
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!isStrongIndexCode(tokens[index])) continue;
      if (index > 0 && isStrongIndexCode(tokens[index - 1])) continue;
      starts.push(index);
    }
  }

  if (starts.length === 0) {
    return { items: [], skipped: 0, total: 0 };
  }

  const items: ParsedItemInput[] = [];
  let skipped = 0;

  for (let idx = 0; idx < starts.length; idx += 1) {
    const start = starts[idx];
    const endExclusive = idx + 1 < starts.length ? starts[idx + 1] : tokens.length;
    const chunk = tokens.slice(start, endExclusive);
    if (chunk.length < 3) {
      skipped += 1;
      continue;
    }

    let cursor = 0;
    let lineNo = idx + 1;
    if (isLineNumberToken(chunk[0])) {
      lineNo = Number(chunk[0]);
      cursor = 1;
    }

    let erpCode: string | undefined;
    if (/^\d+$/.test(chunk[cursor] ?? '') && isStrongIndexCode(chunk[cursor + 1] ?? '')) {
      erpCode = chunk[cursor];
      cursor += 1;
    }
    if (!isStrongIndexCode(chunk[cursor] ?? '') && isStrongIndexCode(chunk[cursor + 1] ?? '')) {
      cursor += 1;
    }
    const indexCode = chunk[cursor] ?? '';
    if (!isStrongIndexCode(indexCode)) {
      skipped += 1;
      continue;
    }
    cursor += 1;

    const possibleIndex2 = chunk[cursor];
    let indexCode2: string | undefined;
    if (possibleIndex2 && isLikelyIndex2Token(possibleIndex2, indexCode)) {
      // Ignorujemy indeks 2 - nie bierzemy go pod uwage przy zapisie dokumentu.
      indexCode2 = possibleIndex2 === '-' ? undefined : possibleIndex2;
      cursor += 1;
    }

    const qtyToken = findQtyTokenFromEnd(chunk, cursor);
    if (!qtyToken) {
      skipped += 1;
      continue;
    }

    let detailsEnd = qtyToken.qtyStartIndex;
    let unit = 'kg';
    const unitBeforeQty = detailsEnd - cursor >= 1 ? normalizeUnitToken(chunk[detailsEnd - 1]) : null;
    if (unitBeforeQty) {
      unit = unitBeforeQty;
      detailsEnd -= 1;
    }
    const unitAfterQty = chunk[qtyToken.qtyEndIndex + 1];
    const normalizedUnitAfterQty = unitAfterQty ? normalizeUnitToken(unitAfterQty) : null;
    if (normalizedUnitAfterQty) {
      unit = normalizedUnitAfterQty;
    }

    const details = chunk
      .slice(cursor, detailsEnd)
      .map((token) => token.trim())
      .filter((token) => token && token !== '-');
    const name = details.join(' ').trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    items.push({
      lineNo,
      erpCode,
      indexCode,
      indexCode2,
      name,
      unit,
      plannedQty: qtyToken.qty
    });
  }

  return { items, skipped, total: starts.length };
};

const parseDocumentItems = (raw: string): ParsedDocumentItems => {
  const byColumns = parseDocumentItemsFromCanonicalColumns(raw);
  if (byColumns.items.length > 0) {
    return byColumns;
  }
  const byFixedColumns = parseDocumentItemsFromFixedColumns(raw);
  if (byFixedColumns.items.length > 0) {
    return byFixedColumns;
  }
  const byLines = parseDocumentItemsByLines(raw);
  const byStream = parseDocumentItemsFromTokenStream(raw);

  const score = (result: ParsedDocumentItems) => result.items.length * 5 - result.skipped;
  if (score(byStream) > score(byLines)) {
    return byStream;
  }
  return byLines;
};

const scoreParsedDocumentItems = (result: ParsedDocumentItems) => {
  let score = result.items.length * 12 - result.skipped * 3;
  const lineNoCounts = new Map<number, number>();
  result.items.forEach((item, index) => {
    lineNoCounts.set(item.lineNo, (lineNoCounts.get(item.lineNo) ?? 0) + 1);
    const nameLength = item.name.trim().length;
    if (nameLength >= 5 && nameLength <= 120) {
      score += 2;
    } else if (nameLength > 160 || nameLength < 3) {
      score -= 3;
    }
    const nameLetters = (item.name.match(/[A-Za-z]/g) ?? []).length;
    const nameDigits = (item.name.match(/\d/g) ?? []).length;
    if (nameLetters === 0) {
      score -= 6;
    } else if (nameDigits > nameLetters * 2) {
      score -= 2;
    }

    if (item.plannedQty > 0 && item.plannedQty <= 5000) {
      score += 2;
    } else if (item.plannedQty > 100000) {
      score -= 4;
    } else if (item.plannedQty > 20000) {
      score -= 2;
    }

    if (item.lineNo > 0) {
      score += 1;
    } else {
      score -= 4;
    }

    if (isStrongIndexCode(item.indexCode)) {
      score += 2;
    } else if (isLikelyIndexCode(item.indexCode)) {
      score += 1;
    }
    if (/[()[\]{}]/.test(item.indexCode)) {
      score -= 3;
    }

    const normalizedUnit = normalizeUnitToken(item.unit);
    if (normalizedUnit) {
      score += 2;
    } else {
      score -= 4;
    }

    if (index > 0) {
      const prev = result.items[index - 1];
      const diff = item.lineNo - prev.lineNo;
      const absDiff = Math.abs(diff);
      if (absDiff >= 1 && absDiff <= 3) {
        score += 1;
      } else if (diff === 0) {
        score -= 3;
      } else if (absDiff > 8) {
        score -= 2;
      }
    }
  });

  lineNoCounts.forEach((count) => {
    if (count > 1) {
      score -= (count - 1) * 4;
    }
  });

  const namesWithStrongIndex = result.items.filter(
    (item) => item.name.split(/\s+/).filter((token) => isStrongIndexCode(token)).length >= 2
  ).length;
  if (namesWithStrongIndex > 0) {
    score -= namesWithStrongIndex * 3;
  }
  return score;
};

const toCanonicalItemsRaw = (items: ParsedItemInput[]) =>
  items
    .map((item, index) => {
      const normalizedQty = String(item.plannedQty).replace('.', ',');
      const normalizedName = item.name.replace(/;/g, ',').trim();
      const unit = (normalizeUnitToken(item.unit || '') || 'kg').replace(/;/g, '').trim();
      const erpCode = (item.erpCode || '').replace(/;/g, '').trim() || '-';
      const indexCode = (item.indexCode || '').replace(/;/g, '').trim() || '-';
      const indexCode2 =
        (item.indexCode2 || item.batch || '').replace(/;/g, '').trim() || '-';
      return `${index + 1};${erpCode};${indexCode};${indexCode2};${normalizedName};${normalizedQty};${unit}`;
    })
    .join('\n');

export function WarehouseTransferDocumentsPanel() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const tableFileInputRef = useRef<HTMLInputElement | null>(null);
  const detailsCardRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToFirstItemRef = useRef(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    documentNumber: '',
    sourceWarehouse: '',
    itemsRaw: ''
  });
  const [ocrInProgress, setOcrInProgress] = useState(false);
  const [issueDrafts, setIssueDrafts] = useState<Record<string, { qty: string; note: string }>>(
    {}
  );
  const [issueEditDrafts, setIssueEditDrafts] = useState<Record<string, string>>({});
  const [receiptEditDrafts, setReceiptEditDrafts] = useState<Record<string, string>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, { qty: string; note: string }>>(
    {}
  );
  const currentUser = useUiStore((state) => state.user);
  const workspaceTab = useUiStore((state) => state.erpWorkspaceTab);
  const setWorkspaceTab = useUiStore((state) => state.setErpWorkspaceTab);
  const erpDocumentNotificationsEnabled = useUiStore(
    (state) => state.erpDocumentNotificationsEnabled
  );
  const notificationsInitializedRef = useRef(false);
  const lastSeenDocumentIdRef = useRef<string | null>(null);
  const canSeeIssuerTab = canSeeTab(currentUser, 'PRZESUNIECIA_ERP', 'erp-wypisz-dokument');
  const canSeeWarehousemanTab = canSeeTab(currentUser, 'PRZESUNIECIA_ERP', 'erp-magazynier');
  const canSeeDispatcherTab = canSeeTab(currentUser, 'PRZESUNIECIA_ERP', 'erp-rozdzielca');
  const canSeeHistoryTab = canSeeTab(currentUser, 'PRZESUNIECIA_ERP', 'erp-historia-dokumentow');
  const allowedWorkspaceTabs = useMemo(() => {
    const next: ErpWorkspaceTab[] = [];
    if (canSeeIssuerTab) next.push('issuer');
    if (canSeeWarehousemanTab) next.push('warehouseman');
    if (canSeeDispatcherTab) next.push('dispatcher');
    if (canSeeHistoryTab) next.push('history');
    return next;
  }, [canSeeDispatcherTab, canSeeHistoryTab, canSeeIssuerTab, canSeeWarehousemanTab]);
  const hasAnyWorkspaceAccess = allowedWorkspaceTabs.length > 0;
  const [collapsedDocumentIds, setCollapsedDocumentIds] = useState<Record<string, boolean>>({});
  const [expandedItemIds, setExpandedItemIds] = useState<Record<string, string | null>>({});
  const [priorityOverrides, setPriorityOverrides] = useState<
    Record<string, WarehouseTransferItemPriority>
  >({});

  useEffect(() => {
    if (!hasAnyWorkspaceAccess) return;
    if (allowedWorkspaceTabs.includes(workspaceTab)) return;
    setWorkspaceTab(allowedWorkspaceTabs[0]);
  }, [allowedWorkspaceTabs, hasAnyWorkspaceAccess, setWorkspaceTab, workspaceTab]);

  const parsed = useMemo(() => parseDocumentItems(form.itemsRaw), [form.itemsRaw]);
  const parsedItemsWithPriority = useMemo(
    () =>
      parsed.items.map((item, index) => {
        const priorityKey = getParsedItemPriorityKey(item, index);
        return {
          ...item,
          priorityKey,
          priority:
            priorityOverrides[priorityKey] ??
            toBinaryWarehouseTransferPriority(item.priority)
        };
      }),
    [parsed.items, priorityOverrides]
  );

  useEffect(() => {
    const activeKeys = new Set(
      parsed.items.map((item, index) => getParsedItemPriorityKey(item, index))
    );
    setPriorityOverrides((prev) => {
      let changed = false;
      const next: Record<string, WarehouseTransferItemPriority> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (!activeKeys.has(key)) {
          changed = true;
          return;
        }
        next[key] = value;
      });
      return changed ? next : prev;
    });
  }, [parsed.items]);

  const handlePriorityToggle = useCallback((priorityKey: string, checked: boolean) => {
    const normalized: WarehouseTransferItemPriority = checked ? 'CRITICAL' : 'NORMAL';
    setPriorityOverrides((prev) =>
      prev[priorityKey] === normalized ? prev : { ...prev, [priorityKey]: normalized }
    );
  }, []);

  const previewRows = useMemo(
    () =>
      parsedItemsWithPriority.map((item) => [
        item.lineNo,
        item.erpCode || '-',
        item.indexCode,
        item.indexCode2 || '-',
        item.name,
        formatValue(item.plannedQty),
        item.unit,
        <div key={`${item.priorityKey}-priority`} className="flex items-center gap-2">
          <Toggle
            checked={item.priority === 'CRITICAL'}
            onCheckedChange={(checked) => handlePriorityToggle(item.priorityKey, checked)}
          />
          <span className="text-xs font-semibold text-title">
            {item.priority === 'CRITICAL' ? 'Pilny' : 'Normalny'}
          </span>
        </div>
      ]),
    [handlePriorityToggle, parsedItemsWithPriority]
  );

  const { data: documents = [], isLoading: documentsLoading, isFetched: documentsFetched } = useQuery({
    queryKey: ['warehouse-transfer-documents'],
    queryFn: getWarehouseTransferDocuments,
    refetchInterval: 8000,
    refetchIntervalInBackground: false
  });
  const activeDocuments = useMemo(
    () => documents.filter((document) => document.status === 'OPEN'),
    [documents]
  );
  const historyDocuments = useMemo(
    () => documents.filter((document) => document.status === 'CLOSED'),
    [documents]
  );
  const latestDocument = useMemo(() => {
    if (documents.length === 0) return null;
    return documents.reduce<(typeof documents)[number] | null>((latest, document) => {
      if (!latest) return document;
      const latestTime = new Date(latest.createdAt).getTime();
      const currentTime = new Date(document.createdAt).getTime();
      return currentTime > latestTime ? document : latest;
    }, null);
  }, [documents]);

  useEffect(() => {
    if (!documentsFetched) return;

    if (!notificationsInitializedRef.current) {
      notificationsInitializedRef.current = true;
      lastSeenDocumentIdRef.current = latestDocument?.id ?? null;
      return;
    }

    const nextId = latestDocument?.id ?? null;
    const prevId = lastSeenDocumentIdRef.current;
    if (prevId === nextId) return;
    lastSeenDocumentIdRef.current = nextId;

    if (!erpDocumentNotificationsEnabled || !latestDocument) return;

    const isOwnDocument =
      Boolean(currentUser?.id) &&
      Boolean(latestDocument.createdById) &&
      String(currentUser?.id) === String(latestDocument.createdById);
    if (isOwnDocument) return;

    toast({
      title: 'Został utworzony nowy dokument',
      description: latestDocument.documentNumber || latestDocument.id,
      tone: 'info'
    });
  }, [
    currentUser?.id,
    documentsFetched,
    erpDocumentNotificationsEnabled,
    latestDocument,
    toast
  ]);
  const visibleDocuments = useMemo(() => {
    if (workspaceTab === 'warehouseman' && canSeeWarehousemanTab) return activeDocuments;
    if (workspaceTab === 'dispatcher' && canSeeDispatcherTab) return activeDocuments;
    if (workspaceTab === 'history' && canSeeHistoryTab) return historyDocuments;
    return [];
  }, [
    activeDocuments,
    canSeeDispatcherTab,
    canSeeHistoryTab,
    canSeeWarehousemanTab,
    historyDocuments,
    workspaceTab
  ]);

  const activeDocumentId = useMemo(() => {
    if (!selectedDocumentId) return null;
    if (!visibleDocuments.some((doc) => doc.id === selectedDocumentId)) return null;
    return selectedDocumentId;
  }, [selectedDocumentId, visibleDocuments]);

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ['warehouse-transfer-document', activeDocumentId],
    queryFn: () => getWarehouseTransferDocument(activeDocumentId ?? ''),
    enabled: Boolean(activeDocumentId)
  });
  const isActiveDocumentCollapsed = activeDocumentId
    ? Boolean(collapsedDocumentIds[activeDocumentId])
    : false;
  const sortedDetailsItems = useMemo(() => {
    if (!details) return [];
    return [...details.items].sort((a, b) => {
      const priorityDiff =
        warehouseTransferPriorityConfig[normalizeWarehouseTransferPriority(a.priority)].order -
        warehouseTransferPriorityConfig[normalizeWarehouseTransferPriority(b.priority)].order;
      if (priorityDiff !== 0) return priorityDiff;
      return a.lineNo - b.lineNo;
    });
  }, [details]);

  useEffect(() => {
    if (!shouldScrollToFirstItemRef.current) return;
    if (!activeDocumentId || !details || detailsLoading || isActiveDocumentCollapsed) return;

    const target = sortedDetailsItems.length > 0 ? firstItemRef.current : detailsCardRef.current;
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    shouldScrollToFirstItemRef.current = false;
  }, [
    activeDocumentId,
    details,
    detailsLoading,
    isActiveDocumentCollapsed,
    sortedDetailsItems.length
  ]);

  const createDocumentMutation = useMutation({
    mutationFn: createWarehouseTransferDocument,
    onSuccess: (data: WarehouseTransferDocumentDetails) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', data.document.id]
      });
      setSelectedDocumentId(data.document.id);
      setWorkspaceTab('warehouseman');
      setForm({
        documentNumber: '',
        sourceWarehouse: '',
        itemsRaw: ''
      });
      setPriorityOverrides({});
      toast({ title: 'Utworzono dokument przesuni臋cia', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        DOCUMENT_NUMBER_REQUIRED: 'Podaj numer dokumentu.',
        ITEMS_REQUIRED: 'Dodaj co najmniej jedn膮 pozycj臋.',
        INVALID_ITEM: 'Przynajmniej jedna pozycja jest niepoprawna.',
        MIGRATION_REQUIRED_PRIORITY: 'Brakuje migracji bazy dla priorytetow. Uruchom migracje SQL.',
        '42703': 'Brakuje migracji bazy dla priorytetow. Uruchom migracje SQL.',
        PGRST204: 'Brakuje migracji bazy dla priorytetow. Uruchom migracje SQL.',
        INVALID_QTY: 'Ka偶da pozycja musi mie膰 ilo艣膰 wi臋ksz膮 od zera.',
        FORBIDDEN: 'Brak uprawnien do tworzenia dokumentow (wymagane: Wypisz dokument i zapis).'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie uda艂o si臋 utworzy膰 dokumentu.',
        tone: 'error'
      });
    }
  });

  const addIssueMutation = useMutation({
    mutationFn: addWarehouseTransferItemIssue,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', variables.documentId]
      });
      setIssueDrafts((prev) => ({
        ...prev,
        [variables.itemId]: { qty: '', note: '' }
      }));
      toast({ title: 'Dodano wydanie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_QTY: 'Podaj ilość większą od zera.',
        DOCUMENT_CLOSED: 'Dokument jest już zamknięty.',
        NOT_FOUND: 'Nie znaleziono dokumentu lub pozycji.',
        MIGRATION_REQUIRED: 'Brakuje migracji bazy dla wydań. Uruchom migrację SQL.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udało się zapisać wydania.',
        tone: 'error'
      });
    }
  });

  const updateIssueMutation = useMutation({
    mutationFn: updateWarehouseTransferItemIssue,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', variables.documentId]
      });
      setIssueEditDrafts((prev) => {
        if (prev[variables.issueId] === undefined) return prev;
        const next = { ...prev };
        delete next[variables.issueId];
        return next;
      });
      toast({ title: 'Zaktualizowano wydanie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_QTY: 'Podaj ilość większą od zera.',
        DOCUMENT_CLOSED: 'Dokument jest już zamknięty.',
        NOT_FOUND: 'Nie znaleziono dokumentu lub pozycji.',
        ISSUE_BELOW_RECEIVED: 'Nie można ustawić wydania poniżej ilości już przyjętej.',
        MIGRATION_REQUIRED: 'Brakuje migracji bazy dla wydań. Uruchom migrację SQL.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udało się zaktualizować wydania.',
        tone: 'error'
      });
    }
  });

  const addReceiptMutation = useMutation({
    mutationFn: addWarehouseTransferItemReceipt,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', variables.documentId]
      });
      setReceiptDrafts((prev) => ({
        ...prev,
        [variables.itemId]: { qty: '', note: '' }
      }));
      toast({ title: 'Dodano przyj臋cie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_QTY: 'Podaj ilo艣膰 wi臋ksz膮 od zera.',
        DOCUMENT_CLOSED: 'Dokument jest ju偶 zamkni臋ty.',
        NOT_FOUND: 'Nie znaleziono dokumentu lub pozycji.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie uda艂o si臋 zapisa膰 przyj臋cia.',
        tone: 'error'
      });
    }
  });

  const updateReceiptMutation = useMutation({
    mutationFn: updateWarehouseTransferItemReceipt,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', variables.documentId]
      });
      setReceiptEditDrafts((prev) => {
        if (prev[variables.receiptId] === undefined) return prev;
        const next = { ...prev };
        delete next[variables.receiptId];
        return next;
      });
      toast({ title: 'Zaktualizowano przyjęcie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_QTY: 'Podaj ilość większą od zera.',
        DOCUMENT_CLOSED: 'Dokument jest już zamknięty.',
        NOT_FOUND: 'Nie znaleziono dokumentu lub pozycji.',
        FORBIDDEN: 'Możesz edytować tylko swoje przyjęcia.',
        MIGRATION_REQUIRED: 'Brakuje migracji bazy dla przyjęć. Uruchom migrację SQL.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udało się zaktualizować przyjęcia.',
        tone: 'error'
      });
    }
  });

  const closeDocumentMutation = useMutation({
    mutationFn: closeWarehouseTransferDocument,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.invalidateQueries({
        queryKey: ['warehouse-transfer-document', data.id]
      });
      toast({ title: 'Dokument zosta艂 zamkni臋ty', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie uda艂o si臋 zamkn膮膰 dokumentu.', tone: 'error' });
    }
  });

  const removeDocumentMutation = useMutation({
    mutationFn: removeWarehouseTransferDocument,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-documents'] });
      queryClient.removeQueries({
        queryKey: ['warehouse-transfer-document', variables.documentId]
      });
      setIssueDrafts({});
      setIssueEditDrafts({});
      setReceiptDrafts({});
      setReceiptEditDrafts({});
      setCollapsedDocumentIds((prev) => {
        if (!prev[variables.documentId]) return prev;
        const next = { ...prev };
        delete next[variables.documentId];
        return next;
      });
      setExpandedItemIds((prev) => {
        if (!(variables.documentId in prev)) return prev;
        const next = { ...prev };
        delete next[variables.documentId];
        return next;
      });
      setSelectedDocumentId((current) =>
        current === variables.documentId ? null : current
      );
      toast({ title: 'Dokument zosta艂 usuni臋ty', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono dokumentu.',
        FORBIDDEN: 'Nie masz uprawnie艅 do usuni臋cia dokumentu.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie uda艂o si臋 usun膮膰 dokumentu.',
        tone: 'error'
      });
    }
  });

  const handleCreateDocument = () => {
    if (!form.documentNumber.trim()) {
      toast({ title: 'Podaj numer dokumentu.', tone: 'error' });
      return;
    }
    if (parsedItemsWithPriority.length === 0) {
      toast({
        title: 'Brak poprawnych pozycji.',
        description:
          'Sprawd藕, czy OCR poprawnie odczyta艂 kolumny: Kod, Indeks, Indeks2, Nazwa, Ilo艣膰 i JM.',
        tone: 'error'
      });
      return;
    }

    createDocumentMutation.mutate({
      documentNumber: form.documentNumber.trim(),
      sourceWarehouse: form.sourceWarehouse.trim() || undefined,
      items: parsedItemsWithPriority.map((item) => ({
        lineNo: item.lineNo,
        priority: item.priority,
        indexCode: item.indexCode,
        name: item.name,
        batch: item.indexCode2 || item.batch,
        location: item.erpCode || item.location,
        unit: item.unit,
        plannedQty: item.plannedQty
      }))
    });
  };

  const handleImageImport = useCallback(async (file: File) => {
    setOcrInProgress(true);
    try {
      const { text: ocrText, engine, tsv } = await readImageWithAnyOcr(file);
      if (!ocrText.trim()) {
        toast({
          title: 'Nie wykryto tekstu na screenie.',
          description: 'Upewnij si臋, 偶e tabela jest czytelna i zajmuje wi臋kszo艣膰 obrazu.',
          tone: 'error'
        });
        return;
      }

      const parsedFromGrid = tsv ? parseDocumentItemsFromTesseractGrid(tsv) : null;
      const parsedFromColumns = tsv ? parseDocumentItemsFromTesseractTsv(tsv) : null;
      const parsedFromText = parseDocumentItems(ocrText);
      const chosenParsed =
        parsedFromGrid && parsedFromGrid.items.length > 0
          ? parsedFromGrid
          : [parsedFromColumns, parsedFromText].reduce((best, candidate) => {
              if (!candidate) return best;
              if (!best) return candidate;
              return scoreParsedDocumentItems(candidate) > scoreParsedDocumentItems(best)
                ? candidate
                : best;
            }, null as ParsedDocumentItems | null) ?? parsedFromText;
      const preparedItemsRaw =
        chosenParsed.items.length > 0 ? toCanonicalItemsRaw(chosenParsed.items) : ocrText;

      const detectedMeta = extractMetaFromOcrText(ocrText);
      setForm((prev) => ({
        ...prev,
        documentNumber: prev.documentNumber || detectedMeta.documentNumber || '',
        sourceWarehouse: prev.sourceWarehouse || detectedMeta.sourceWarehouse || '',
        itemsRaw: preparedItemsRaw
      }));
      toast({
        title: 'Wczytano screen dokumentu.',
        description:
          engine === 'native'
            ? 'Pozycje zosta艂y wype艂nione automatycznie. Sprawd藕 i zapisz dokument.'
            : 'Pozycje zosta艂y wype艂nione automatycznie (OCR fallback). Sprawd藕 i zapisz dokument.',
        tone: 'success'
      });
    } catch {
      toast({
        title: 'Nie uda艂o si臋 odczyta膰 obrazu.',
        description:
          'Spr贸buj ponownie na wyra藕niejszym screenie. Je艣li obraz jest ciemny lub rozmyty, OCR mo偶e pomin膮膰 pozycje.',
        tone: 'error'
      });
    } finally {
      setOcrInProgress(false);
    }
  }, [toast]);

  const handleImageFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await handleImageImport(file);
  };

  const handleTableFileImport = useCallback(async (file: File) => {
    setOcrInProgress(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!sheet) {
        toast({ title: 'Plik nie zawiera arkusza.', tone: 'error' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<
        Array<unknown>
      >;
      const parsedFromSheet = parseDocumentItemsFromSheetRows(rows);
      if (parsedFromSheet.items.length === 0) {
        toast({
          title: 'Nie znaleziono poprawnych pozycji w pliku.',
          description: 'Plik musi mie膰 kolumny: Kod, Indeks, Indeks2, Nazwa, Ilo艣膰, JM.',
          tone: 'error'
        });
        return;
      }

      setForm((prev) => ({
        ...prev,
        itemsRaw: toCanonicalItemsRaw(parsedFromSheet.items)
      }));
      toast({
        title: 'Wczytano pozycje z pliku ERP.',
        description: 'Import CSV/XLSX jest dok艂adniejszy ni偶 OCR ze screena.',
        tone: 'success'
      });
    } catch {
      toast({
        title: 'Nie uda艂o si臋 odczyta膰 pliku.',
        description: 'Spr贸buj wyeksportowa膰 jeszcze raz do CSV albo XLSX.',
        tone: 'error'
      });
    } finally {
      setOcrInProgress(false);
    }
  }, [toast]);

  const handleTableFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await handleTableFileImport(file);
  };

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (ocrInProgress) return;
      const image = getClipboardImageFile(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      void handleImageImport(image);
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [handleImageImport, ocrInProgress]);

  const updateIssueDraft = (
    itemId: string,
    patch: Partial<{ qty: string; note: string }>
  ) => {
    setIssueDrafts((prev) => ({
      ...prev,
      [itemId]: {
        qty: prev[itemId]?.qty ?? '',
        note: prev[itemId]?.note ?? '',
        ...patch
      }
    }));
  };

  const startIssueEdit = (issueId: string, qty: number) => {
    setIssueEditDrafts((prev) => ({
      ...prev,
      [issueId]: String(qty).replace('.', ',')
    }));
  };

  const updateIssueEditDraft = (issueId: string, value: string) => {
    setIssueEditDrafts((prev) => ({
      ...prev,
      [issueId]: value
    }));
  };

  const cancelIssueEdit = (issueId: string) => {
    setIssueEditDrafts((prev) => {
      if (prev[issueId] === undefined) return prev;
      const next = { ...prev };
      delete next[issueId];
      return next;
    });
  };

  const startReceiptEdit = (receiptId: string, qty: number) => {
    setReceiptEditDrafts((prev) => ({
      ...prev,
      [receiptId]: String(qty).replace('.', ',')
    }));
  };

  const updateReceiptEditDraft = (receiptId: string, value: string) => {
    setReceiptEditDrafts((prev) => ({
      ...prev,
      [receiptId]: value
    }));
  };

  const cancelReceiptEdit = (receiptId: string) => {
    setReceiptEditDrafts((prev) => {
      if (prev[receiptId] === undefined) return prev;
      const next = { ...prev };
      delete next[receiptId];
      return next;
    });
  };

  const updateReceiptDraft = (
    itemId: string,
    patch: Partial<{ qty: string; note: string }>
  ) => {
    setReceiptDrafts((prev) => ({
      ...prev,
      [itemId]: {
        qty: prev[itemId]?.qty ?? '',
        note: prev[itemId]?.note ?? '',
        ...patch
      }
    }));
  };

  const addIssueForItem = useCallback(
    (itemId: string, qty: number, note?: string) => {
      if (!details?.document.id) return;
      addIssueMutation.mutate({
        documentId: details.document.id,
        itemId,
        qty,
        note: note?.trim() || undefined
      });
    },
    [addIssueMutation, details?.document.id]
  );

  const addReceiptForItem = useCallback(
    (itemId: string, qty: number, note?: string) => {
      if (!details?.document.id) return;
      addReceiptMutation.mutate({
        documentId: details.document.id,
        itemId,
        qty,
        note: note?.trim() || undefined
      });
    },
    [addReceiptMutation, details?.document.id]
  );

  const handleAddIssue = (itemId: string) => {
    const draft = issueDrafts[itemId] ?? { qty: '', note: '' };
    const qty = parseQtyToken(draft.qty);
    if (!qty || qty <= 0) {
      toast({ title: 'Podaj ilość większą od zera.', tone: 'error' });
      return;
    }
    addIssueForItem(itemId, qty, draft.note);
  };

  const handleSaveIssueEdit = (itemId: string, issueId: string) => {
    if (!details?.document.id) return;
    const rawQty = issueEditDrafts[issueId];
    const qty = parseQtyToken(rawQty ?? '');
    if (!qty || qty <= 0) {
      toast({ title: 'Podaj ilość większą od zera.', tone: 'error' });
      return;
    }
    updateIssueMutation.mutate({
      documentId: details.document.id,
      itemId,
      issueId,
      qty
    });
  };

  const handleSaveReceiptEdit = (itemId: string, receiptId: string) => {
    if (!details?.document.id) return;
    const rawQty = receiptEditDrafts[receiptId];
    const qty = parseQtyToken(rawQty ?? '');
    if (!qty || qty <= 0) {
      toast({ title: 'Podaj ilość większą od zera.', tone: 'error' });
      return;
    }
    updateReceiptMutation.mutate({
      documentId: details.document.id,
      itemId,
      receiptId,
      qty
    });
  };

  const handleAddReceipt = (itemId: string) => {
    const draft = receiptDrafts[itemId] ?? { qty: '', note: '' };
    const qty = parseQtyToken(draft.qty);
    if (!qty || qty <= 0) {
      toast({ title: 'Podaj ilo艣膰 wi臋ksz膮 od zera.', tone: 'error' });
      return;
    }
    addReceiptForItem(itemId, qty, draft.note);
  };

  const handleRemoveDocument = () => {
    if (!details?.document.id) return;
    const label = details.document.documentNumber || details.document.id;
    const confirmed = window.confirm(
      `Usun膮膰 dokument ${label}? Tej operacji nie da si臋 cofn膮膰.`
    );
    if (!confirmed) return;
    removeDocumentMutation.mutate({ documentId: details.document.id });
  };

  const handleToggleDocumentCollapse = () => {
    if (!activeDocumentId) return;
    setCollapsedDocumentIds((prev) => ({
      ...prev,
      [activeDocumentId]: !prev[activeDocumentId]
    }));
  };

  const handleDocumentClick = (clickedDocumentId?: string) => {
    if (!clickedDocumentId) return;
    if (clickedDocumentId === activeDocumentId) {
      let willExpand = false;
      setCollapsedDocumentIds((prev) => {
        const nextCollapsed = !prev[clickedDocumentId];
        willExpand = !nextCollapsed;
        return {
          ...prev,
          [clickedDocumentId]: nextCollapsed
        };
      });
      if (willExpand) {
        shouldScrollToFirstItemRef.current = true;
        requestAnimationFrame(() => {
          detailsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      return;
    }
    shouldScrollToFirstItemRef.current = true;
    setSelectedDocumentId(clickedDocumentId);
    setCollapsedDocumentIds((prev) => ({
      ...prev,
      [clickedDocumentId]: false
    }));
    requestAnimationFrame(() => {
      detailsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleToggleItemExpand = useCallback((documentId: string, itemId: string) => {
    setExpandedItemIds((prev) => ({
      ...prev,
      [documentId]: prev[documentId] === itemId ? null : itemId
    }));
  }, []);

  const activeDocumentRows = activeDocuments.map((document) => [
    <span
      key={`${document.id}-sourceWarehouse`}
      className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-2.5 py-1 text-sm font-black tabular-nums text-brand"
    >
      {displayWarehouseNumber(document.sourceWarehouse)}
    </span>,
    <span key={`${document.id}-date`} className="text-sm text-dim">
      {formatDateTime(document.createdAt)}
    </span>,
    <span key={`${document.id}-number`} className="text-base font-black text-title">
      {document.documentNumber}
    </span>,
    <span key={`${document.id}-items`} className="text-sm font-semibold tabular-nums text-title">
      {document.itemsCount}
    </span>
  ]);
  const historyDocumentRows = historyDocuments.map((document) => [
    <span
      key={`${document.id}-sourceWarehouse`}
      className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-2.5 py-1 text-sm font-black tabular-nums text-brand"
    >
      {displayWarehouseNumber(document.sourceWarehouse)}
    </span>,
    <span key={`${document.id}-date`} className="text-sm text-dim">
      {formatDateTime(document.createdAt)}
    </span>,
    <span key={`${document.id}-number`} className="text-base font-black text-title">
      {document.documentNumber}
    </span>,
    <span key={`${document.id}-items`} className="text-sm font-semibold tabular-nums text-title">
      {document.itemsCount}
    </span>
  ]);

  const renderMobileDocumentCards = (docs: Array<(typeof documents)[number]>) => (
    <div className="space-y-2 md:hidden">
      {docs.map((document) => {
        const selected = activeDocumentId === document.id;
        return (
          <button
            key={`mobile-doc-${document.id}`}
            type="button"
            onClick={() => handleDocumentClick(document.id)}
            className={`w-full rounded-xl border px-3 py-3 text-left shadow-[inset_0_1px_0_var(--inner-highlight)] transition ${
              selected
                ? 'border-[rgba(255,122,26,0.85)] bg-[color:color-mix(in_srgb,var(--brand)_11%,transparent)]'
                : 'border-border bg-surface2 hover:border-[rgba(255,122,26,0.65)]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
              <span>
                Magazyn:{' '}
                <span className="font-black tabular-nums text-brand">
                  {displayWarehouseNumber(document.sourceWarehouse)}
                </span>
              </span>
              <span>
                Data: <span className="font-semibold normal-case text-title">{formatDateTime(document.createdAt)}</span>
              </span>
              <span>
                Pozycje:{' '}
                <span className="font-black tabular-nums normal-case text-title">
                  {document.itemsCount}
                </span>
              </span>
            </div>
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">
                Dokument
              </p>
              <p className="mt-1 break-words text-base font-black leading-tight text-title">
                {document.documentNumber}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );

  const isIssuerTab = workspaceTab === 'issuer' && canSeeIssuerTab;
  const isWarehousemanTab = workspaceTab === 'warehouseman' && canSeeWarehousemanTab;
  const isDispatcherTab = workspaceTab === 'dispatcher' && canSeeDispatcherTab;
  const isHistoryTab = workspaceTab === 'history' && canSeeHistoryTab;
  const currentActorName = currentUser?.name?.trim() || currentUser?.username?.trim() || '';

  const detailsEmptyDescription = isHistoryTab
    ? 'Kliknij dokument z historii, aby zobaczyć szczegóły.'
    : isWarehousemanTab
      ? 'Kliknij dokument, aby zobaczyć listę rzeczy do wydania.'
      : isDispatcherTab
        ? 'Kliknij dokument, aby zobaczyć listę rzeczy do przyjęcia na halę.'
        : 'Kliknij dokument do realizacji, aby zobaczyć szczegóły.';

  const renderDetailsCard = () => {
    if (!activeDocumentId) {
      return (
        <Card className="space-y-4">
          <EmptyState title="Wybierz dokument" description={detailsEmptyDescription} />
        </Card>
      );
    }

    if (detailsLoading) {
      return (
        <Card className="space-y-4">
          <p className="text-sm text-dim">Ładowanie szczegółów dokumentu...</p>
        </Card>
      );
    }

    if (!details) {
      return (
        <Card className="space-y-4">
          <EmptyState title="Brak danych dokumentu" />
        </Card>
      );
    }

    const expandedItemId = expandedItemIds[details.document.id] ?? null;
    const canEditIssue = isWarehousemanTab && details.document.status === 'OPEN';
    const canEditReceipt = isDispatcherTab && details.document.status === 'OPEN';
    const itemListTitle = isWarehousemanTab
      ? 'Lista rzeczy do wydania'
      : isDispatcherTab
        ? 'Lista rzeczy do przyjęcia na halę'
        : 'Pozycje dokumentu';

    return (
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-title">{details.document.documentNumber}</p>
            <p className="text-sm text-dim">
              Utworzył: {details.document.createdByName} | {formatDateTime(details.document.createdAt)}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleToggleDocumentCollapse}
              disabled={removeDocumentMutation.isPending}
            >
              {isActiveDocumentCollapsed ? 'Rozwiń dokument' : 'Zwiń dokument'}
            </Button>
            <Button
              variant="outline"
              className="w-full border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)] sm:w-auto"
              onClick={handleRemoveDocument}
              disabled={removeDocumentMutation.isPending}
            >
              Usuń dokument
            </Button>
            {details.document.status === 'OPEN' && (
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() =>
                  closeDocumentMutation.mutate({ documentId: details.document.id })
                }
                disabled={closeDocumentMutation.isPending || removeDocumentMutation.isPending}
              >
                Zamknij dokument
              </Button>
            )}
          </div>
        </div>

        {isActiveDocumentCollapsed ? (
          <div className="rounded-2xl border border-border bg-surface2 px-4 py-3 text-sm text-dim">
            Dokument jest zwinięty. Kliknij Rozwiń dokument, aby zobaczyć pozycje.
          </div>
        ) : sortedDetailsItems.length === 0 ? (
          <EmptyState
            title="Dokument nie ma pozycji"
            description="Dodaj pozycje przy tworzeniu kolejnego dokumentu."
          />
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-surface2 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">{itemListTitle}</p>
            </div>

            {sortedDetailsItems.map((item, itemIndex) => {
              const issueDraft = issueDrafts[item.id] ?? { qty: '', note: '' };
              const receiptDraft = receiptDrafts[item.id] ?? { qty: '', note: '' };
              const isExpanded = expandedItemId === item.id;
              const normalizedPriority = normalizeWarehouseTransferPriority(item.priority);
              const isUrgentPriority =
                warehouseTransferPriorityConfig[normalizedPriority].order === 0;
              const diffClasses =
                item.diffQty > 0
                  ? 'border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger'
                  : item.diffQty < 0
                    ? 'border-[color:color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--warning)_12%,transparent)] text-warning'
                    : 'border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
              const qtyToIssue = Math.max(item.plannedQty - item.issuedQty, 0);
              const qtyToReceive = Math.max(item.issuedQty - item.receivedQty, 0);

              return (
                <div
                  key={item.id}
                  ref={itemIndex === 0 ? firstItemRef : undefined}
                  className="scroll-mt-24 rounded-2xl border border-border bg-surface2 p-3 shadow-[inset_0_1px_0_var(--inner-highlight)]"
                >
                  <div
                    className={
                      isWarehousemanTab || isDispatcherTab
                        ? 'w-full px-2 py-2'
                        : 'w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.18)] px-3 py-3 transition hover:border-[rgba(255,122,26,0.55)]'
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleItemExpand(details.document.id, item.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="break-words text-base font-black tracking-wide text-title">
                          <span className="text-[color:var(--brand)]">LP {item.lineNo}</span>{' '}
                          <span className="text-[color:var(--brand)]">|</span>{' '}
                          <span className="text-[color:var(--brand)]">
                            {displayItemName(item.name)}
                          </span>
                        </p>
                        <p className="mt-2 break-words text-xs leading-relaxed text-dim">
                          Indeks: {item.indexCode}
                          {item.batch ? ` | Indeks2: ${item.batch}` : ''}
                          {item.location ? ` | Kod: ${item.location}` : ''}
                        </p>
                      </button>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        <span
                          className={
                            isUrgentPriority
                              ? 'inline-flex min-h-[36px] items-center whitespace-nowrap rounded-full border border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)] px-3 py-1 text-sm font-black text-danger'
                              : 'inline-flex min-h-[36px] items-center whitespace-nowrap rounded-full border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-3 py-1 text-sm font-black text-brand'
                          }
                        >
                          Priorytet: {warehouseTransferPriorityConfig[normalizedPriority].label}
                        </span>
                        {!isDispatcherTab && !isWarehousemanTab && (
                          <Badge tone={itemStatusConfig[item.status].tone}>
                            {itemStatusConfig[item.status].label}
                          </Badge>
                        )}
                        {isWarehousemanTab && canEditIssue && (
                          <Button
                            className="min-h-[46px] flex-1 px-4 py-2 text-sm sm:min-h-[52px] sm:flex-none sm:px-5 sm:py-3"
                            onClick={() => addIssueForItem(item.id, qtyToIssue)}
                            disabled={qtyToIssue <= 0 || addIssueMutation.isPending}
                          >
                            Wydano
                          </Button>
                        )}
                        {isDispatcherTab && canEditReceipt && (
                          <Button
                            className="min-h-[46px] flex-1 px-4 py-2 text-sm sm:min-h-[52px] sm:flex-none sm:px-5 sm:py-3"
                            onClick={() => addReceiptForItem(item.id, qtyToReceive)}
                            disabled={qtyToReceive <= 0 || addReceiptMutation.isPending}
                          >
                            Przyjmij
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="min-h-[46px] flex-1 px-4 py-2 text-sm sm:min-h-[52px] sm:flex-none sm:px-5 sm:py-3"
                          onClick={() => handleToggleItemExpand(details.document.id, item.id)}
                        >
                          {isExpanded ? 'Zamknij' : 'Edytuj'}
                        </Button>
                      </div>
                    </div>

                    {isWarehousemanTab && (
                      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-2">
                        <div className="flex items-center rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
                          <div className="flex flex-col justify-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                            <p className="text-[11px] font-black leading-tight tracking-[0.08em] text-title sm:text-xl sm:leading-none sm:tracking-wide">
                              WYPISANE:
                            </p>
                            <p className="text-lg font-black leading-none tabular-nums text-title sm:text-xl">
                              {formatQty(item.plannedQty, item.unit)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center rounded-lg border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-3 py-2">
                          <div className="flex flex-col justify-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                            <p className="text-[11px] font-black leading-tight tracking-[0.08em] text-title sm:text-xl sm:leading-none sm:tracking-wide">
                              WYDANE:
                            </p>
                            <p className="text-lg font-black leading-none tabular-nums text-title sm:text-xl">
                              {formatQty(item.issuedQty, item.unit)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {!isWarehousemanTab && (
                      <div
                        className={
                          isDispatcherTab
                            ? 'mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3'
                            : 'mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5'
                        }
                      >
                        <div
                          className={
                            isDispatcherTab
                              ? 'flex items-center rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] px-3 py-2'
                              : 'rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] px-2 py-2'
                          }
                        >
                          {isDispatcherTab ? (
                            <div className="flex flex-col justify-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                              <p className="text-[11px] font-black leading-tight tracking-[0.08em] text-title sm:text-xl sm:leading-none sm:tracking-wide">
                                WYPISANE:
                              </p>
                              <p className="text-lg font-black leading-none tabular-nums text-title sm:text-xl">
                                {formatQty(item.plannedQty, item.unit)}
                              </p>
                            </div>
                          ) : (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                                Wypisana
                              </p>
                              <p className="text-sm font-bold tabular-nums text-title">
                                {formatQty(item.plannedQty, item.unit)}
                              </p>
                            </>
                          )}
                        </div>
                        <div
                          className={
                            isDispatcherTab
                              ? 'flex items-center rounded-lg border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-3 py-2'
                              : 'rounded-lg border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-2 py-2'
                          }
                        >
                          {isDispatcherTab ? (
                            <div className="flex flex-col justify-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                              <p className="text-[11px] font-black leading-tight tracking-[0.08em] text-title sm:text-xl sm:leading-none sm:tracking-wide">
                                WYDANE:
                              </p>
                              <p className="text-lg font-black leading-none tabular-nums text-title sm:text-xl">
                                {formatQty(item.issuedQty, item.unit)}
                              </p>
                            </div>
                          ) : (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                                Wydana
                              </p>
                              <p className="text-sm font-bold tabular-nums text-title">
                                {formatQty(item.issuedQty, item.unit)}
                              </p>
                            </>
                          )}
                        </div>
                        <div
                          className={
                            isDispatcherTab
                              ? 'flex items-center rounded-lg border border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] px-3 py-2'
                              : 'rounded-lg border border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] px-2 py-2'
                          }
                        >
                          {isDispatcherTab ? (
                            <div className="flex flex-col justify-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                              <p className="text-[11px] font-black leading-tight tracking-[0.08em] text-title sm:text-xl sm:leading-none sm:tracking-wide">
                                PRZYJĘTE:
                              </p>
                              <p className="text-lg font-black leading-none tabular-nums text-title sm:text-xl">
                                {formatQty(item.receivedQty, item.unit)}
                              </p>
                            </div>
                          ) : (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                                Przyjęta
                              </p>
                              <p className="text-sm font-bold tabular-nums text-title">
                                {formatQty(item.receivedQty, item.unit)}
                              </p>
                            </>
                          )}
                        </div>
                        {!isDispatcherTab && (
                          <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--warning)_12%,transparent)] px-2 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                              Do wydania
                            </p>
                            <p className="text-sm font-bold tabular-nums text-title">
                              {formatQty(qtyToIssue, item.unit)}
                            </p>
                          </div>
                        )}
                        {!isDispatcherTab && (
                          <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] px-2 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dim">
                              Na hale
                            </p>
                            <p className="text-sm font-bold tabular-nums text-title">
                              {formatQty(qtyToReceive, item.unit)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div
                      className={
                        isWarehousemanTab || isDispatcherTab
                          ? 'mt-3 space-y-3'
                          : 'mt-3 rounded-xl border border-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.22)] px-3 py-3'
                      }
                    >
                      {!isWarehousemanTab && !isDispatcherTab && (
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                          <div className="rounded-xl border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                              Ilość wypisana
                            </p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-title">
                              {formatQty(item.plannedQty, item.unit)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                              Ilość wydana
                            </p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-title">
                              {formatQty(item.issuedQty, item.unit)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                              Ilość przyjęta
                            </p>
                            <p className="mt-1 text-2xl font-black tabular-nums text-title">
                              {formatQty(item.receivedQty, item.unit)}
                            </p>
                          </div>
                          <div className={`rounded-xl border px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${diffClasses}`}>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                              Różnica
                            </p>
                            <p className="mt-1 text-2xl font-black tabular-nums">
                              {formatQty(item.diffQty, item.unit)}
                            </p>
                          </div>
                        </div>
                      )}

                      {(!isWarehousemanTab || canEditIssue) && (
                        <div
                          className={
                            isWarehousemanTab
                              ? 'mt-3 space-y-2'
                              : 'mt-3 grid gap-3 lg:grid-cols-2'
                          }
                        >
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                              Historia wydań
                            </p>
                            {item.issues.length === 0 ? (
                              <p className="text-xs text-dim">Brak zapisanych wydań dla tej pozycji.</p>
                            ) : (
                              [...item.issues]
                                .reverse()
                                .map((issue) => (
                                  <div
                                    key={issue.id}
                                    className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] px-3 py-2"
                                  >
                                    <p className="text-xs text-dim">
                                      {formatDateTime(issue.createdAt)} | {issue.issuerName} |{' '}
                                      {formatQty(issue.qty, item.unit)}
                                    </p>
                                    {issue.note && (
                                      <p className="mt-1 break-words text-xs text-dim">
                                        Uwagi: {issue.note}
                                      </p>
                                    )}
                                    {canEditIssue && (
                                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                                        {issueEditDrafts[issue.id] !== undefined ? (
                                          <>
                                            <Input
                                              value={issueEditDrafts[issue.id]}
                                              onChange={(event) =>
                                                updateIssueEditDraft(issue.id, event.target.value)
                                              }
                                              placeholder="Nowa ilość wydana"
                                              inputMode="decimal"
                                              className="sm:max-w-[190px]"
                                            />
                                            <Button
                                              variant="outline"
                                              className="w-full sm:w-auto"
                                              onClick={() => handleSaveIssueEdit(item.id, issue.id)}
                                              disabled={updateIssueMutation.isPending}
                                            >
                                              Zapisz ilość
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              className="w-full sm:w-auto"
                                              onClick={() => cancelIssueEdit(issue.id)}
                                              disabled={updateIssueMutation.isPending}
                                            >
                                              Anuluj
                                            </Button>
                                          </>
                                        ) : (
                                          <Button
                                            variant="outline"
                                            className="w-full sm:w-auto"
                                            onClick={() => startIssueEdit(issue.id, issue.qty)}
                                            disabled={updateIssueMutation.isPending}
                                          >
                                            Edytuj ilość
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))
                            )}
                          </div>

                          {!isWarehousemanTab && (
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                                Historia przyjęć
                              </p>
                              {item.receipts.length === 0 ? (
                                <p className="text-xs text-dim">Brak zapisanych przyjęć dla tej pozycji.</p>
                              ) : (
                                [...item.receipts]
                                  .reverse()
                                  .map((receipt) => {
                                    const canEditReceiptEntry =
                                      canEditReceipt &&
                                      ((Boolean(currentUser?.id) &&
                                        Boolean(receipt.receiverId) &&
                                        String(receipt.receiverId) === String(currentUser?.id)) ||
                                        (!receipt.receiverId &&
                                          Boolean(currentActorName) &&
                                          receipt.receiverName === currentActorName));
                                    return (
                                      <div
                                        key={receipt.id}
                                        className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)] px-3 py-2"
                                      >
                                        <p className="text-xs text-dim">
                                          {formatDateTime(receipt.createdAt)} | {receipt.receiverName} |{' '}
                                          {formatQty(receipt.qty, item.unit)}
                                        </p>
                                        {receipt.note && (
                                          <p className="mt-1 break-words text-xs text-dim">
                                            Uwagi: {receipt.note}
                                          </p>
                                        )}
                                        {canEditReceiptEntry && (
                                          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                                            {receiptEditDrafts[receipt.id] !== undefined ? (
                                              <>
                                                <Input
                                                  value={receiptEditDrafts[receipt.id]}
                                                  onChange={(event) =>
                                                    updateReceiptEditDraft(receipt.id, event.target.value)
                                                  }
                                                  placeholder="Nowa ilość przyjęta"
                                                  inputMode="decimal"
                                                  className="sm:max-w-[190px]"
                                                />
                                                <Button
                                                  variant="outline"
                                                  className="w-full sm:w-auto"
                                                  onClick={() =>
                                                    handleSaveReceiptEdit(item.id, receipt.id)
                                                  }
                                                  disabled={updateReceiptMutation.isPending}
                                                >
                                                  Zapisz ilość
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  className="w-full sm:w-auto"
                                                  onClick={() => cancelReceiptEdit(receipt.id)}
                                                  disabled={updateReceiptMutation.isPending}
                                                >
                                                  Anuluj
                                                </Button>
                                              </>
                                            ) : (
                                              <Button
                                                variant="outline"
                                                className="w-full sm:w-auto"
                                                onClick={() => startReceiptEdit(receipt.id, receipt.qty)}
                                                disabled={updateReceiptMutation.isPending}
                                              >
                                                Edytuj ilość
                                              </Button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {canEditIssue && (
                        <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                          <Input
                            value={issueDraft.qty}
                            onChange={(event) =>
                              updateIssueDraft(item.id, { qty: event.target.value })
                            }
                            placeholder="Ilość wydana"
                            inputMode="decimal"
                          />
                          <Input
                            value={issueDraft.note}
                            onChange={(event) =>
                              updateIssueDraft(item.id, { note: event.target.value })
                            }
                            placeholder="Uwagi do wydania (opcjonalnie)"
                          />
                          <Button
                            className="w-full md:w-auto"
                            onClick={() => handleAddIssue(item.id)}
                            disabled={addIssueMutation.isPending}
                          >
                            Zapisz wydanie
                          </Button>
                        </div>
                      )}

                      {canEditReceipt && (
                        <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                          <Input
                            value={receiptDraft.qty}
                            onChange={(event) =>
                              updateReceiptDraft(item.id, { qty: event.target.value })
                            }
                            placeholder="Ilość przyjęta"
                            inputMode="decimal"
                          />
                          <Input
                            value={receiptDraft.note}
                            onChange={(event) =>
                              updateReceiptDraft(item.id, { note: event.target.value })
                            }
                            placeholder="Uwagi do przyjęcia (opcjonalnie)"
                          />
                          <Button
                            className="w-full md:w-auto"
                            onClick={() => handleAddReceipt(item.id)}
                            disabled={addReceiptMutation.isPending}
                          >
                            Zapisz przyjęcie
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  const activeDocumentsCardTitle = isWarehousemanTab
    ? 'Dokumenty do wydania'
    : 'Dokumenty do przyjęcia na halę';
  const activeDocumentsEmptyDescription = isWarehousemanTab
    ? 'Nowe dokumenty do wydania pojawiają się tutaj po przekazaniu do realizacji.'
    : 'Nowe dokumenty do przyjęcia pojawiają się tutaj po przekazaniu do realizacji.';

  if (!hasAnyWorkspaceAccess) {
    return (
      <Card className="space-y-4">
        <EmptyState
          title="Brak dostępu do zakładek ERP"
          description="Skontaktuj się z administratorem, aby włączyć wymagane uprawnienia."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isIssuerTab && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Pole dla wypisującej osoby
            </p>
            <p className="text-sm text-dim">
              Pozycje wykryte: <span className="font-semibold text-title">{parsed.items.length}</span>
            </p>
          </div>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageFileChange}
            className="hidden"
          />
          <input
            ref={tableFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleTableFileChange}
            className="hidden"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Numer dokumentu</label>
              <Input
                value={form.documentNumber}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, documentNumber: event.target.value }))
                }
                placeholder="np. 13168 / MMZ / 0/2025"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">
                Magazyn źródłowy (opcjonalnie)
              </label>
              <Input
                value={form.sourceWarehouse}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sourceWarehouse: event.target.value }))
                }
                placeholder="np. 51"
              />
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-dim">
              Wklej dokument (pozycje do wydania)
            </label>
            <textarea
              value={form.itemsRaw}
              onChange={(event) => setForm((prev) => ({ ...prev, itemsRaw: event.target.value }))}
              className={textAreaClass}
              rows={8}
              placeholder={`LP;KOD;INDEKS;INDEKS2;NAZWA;ILOSC;JM\n1;7024;M-1-KAR-MAX-7024;7024;KARTON 62[...];606,000;szt`}
            />
            <p className="mt-2 text-xs text-dim">
              Przetworzone linie: {parsed.total}. Pominięte: {parsed.skipped}.
            </p>
          </div>

          {previewRows.length > 0 && (
            <DataTable
              columns={['LP', 'Kod', 'Indeks', 'Indeks2', 'Nazwa', 'Ilość', 'JM', 'Priorytet']}
              rows={previewRows}
            />
          )}

          <div className="flex justify-end">
            <Button
              className="w-full sm:w-auto"
              onClick={handleCreateDocument}
              disabled={createDocumentMutation.isPending}
            >
              Przekaż do realizacji
            </Button>
          </div>
        </Card>
      )}

      {(isWarehousemanTab || isDispatcherTab) && (
        <>
          <div className="space-y-3 md:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                {activeDocumentsCardTitle}
              </p>
              <p className="text-sm text-dim">Aktywne: {activeDocuments.length}</p>
            </div>
            {documentsLoading ? (
              <Card>
                <p className="text-sm text-dim">Ładowanie dokumentów...</p>
              </Card>
            ) : activeDocuments.length === 0 ? (
              <Card>
                <EmptyState
                  title="Brak aktywnych dokumentów"
                  description={activeDocumentsEmptyDescription}
                />
              </Card>
            ) : (
              renderMobileDocumentCards(activeDocuments)
            )}
          </div>

          <Card className="hidden space-y-4 md:block">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                {activeDocumentsCardTitle}
              </p>
              <p className="text-sm text-dim">Aktywne: {activeDocuments.length}</p>
            </div>
            {documentsLoading ? (
              <p className="text-sm text-dim">Ładowanie dokumentów...</p>
            ) : activeDocuments.length === 0 ? (
              <EmptyState
                title="Brak aktywnych dokumentów"
                description={activeDocumentsEmptyDescription}
              />
            ) : (
              <DataTable
                columns={['Magazyn', 'Data', 'Dokument', 'Pozycje']}
                rows={activeDocumentRows}
                onRowClick={(rowIndex) => handleDocumentClick(activeDocuments[rowIndex]?.id)}
              />
            )}
          </Card>

          <div ref={detailsCardRef} className="scroll-mt-20">
            {renderDetailsCard()}
          </div>
        </>
      )}

      {isHistoryTab && (
        <>
          <div className="space-y-3 md:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Historia dokumentów
              </p>
              <p className="text-sm text-dim">Zamknięte: {historyDocuments.length}</p>
            </div>
            {documentsLoading ? (
              <Card>
                <p className="text-sm text-dim">Ładowanie dokumentów...</p>
              </Card>
            ) : historyDocuments.length === 0 ? (
              <Card>
                <EmptyState
                  title="Historia jest pusta"
                  description="Zamknięte dokumenty pojawiają się tutaj automatycznie."
                />
              </Card>
            ) : (
              renderMobileDocumentCards(historyDocuments)
            )}
          </div>

          <Card className="hidden space-y-4 md:block">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Historia dokumentów
              </p>
              <p className="text-sm text-dim">Zamknięte: {historyDocuments.length}</p>
            </div>
            {documentsLoading ? (
              <p className="text-sm text-dim">Ładowanie dokumentów...</p>
            ) : historyDocuments.length === 0 ? (
              <EmptyState
                title="Historia jest pusta"
                description="Zamknięte dokumenty pojawiają się tutaj automatycznie."
              />
            ) : (
              <DataTable
                columns={['Magazyn', 'Data', 'Dokument', 'Pozycje']}
                rows={historyDocumentRows}
                onRowClick={(rowIndex) => handleDocumentClick(historyDocuments[rowIndex]?.id)}
              />
            )}
          </Card>

          <div ref={detailsCardRef} className="scroll-mt-20">
            {renderDetailsCard()}
          </div>
        </>
      )}
    </div>
  );
}



