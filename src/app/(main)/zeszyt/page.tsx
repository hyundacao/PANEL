'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  addZeszytItem,
  addZeszytOperator,
  addZeszytReceipt,
  createZeszytSession,
  getZeszytSession,
  getZeszytSessions,
  getTodayKey,
  removeZeszytReceipt,
  removeZeszytSession,
  updateZeszytItem,
  updateZeszytReceipt
} from '@/lib/api';
import type {
  ZeszytItem,
  ZeszytReceipt,
  ZeszytSession,
  ZeszytSessionData,
  ZeszytShift
} from '@/lib/api/types';
import { CheckCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Toggle } from '@/components/ui/Toggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
import { cn } from '@/lib/utils/cn';

type ParsedItem = {
  indexCode: string;
  description?: string | null;
  station?: string | null;
};

const SHIFT_OPTIONS: Array<{ value: ZeszytShift; label: string }> = [
  { value: 'I', label: 'I zmiana (07:00-15:00)' },
  { value: 'II', label: 'II zmiana (15:00-23:00)' },
  { value: 'III', label: 'III zmiana (23:00-07:00)' }
];

const parseIndexTokens = (text: string) => {
  const results: string[] = [];
  for (const match of text.matchAll(/\(([^)]+)\)/g)) {
    const inside = match[1] ?? '';
    inside
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((token) => {
        const digits = token.replace(/\D/g, '').length;
        if (token.length >= 4 && digits >= 3) {
          results.push(token);
        }
      });
  }
  return results;
};

const parseSheetItems = (workbook: XLSX.WorkBook, sheetName: string): ParsedItem[] => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<
    Array<unknown>
  >;
  if (rows.length === 0) return [];
  const headerRow = rows[0] ?? [];
  const stationIndex = headerRow.findIndex((cell) => {
    const value = String(cell ?? '').trim().toUpperCase();
    return value === 'ST.' || value === 'ST' || value.startsWith('ST.');
  });
  const stationCol = stationIndex >= 0 ? stationIndex : 3;
  const descriptionCol = 1;
  const items: ParsedItem[] = [];

  rows.slice(1).forEach((row) => {
    const rawDescription = row[descriptionCol];
    if (!rawDescription) return;
    const description = String(rawDescription).trim();
    if (!description) return;
    const indices = parseIndexTokens(description);
    if (indices.length === 0) return;
    const stationRaw = row[stationCol];
    const station = stationRaw ? String(stationRaw).trim() : '';
    indices.forEach((indexCode) => {
      items.push({
        indexCode,
        description,
        station: station || null
      });
    });
  });

  return items;
};

const buildSessionLabel = (session: ZeszytSession) =>
  `${session.shift} zmiana • ${session.dateKey} • ${session.planSheet}`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export default function ZeszytPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'ZESZYT');

  const [activeTab, setActiveTab] = useState<'zeszyt' | 'raport'>('zeszyt');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [shift, setShift] = useState<ZeszytShift>('I');
  const [sessionDate] = useState(() => getTodayKey());
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const [search, setSearch] = useState('');
  const [onlyWithOperators, setOnlyWithOperators] = useState(false);
  const [manualIndex, setManualIndex] = useState('');
  const [manualStation, setManualStation] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [operatorInputs, setOperatorInputs] = useState<Record<string, string>>({});
  const [operatorSelection, setOperatorSelection] = useState<Record<string, string>>({});
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [flagInputs, setFlagInputs] = useState<Record<string, boolean>>({});
  const [editingItems, setEditingItems] = useState<
    Record<string, { indexCode: string; station: string; description: string }>
  >({});
  const [editingReceipts, setEditingReceipts] = useState<
    Record<string, { qty: string; operatorNo: string; flagPw: boolean }>
  >({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('zeszyt-tab');
    if (stored === 'zeszyt' || stored === 'raport') {
      setActiveTab(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('zeszyt-tab', activeTab);
  }, [activeTab]);

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError
  } = useQuery({
    queryKey: ['zeszyt-sessions'],
    queryFn: getZeszytSessions,
    retry: false
  });

  const {
    data: sessionData,
    isLoading: sessionLoading,
    error: sessionError
  } = useQuery({
    queryKey: ['zeszyt-session', activeSessionId],
    queryFn: () => getZeszytSession(activeSessionId ?? ''),
    enabled: Boolean(activeSessionId),
    retry: false
  });
  const [stickySessionData, setStickySessionData] = useState<ZeszytSessionData | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessions.length === 0) return;
    if (activeSessionId) return;
    const stored = window.localStorage.getItem('zeszyt-active-session');
    const fallback = sessions[0]?.id ?? null;
    const next = stored && sessions.some((session) => session.id === stored) ? stored : fallback;
    if (next) {
      setActiveSessionId(next);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!activeSessionId) return;
    window.localStorage.setItem('zeszyt-active-session', activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessionData) return;
    setStickySessionData(sessionData);
  }, [sessionData]);

  useEffect(() => {
    if (!sessionsError) return;
    toast({
      title: 'Błąd pobierania sesji',
      description: sessionsError.message ?? 'Nie udało się pobrać danych.'
    });
  }, [sessionsError, toast]);

  useEffect(() => {
    if (!sessionError) return;
    toast({
      title: 'Błąd pobierania sesji',
      description: sessionError.message ?? 'Nie udało się pobrać danych.'
    });
  }, [sessionError, toast]);

  const activeSessionData = sessionData ?? stickySessionData;

  const receiptsByItem = useMemo(() => {
    const map = new Map<string, ZeszytReceipt[]>();
    (activeSessionData?.receipts ?? []).forEach((receipt) => {
      const list = map.get(receipt.itemId) ?? [];
      list.push(receipt);
      map.set(receipt.itemId, list);
    });
    map.forEach((list) => {
      list.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    });
    return map;
  }, [activeSessionData?.receipts]);

  const lastReceiptByItem = useMemo(() => {
    const map = new Map<string, ZeszytReceipt>();
    receiptsByItem.forEach((list, key) => {
      if (list.length > 0) {
        map.set(key, list[list.length - 1]);
      }
    });
    return map;
  }, [receiptsByItem]);

  useEffect(() => {
    if (!activeSessionData) return;
    setOperatorSelection((prev) => {
      const next = { ...prev };
      activeSessionData.items.forEach((item) => {
        if (next[item.id]) return;
        const last = lastReceiptByItem.get(item.id);
        next[item.id] = last?.operatorNo ?? item.operators[0] ?? '';
      });
      return next;
    });
    setQtyInputs((prev) => {
      const next = { ...prev };
      activeSessionData.items.forEach((item) => {
        if (next[item.id] !== undefined) return;
        const last = lastReceiptByItem.get(item.id);
        const fallback =
          item.defaultQty !== null && item.defaultQty !== undefined
            ? String(item.defaultQty)
            : last
              ? String(last.qty)
              : '';
        next[item.id] = fallback;
      });
      return next;
    });
    setFlagInputs((prev) => {
      const next = { ...prev };
      activeSessionData.items.forEach((item) => {
        if (next[item.id] !== undefined) return;
        next[item.id] = false;
      });
      return next;
    });
  }, [activeSessionData, lastReceiptByItem]);

  const createSessionMutation = useMutation({
    mutationFn: createZeszytSession,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-sessions'] });
      queryClient.setQueryData(['zeszyt-session', data.session.id], data);
      setActiveSessionId(data.session.id);
      toast({ title: 'Zapisano nową zmianę', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        SHIFT_REQUIRED: 'Wybierz zmianę.',
        SHEET_REQUIRED: 'Wybierz arkusz.',
        EMPTY: 'Brak pozycji do importu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie zapisano importu.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const removeSessionMutation = useMutation({
    mutationFn: removeZeszytSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-sessions'] });
      queryClient.removeQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      setActiveSessionId(null);
      toast({ title: 'Usunięto sesję', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunięto sesji.', tone: 'error' });
    }
  });

  const addItemMutation = useMutation({
    mutationFn: addZeszytItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      setManualIndex('');
      setManualStation('');
      setManualDescription('');
      toast({ title: 'Dodano indeks', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INDEX_REQUIRED: 'Podaj indeks.',
        NOT_FOUND: 'Brak aktywnej zmiany.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie dodano indeksu.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const updateItemMutation = useMutation({
    mutationFn: updateZeszytItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      toast({ title: 'Zapisano ustawienia indeksu', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_QTY: 'Podaj poprawną ilość.',
        INDEX_REQUIRED: 'Podaj indeks.',
        NOT_FOUND: 'Nie znaleziono indeksu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie zapisano.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const addOperatorMutation = useMutation({
    mutationFn: addZeszytOperator,
    onSuccess: (data, payload) => {
      queryClient.setQueryData(
        ['zeszyt-session', activeSessionId],
        (prev: ZeszytSessionData | undefined) => {
          if (!prev) return prev;
          const nextItems = prev.items.map((item) => (item.id === data.id ? data : item));
          return { ...prev, items: nextItems };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      setOperatorInputs((prev) => ({ ...prev, [payload.itemId]: '' }));
      toast({ title: 'Dodano operatora', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        OPERATOR_REQUIRED: 'Podaj numer operatora.',
        NOT_FOUND: 'Nie znaleziono indeksu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie dodano operatora.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const addReceiptMutation = useMutation({
    mutationFn: addZeszytReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      toast({ title: 'Zapisano odbiór', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        OPERATOR_REQUIRED: 'Wybierz operatora.',
        INVALID_QTY: 'Podaj poprawną ilość.',
        NOT_FOUND: 'Nie znaleziono indeksu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie zapisano odbioru.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const updateReceiptMutation = useMutation({
    mutationFn: updateZeszytReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      toast({ title: 'Zapisano zmiany', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        OPERATOR_REQUIRED: 'Wybierz operatora.',
        INVALID_QTY: 'Podaj poprawną ilość.',
        NOT_FOUND: 'Nie znaleziono wpisu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie zapisano zmian.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const removeReceiptMutation = useMutation({
    mutationFn: removeZeszytReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zeszyt-session', activeSessionId] });
      toast({ title: 'Usunięto wpis', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunięto wpisu.', tone: 'error' });
    }
  });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      workbookRef.current = workbook;
      setSheetNames(workbook.SheetNames);
      setSheetName(workbook.SheetNames[0] ?? '');
      setFileName(file.name);
    } catch {
      toast({ title: 'Nie udało się wczytać pliku.', tone: 'error' });
    }
  };

  const handleImport = () => {
    if (readOnly) {
      toast({ title: 'Brak uprawnień do importu', tone: 'error' });
      return;
    }
    const workbook = workbookRef.current;
    if (!workbook || !sheetName) {
      toast({ title: 'Wybierz plik i arkusz.', tone: 'error' });
      return;
    }
    const items = parseSheetItems(workbook, sheetName);
    if (items.length === 0) {
      toast({ title: 'Brak pozycji do importu.', tone: 'error' });
      return;
    }
    createSessionMutation.mutate({
      shift,
      dateKey: sessionDate,
      planSheet: sheetName,
      fileName,
      createdBy: user?.name ?? user?.username ?? 'nieznany',
      items
    });
  };

  const handleAddManual = () => {
    if (readOnly) {
      toast({ title: 'Brak uprawnień do zapisu', tone: 'error' });
      return;
    }
    if (!activeSessionId) {
      toast({ title: 'Wybierz lub utwórz zmianę.', tone: 'error' });
      return;
    }
    addItemMutation.mutate({
      sessionId: activeSessionId,
      indexCode: manualIndex.trim(),
      description: manualDescription.trim() || null,
      station: manualStation.trim() || null
    });
  };

  const handleAddOperator = (item: ZeszytItem) => {
    const value = (operatorInputs[item.id] ?? '').trim();
    if (!value) {
      toast({ title: 'Podaj numer operatora.', tone: 'error' });
      return;
    }
    addOperatorMutation.mutate({ itemId: item.id, operatorNo: value });
  };

  const handleStartEditItem = (item: ZeszytItem) => {
    setEditingItems((prev) => ({
      ...prev,
      [item.id]: {
        indexCode: item.indexCode,
        station: item.station ?? '',
        description: item.description ?? ''
      }
    }));
  };

  const handleCancelEditItem = (itemId: string) => {
    setEditingItems((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleSaveEditItem = (itemId: string) => {
    const draft = editingItems[itemId];
    if (!draft) return;
    const indexCode = draft.indexCode.trim();
    if (!indexCode) {
      toast({ title: 'Podaj indeks.', tone: 'error' });
      return;
    }
    updateItemMutation.mutate({
      itemId,
      indexCode,
      station: draft.station.trim() || null,
      description: draft.description.trim() || null
    });
    setEditingItems((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleSetDefaultQty = (item: ZeszytItem) => {
    const raw = qtyInputs[item.id] ?? '';
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Podaj poprawną ilość.', tone: 'error' });
      return;
    }
    updateItemMutation.mutate({ itemId: item.id, defaultQty: qty });
  };

  const handleReceive = (item: ZeszytItem, overrideQty?: number) => {
    if (readOnly) {
      toast({ title: 'Brak uprawnień do zapisu', tone: 'error' });
      return;
    }
    const operatorNo = operatorSelection[item.id] ?? '';
    if (!operatorNo) {
      toast({ title: 'Wybierz operatora.', tone: 'error' });
      return;
    }
    const qtyValue = overrideQty ?? Number(qtyInputs[item.id] ?? '');
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
      toast({ title: 'Podaj poprawną ilość.', tone: 'error' });
      return;
    }
    addReceiptMutation.mutate({
      itemId: item.id,
      operatorNo,
      qty: qtyValue,
      flagPw: flagInputs[item.id] ?? false
    });
  };

  const handleStartEditReceipt = (receipt: ZeszytReceipt) => {
    setEditingReceipts((prev) => ({
      ...prev,
      [receipt.id]: {
        qty: String(receipt.qty),
        operatorNo: receipt.operatorNo,
        flagPw: receipt.flagPw
      }
    }));
  };

  const handleSaveEditReceipt = (receiptId: string) => {
    const draft = editingReceipts[receiptId];
    if (!draft) return;
    const qty = Number(draft.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Podaj poprawną ilość.', tone: 'error' });
      return;
    }
    updateReceiptMutation.mutate({
      receiptId,
      qty,
      operatorNo: draft.operatorNo,
      flagPw: draft.flagPw,
      editedBy: user?.name ?? user?.username ?? null
    });
    setEditingReceipts((prev) => {
      const next = { ...prev };
      delete next[receiptId];
      return next;
    });
  };

  const handleCancelEditReceipt = (receiptId: string) => {
    setEditingReceipts((prev) => {
      const next = { ...prev };
      delete next[receiptId];
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    const items = activeSessionData?.items ?? [];
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (onlyWithOperators && item.operators.length === 0) return false;
      if (!needle) return true;
      return (
        item.indexCode.toLowerCase().includes(needle) ||
        (item.station ?? '').toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [search, onlyWithOperators, activeSessionData?.items]);

  const reportData = useMemo(() => {
    if (!activeSessionData) return null;
    const itemMap = new Map(activeSessionData.items.map((item) => [item.id, item]));
    const operators = new Map<
      string,
      {
        operatorNo: string;
        totalQty: number;
        pallets: number;
        receipts: Array<{
          id: string;
          qty: number;
          receivedAt: string;
          approvedAt?: string | null;
          indexCode: string;
          station?: string | null;
          description?: string | null;
          approved: boolean;
          flagPw: boolean;
        }>;
      }
    >();
    let totalQty = 0;
    let totalPallets = 0;

    (activeSessionData.receipts ?? []).forEach((receipt) => {
      totalQty += receipt.qty;
      totalPallets += 1;
      const item = itemMap.get(receipt.itemId);
      const entry =
        operators.get(receipt.operatorNo) ??
        ({
          operatorNo: receipt.operatorNo,
          totalQty: 0,
          pallets: 0,
          receipts: []
        } as {
          operatorNo: string;
          totalQty: number;
          pallets: number;
          receipts: Array<{
            id: string;
            qty: number;
          receivedAt: string;
          approvedAt?: string | null;
          indexCode: string;
          station?: string | null;
          description?: string | null;
          approved: boolean;
          flagPw: boolean;
          }>;
        });

      entry.totalQty += receipt.qty;
      entry.pallets += 1;
      entry.receipts.push({
        id: receipt.id,
        qty: receipt.qty,
        receivedAt: receipt.receivedAt,
        approvedAt: receipt.approvedAt ?? null,
        indexCode: item?.indexCode ?? 'Brak indeksu',
        station: item?.station ?? null,
        description: item?.description ?? null,
        approved: receipt.approved,
        flagPw: receipt.flagPw
      });
      operators.set(receipt.operatorNo, entry);
    });

    const operatorList = Array.from(operators.values()).sort((a, b) =>
      a.operatorNo.localeCompare(b.operatorNo, 'pl', { numeric: true })
    );

    operatorList.forEach((entry) => {
      entry.receipts.sort(
        (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
      );
    });

    return {
      totalQty,
      totalPallets,
      operatorCount: operators.size,
      operators: operatorList
    };
  }, [activeSessionData]);

  const canExportReport = Boolean(reportData && reportData.totalPallets > 0);

  const handleExportExcel = () => {
    if (!activeSessionData || !reportData) {
      toast({ title: 'Brak danych do eksportu.', tone: 'error' });
      return;
    }
    const summaryRows = reportData.operators.map((operator) => ({
      Operator: operator.operatorNo,
      Sztuki: operator.totalQty,
      Palety: operator.pallets
    }));

    const detailRows = reportData.operators.flatMap((operator) =>
      operator.receipts.map((receipt) => ({
        Operator: operator.operatorNo,
        Indeks: receipt.indexCode,
        Stanowisko: receipt.station ?? '',
        Opis: receipt.description ?? '',
        Ilosc: receipt.qty,
        Spisano: new Date(receipt.receivedAt).toLocaleString('pl-PL'),
        'Zatwierdzono PW': receipt.approvedAt
          ? new Date(receipt.approvedAt).toLocaleString('pl-PL')
          : '',
        'PW OK': receipt.approved ? 'TAK' : '',
        'Problem PW': receipt.flagPw ? 'TAK' : ''
      }))
    );

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Podsumowanie');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Odbiory');

    const session = activeSessionData.session;
    const fileLabel = `Zeszyt_raport_${session.dateKey}_${session.shift}`;
    XLSX.writeFile(workbook, `${fileLabel}.xlsx`);
  };

  const handleExportPdf = () => {
    if (!activeSessionData || !reportData) {
      toast({ title: 'Brak danych do eksportu.', tone: 'error' });
      return;
    }
    const session = activeSessionData.session;
    const summary = `
      <section class="summary">
        <div>
          <div class="label">Zmiana</div>
          <div class="value">${escapeHtml(`${session.shift} zmiana`)}</div>
          <div class="muted">${escapeHtml(`${session.dateKey} • ${session.planSheet}`)}</div>
          ${session.fileName ? `<div class="muted">${escapeHtml(session.fileName)}</div>` : ''}
        </div>
        <div>
          <div class="label">Suma sztuk</div>
          <div class="value">${reportData.totalQty}</div>
        </div>
        <div>
          <div class="label">Palety</div>
          <div class="value">${reportData.totalPallets}</div>
          <div class="muted">Operatorów: ${reportData.operatorCount}</div>
        </div>
      </section>
    `;

    const operatorSections = reportData.operators
      .map((operator) => {
        const rows = operator.receipts
          .map(
            (receipt) => `
              <tr>
                <td>${escapeHtml(receipt.indexCode)}</td>
                <td>${escapeHtml(receipt.station ?? '')}</td>
                <td>${escapeHtml(receipt.description ?? '')}</td>
                <td class="num">${receipt.qty}</td>
                <td>${escapeHtml(new Date(receipt.receivedAt).toLocaleString('pl-PL'))}</td>
                <td>${escapeHtml(
                  receipt.approvedAt
                    ? new Date(receipt.approvedAt).toLocaleString('pl-PL')
                    : ''
                )}</td>
                <td>${receipt.approved ? 'PW OK' : ''}</td>
                <td>${receipt.flagPw ? 'Problem PW' : ''}</td>
              </tr>
            `
          )
          .join('');
        return `
          <section class="operator">
            <h2>Operator ${escapeHtml(operator.operatorNo)}</h2>
            <div class="meta">Sztuki: ${operator.totalQty} • Palety: ${operator.pallets}</div>
            <table>
              <thead>
                <tr>
                  <th>Indeks</th>
                  <th>Stanowisko</th>
                  <th>Opis</th>
                  <th class="num">Ilość</th>
                  <th>Spisano</th>
                  <th>Zatwierdzono PW</th>
                  <th>PW OK</th>
                  <th>Problem PW</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </section>
        `;
      })
      .join('');

    const html = `
      <!doctype html>
      <html lang="pl">
        <head>
          <meta charset="utf-8" />
          <title>Raport Zeszyt</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
            h1 { font-size: 20px; margin: 0 0 12px; }
            h2 { font-size: 16px; margin: 18px 0 6px; }
            .summary { display: grid; grid-template-columns: 1.2fr 0.6fr 0.6fr; gap: 16px; border: 1px solid #ddd; padding: 12px; border-radius: 8px; }
            .label { font-size: 11px; text-transform: uppercase; color: #666; }
            .value { font-size: 16px; font-weight: 700; }
            .muted { font-size: 11px; color: #666; }
            .operator { margin-top: 16px; page-break-inside: avoid; }
            .meta { font-size: 12px; color: #444; margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
            th, td { border: 1px solid #ddd; padding: 6px; font-size: 11px; text-align: left; width: 12.5%; word-wrap: break-word; }
            th { background: #f4f4f4; }
            .num { text-align: right; }
            @media print {
              body { margin: 12mm; }
              h1 { margin-top: 0; }
            }
          </style>
        </head>
        <body>
          <h1>Raport zmiany – ${escapeHtml(session.dateKey)}</h1>
          ${summary}
          ${operatorSections}
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: 'Nie udało się otworzyć eksportu PDF.', tone: 'error' });
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zeszyt produkcji"
        subtitle="Import planu i rejestrowanie odbiorów palet na zmianie"
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'zeszyt' | 'raport')}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="zeszyt">Zeszyt</TabsTrigger>
          <TabsTrigger value="raport">Raport</TabsTrigger>
        </TabsList>
        <TabsContent value="zeszyt" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Sesja zmiany</p>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <SelectField
              value={activeSessionId ?? ''}
              onChange={(event) => setActiveSessionId(event.target.value || null)}
            >
              <option value="">Wybierz zmianę</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {buildSessionLabel(session)}
                </option>
              ))}
            </SelectField>
            <Button
              variant="outline"
              onClick={() => {
                if (!activeSessionId) return;
                if (!window.confirm('Usunąć całą sesję?')) return;
                removeSessionMutation.mutate(activeSessionId);
              }}
              disabled={!activeSessionId || removeSessionMutation.isPending || readOnly}
              className="border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
            >
              Usuń sesję
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Zmiana</label>
              <SelectField
                value={shift}
                onChange={(event) => setShift(event.target.value as ZeszytShift)}
              >
                {SHIFT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Dzień</label>
              <Input value={sessionDate} readOnly />
            </div>
          </div>
          {sessionsLoading && <p className="text-sm text-dim">Wczytywanie sesji...</p>}
        </Card>

        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Import planu</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Plik Excel</label>
              <Input type="file" accept=".xlsx,.xls" onChange={handleFileChange} disabled={readOnly} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-dim">Arkusz</label>
              <SelectField
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                disabled={sheetNames.length === 0}
              >
                <option value="">Wybierz arkusz</option>
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primaryEmber"
              onClick={handleImport}
              disabled={createSessionMutation.isPending || readOnly}
            >
              Importuj zmianę
            </Button>
          </div>
        </Card>
      </div>

      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dodaj indeks ręcznie</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            value={manualStation}
            onChange={(event) => setManualStation(event.target.value)}
            placeholder="Stanowisko (np. WTR 45)"
            disabled={readOnly}
          />
          <Input
            value={manualIndex}
            onChange={(event) => setManualIndex(event.target.value)}
            placeholder="Indeks"
            disabled={readOnly}
          />
          <Input
            value={manualDescription}
            onChange={(event) => setManualDescription(event.target.value)}
            placeholder="Opis (opcjonalnie)"
            disabled={readOnly}
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleAddManual}
            disabled={!activeSessionId || addItemMutation.isPending || readOnly}
          >
            Dodaj indeks
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Filtry</p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj po indeksie, opisie lub stanowisku"
          />
          <Toggle
            checked={onlyWithOperators}
            onCheckedChange={setOnlyWithOperators}
            label="Tylko z operatorami"
          />
        </div>
      </Card>

      {sessionLoading ? (
        <p className="text-sm text-dim">Wczytywanie pozycji...</p>
      ) : !activeSessionData ? (
        <EmptyState
          title="Brak aktywnej zmiany"
          description="Zaimportuj plan lub wybierz istniejącą zmianę."
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="Brak pozycji"
          description="Nie znaleziono pozycji spełniających kryteria."
        />
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const receipts = receiptsByItem.get(item.id) ?? [];
            const lastReceipt = lastReceiptByItem.get(item.id);
            const selectedOperator = operatorSelection[item.id] ?? '';
            const defaultQty = item.defaultQty ?? null;
            const itemEditing = editingItems[item.id];
            return (
              <Card key={item.id} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[220px] flex-1 space-y-2">
                    {itemEditing ? (
                      <div className="grid gap-2 md:grid-cols-3">
                        <Input
                          value={itemEditing.station}
                          onChange={(event) =>
                            setEditingItems((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...itemEditing,
                                station: event.target.value
                              }
                            }))
                          }
                          placeholder="Stanowisko (np. WTR 45)"
                          disabled={readOnly}
                        />
                        <Input
                          value={itemEditing.indexCode}
                          onChange={(event) =>
                            setEditingItems((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...itemEditing,
                                indexCode: event.target.value
                              }
                            }))
                          }
                          placeholder="Indeks"
                          disabled={readOnly}
                        />
                        <Input
                          value={itemEditing.description}
                          onChange={(event) =>
                            setEditingItems((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...itemEditing,
                                description: event.target.value
                              }
                            }))
                          }
                          placeholder="Opis (opcjonalnie)"
                          disabled={readOnly}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.station && <Badge tone="info">{item.station}</Badge>}
                          <span className="text-lg font-semibold text-title">{item.indexCode}</span>
                          {defaultQty && (
                            <Badge tone="success">Domyślna: {defaultQty}</Badge>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-sm text-dim">{item.description}</p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 text-xs text-dim">
                    {lastReceipt && (
                      <div className="text-right">
                        <p>Ostatni odbiór</p>
                        <p className="font-semibold text-title">
                          {lastReceipt.qty} szt •{' '}
                          {new Date(lastReceipt.receivedAt).toLocaleTimeString('pl-PL', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    )}
                    {itemEditing ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => handleSaveEditItem(item.id)}
                          disabled={readOnly || updateItemMutation.isPending}
                        >
                          Zapisz kafel
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleCancelEditItem(item.id)}
                        >
                          Anuluj
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => handleStartEditItem(item)}
                        disabled={readOnly}
                      >
                        Edytuj kafel
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                      Operatorzy
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {item.operators.length === 0 ? (
                        <span className="text-xs text-dim">Brak operatorów</span>
                      ) : (
                        item.operators.map((op) => (
                          <Badge key={op}>{op}</Badge>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={operatorInputs[item.id] ?? ''}
                        onChange={(event) =>
                          setOperatorInputs((prev) => ({
                            ...prev,
                            [item.id]: event.target.value
                          }))
                        }
                        placeholder="Numer operatora"
                        className="w-48"
                        disabled={readOnly}
                      />
                      <Button
                        variant="secondary"
                        onClick={() => handleAddOperator(item)}
                        disabled={readOnly || addOperatorMutation.isPending}
                      >
                        Dodaj operatora
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dim">Odbiór</p>
                    <SelectField
                      value={selectedOperator}
                      onChange={(event) =>
                        setOperatorSelection((prev) => ({
                          ...prev,
                          [item.id]: event.target.value
                        }))
                      }
                      disabled={item.operators.length === 0 || readOnly}
                    >
                      <option value="">Wybierz operatora</option>
                      {item.operators.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </SelectField>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={qtyInputs[item.id] ?? ''}
                        onChange={(event) =>
                          setQtyInputs((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                        placeholder="Ilość sztuk"
                        inputMode="numeric"
                        className="w-32"
                        disabled={readOnly}
                      />
                      <Button
                        variant="primaryEmber"
                        onClick={() => handleReceive(item)}
                        disabled={readOnly || addReceiptMutation.isPending}
                      >
                        Odbierz
                      </Button>
                      {defaultQty && (
                        <Button
                          variant="outline"
                          onClick={() => handleReceive(item, defaultQty)}
                          disabled={readOnly || addReceiptMutation.isPending}
                        >
                          Odbierz domyślną
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => handleSetDefaultQty(item)}
                        disabled={readOnly || updateItemMutation.isPending}
                      >
                        Ustaw domyślną
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dim">Historia</p>
                    {receipts.length === 0 ? (
                      <p className="text-xs text-dim">Brak odbiorów.</p>
                    ) : (
                      <div className="space-y-2">
                        {receipts
                          .slice()
                          .reverse()
                          .map((receipt) => {
                            const editing = editingReceipts[receipt.id];
                            const edited = Boolean(receipt.editedAt);
                            const receiptTone = receipt.flagPw
                              ? 'warning'
                              : receipt.approved
                                ? 'success'
                                : null;
                            return (
                              <div
                                key={receipt.id}
                                className={cn(
                                  'rounded-xl border-2 border-border bg-surface2 p-3 text-xs',
                                  edited && 'border-[rgba(255,186,122,0.55)]',
                                  receiptTone === 'success' &&
                                    'border-[color:color-mix(in_srgb,var(--success)_80%,transparent)] shadow-[0_0_0_2px_rgba(46,204,113,0.45)]',
                                  receiptTone === 'warning' &&
                                    'border-[color:color-mix(in_srgb,var(--warning)_80%,transparent)] shadow-[0_0_0_2px_rgba(255,186,122,0.45)]'
                                )}
                              >
                                {editing ? (
                                  <div className="space-y-2">
                                    <div className="grid gap-2 md:grid-cols-2">
                                      <Input
                                        value={editing.operatorNo}
                                        onChange={(event) =>
                                          setEditingReceipts((prev) => ({
                                            ...prev,
                                            [receipt.id]: {
                                              ...editing,
                                              operatorNo: event.target.value
                                            }
                                          }))
                                        }
                                      />
                                      <Input
                                        value={editing.qty}
                                        onChange={(event) =>
                                          setEditingReceipts((prev) => ({
                                            ...prev,
                                            [receipt.id]: { ...editing, qty: event.target.value }
                                          }))
                                        }
                                        inputMode="numeric"
                                      />
                                    </div>
                                    <Toggle
                                      checked={editing.flagPw}
                                      onCheckedChange={(value) =>
                                        setEditingReceipts((prev) => ({
                                          ...prev,
                                          [receipt.id]: { ...editing, flagPw: value }
                                        }))
                                      }
                                      label="Problem z zatwierdzeniem PW"
                                      disabled={readOnly}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        variant="secondary"
                                        onClick={() => handleSaveEditReceipt(receipt.id)}
                                        disabled={readOnly || updateReceiptMutation.isPending}
                                      >
                                        Zapisz
                                      </Button>
                                      <Button
                                        variant="outline"
                                        onClick={() => handleCancelEditReceipt(receipt.id)}
                                      >
                                        Anuluj
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="space-y-1">
                                      <p className="text-base font-bold">
                                        <span style={{ color: '#A855F7' }}>
                                          {receipt.qty} szt
                                        </span>
                                        <span className="mx-2 text-dim">•</span>
                                        <span style={{ color: 'var(--brand)' }}>
                                          {receipt.operatorNo}
                                        </span>
                                      </p>
                                      <p className="text-dim">
                                        {new Date(receipt.receivedAt).toLocaleString('pl-PL')}
                                      </p>
                                      {edited && (
                                        <p className="text-[11px] text-warning">
                                          Edytowano {receipt.editedAt ? new Date(receipt.editedAt).toLocaleString('pl-PL') : ''}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Toggle
                                        checked={receipt.flagPw}
                                        onCheckedChange={(value) =>
                                          updateReceiptMutation.mutate({
                                            receiptId: receipt.id,
                                            flagPw: value,
                                            approved: value ? false : receipt.approved,
                                            editedBy: user?.name ?? user?.username ?? null
                                          })
                                        }
                                        label="Problem z zatwierdzeniem PW"
                                        disabled={readOnly || updateReceiptMutation.isPending}
                                      />
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          updateReceiptMutation.mutate({
                                            receiptId: receipt.id,
                                            approved: !receipt.approved,
                                            flagPw: receipt.approved ? receipt.flagPw : false,
                                            approvedBy: receipt.approved
                                              ? null
                                              : user?.name ?? user?.username ?? null,
                                            editedBy: user?.name ?? user?.username ?? null
                                          })
                                        }
                                        disabled={readOnly || updateReceiptMutation.isPending}
                                        className={cn(
                                          'border-[color:color-mix(in_srgb,var(--success)_45%,transparent)]',
                                          receipt.approved
                                            ? 'bg-[color:color-mix(in_srgb,var(--success)_22%,transparent)] text-success'
                                            : 'text-success hover:bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)]'
                                        )}
                                      >
                                        <CheckCircle className="mr-2 h-4 w-4" />
                                        {receipt.approved ? 'Zatwierdzono PW' : 'Zatwierdź PW'}
                                      </Button>
                                      <Button
                                        variant="secondary"
                                        onClick={() => handleStartEditReceipt(receipt)}
                                        disabled={readOnly}
                                      >
                                        Edytuj
                                      </Button>
                                      <Button
                                        variant="outline"
                                        onClick={() => removeReceiptMutation.mutate(receipt.id)}
                                        disabled={readOnly || removeReceiptMutation.isPending}
                                        className="border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                                      >
                                        Usuń
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
        </TabsContent>

        <TabsContent value="raport" className="space-y-4">
          {sessionLoading ? (
            <p className="text-sm text-dim">Wczytywanie raportu...</p>
          ) : !activeSessionData ? (
            <EmptyState
              title="Brak aktywnej zmiany"
              description="Wybierz zmianę, aby zobaczyć raport."
            />
          ) : !reportData || reportData.totalPallets === 0 ? (
            <EmptyState
              title="Brak odbiorów"
              description="Na tej zmianie nie ma jeszcze zarejestrowanych palet."
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={handleExportExcel}
                  disabled={!canExportReport}
                >
                  Eksportuj Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportPdf}
                  disabled={!canExportReport}
                >
                  Eksportuj PDF
                </Button>
              </div>
              <Card className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">Zmiana</p>
                  <p className="text-sm font-semibold text-title">
                    {activeSessionData.session.shift} zmiana
                  </p>
                  <p className="text-xs text-dim">
                    {activeSessionData.session.dateKey} • {activeSessionData.session.planSheet}
                  </p>
                  {activeSessionData.session.fileName && (
                    <p className="text-xs text-dim">{activeSessionData.session.fileName}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">Suma sztuk</p>
                  <p className="text-4xl font-bold" style={{ color: '#A855F7' }}>
                    {reportData.totalQty}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">Palety</p>
                  <p className="text-2xl font-semibold text-title">
                    {reportData.totalPallets}
                  </p>
                  <p className="text-xs text-dim">Operatorów: {reportData.operatorCount}</p>
                </div>
              </Card>

              <div className="space-y-4">
                {reportData.operators.map((operator) => (
                  <Card key={operator.operatorNo} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                          Operator
                        </p>
                        <p className="text-lg font-semibold text-title">{operator.operatorNo}</p>
                      </div>
                      <div className="flex flex-wrap gap-6 text-sm">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-dim">Sztuki</p>
                          <p className="text-2xl font-bold" style={{ color: '#A855F7' }}>
                            {operator.totalQty}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-dim">Palety</p>
                          <p className="text-lg font-semibold text-title">{operator.pallets}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {operator.receipts.map((receipt) => (
                        <div
                          key={receipt.id}
                          className="rounded-xl border border-border bg-surface2 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-base font-semibold">
                                <span style={{ color: '#A855F7' }}>{receipt.qty} szt</span>
                                <span className="mx-2 text-dim">•</span>
                                <span className="text-title">{receipt.indexCode}</span>
                                {receipt.station && (
                                  <span className="ml-2 text-xs text-dim">
                                    ({receipt.station})
                                  </span>
                                )}
                              </p>
                              {receipt.description && (
                                <p className="text-xs text-dim">{receipt.description}</p>
                              )}
                            </div>
                            <div className="space-y-2 text-right text-xs text-dim">
                              <p>Spisano: {new Date(receipt.receivedAt).toLocaleString('pl-PL')}</p>
                              <p>
                                Zatwierdzono PW:{' '}
                                {receipt.approvedAt
                                  ? new Date(receipt.approvedAt).toLocaleString('pl-PL')
                                  : '-'}
                              </p>
                              <div className="flex flex-wrap justify-end gap-2">
                                {receipt.approved && <Badge tone="success">PW OK</Badge>}
                                {receipt.flagPw && <Badge tone="warning">Problem PW</Badge>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
