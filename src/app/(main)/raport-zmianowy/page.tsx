'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  addRaportZmianowyEntry,
  addRaportZmianowyItem,
  createRaportZmianowySession,
  getRaportZmianowyEntries,
  getRaportZmianowySession,
  getRaportZmianowySessions,
  getTodayKey,
  removeRaportZmianowyEntry,
  removeRaportZmianowySession,
  updateRaportZmianowyEntry,
  updateRaportZmianowyItem
} from '@/lib/api';
import type {
  RaportZmianowyEntry,
  RaportZmianowyEntryLog,
  RaportZmianowyItem,
  RaportZmianowySession,
  RaportZmianowySessionData
} from '@/lib/api/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isAdmin, isReadOnly } from '@/lib/auth/access';
import { cn } from '@/lib/utils/cn';

type ParsedItem = {
  indexCode: string;
  description?: string | null;
  station?: string | null;
};

type SummaryGroup = {
  key: string;
  label: string;
  entries: RaportZmianowyEntryLog[];
};

type ShiftGroup = {
  key: '1' | '2' | '3';
  label: string;
  entries: RaportZmianowyEntryLog[];
};

const textAreaClass =
  'w-full rounded-xl border border-border bg-[rgba(0,0,0,0.40)] px-3 py-2 text-sm text-body placeholder:text-dim hover:border-borderStrong focus:border-[rgba(255,106,0,0.55)] focus:outline-none focus:ring-2 focus:ring-ring disabled:text-disabled disabled:opacity-55';

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
  let lastDescription = '';
  let lastIndices: string[] = [];
  let lastStation = '';

  rows.slice(1).forEach((row) => {
    const rawDescription = row[descriptionCol];
    const stationRaw = row[stationCol];
    const station = stationRaw ? String(stationRaw).trim() : '';
    const hasDescription = rawDescription !== undefined && rawDescription !== null;
    const descriptionValue = hasDescription ? String(rawDescription).trim() : '';
    const hasStation = Boolean(station);
    if (!descriptionValue && !hasStation) return;
    if (station) {
      lastStation = station;
    }
    let description = '';
    let indices: string[] = [];
    if (descriptionValue) {
      description = descriptionValue;
      indices = parseIndexTokens(description);
      if (indices.length === 0) return;
      lastDescription = description;
      lastIndices = indices;
    } else {
      if (lastIndices.length === 0) return;
      description = lastDescription;
      indices = lastIndices;
    }
    indices.forEach((indexCode) => {
      items.push({
        indexCode,
        description,
        station: station || lastStation || null
      });
    });
  });

  return items;
};

const buildSessionLabel = (session: RaportZmianowySession) =>
  `${session.dateKey} - ${session.planSheet}`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pad = (value: number) => String(value).padStart(2, '0');

const toLocalInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;

const getDefaultSummaryRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(7, 0, 0, 0);
  if (now < start) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  end.setHours(6, 59, 0, 0);
  return { start, end };
};

const normalizeLabel = (value?: string | null, fallback = '') => {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
};

const getShiftKey = (date: Date): ShiftGroup['key'] => {
  const hour = date.getHours();
  if (hour >= 7 && hour < 15) return '1';
  if (hour >= 15 && hour < 23) return '2';
  return '3';
};

const splitEntriesByShift = (entries: RaportZmianowyEntryLog[]): ShiftGroup[] => {
  const buckets: Record<ShiftGroup['key'], RaportZmianowyEntryLog[]> = {
    '1': [],
    '2': [],
    '3': []
  };
  entries.forEach((entry) => {
    const key = getShiftKey(new Date(entry.createdAt));
    buckets[key].push(entry);
  });
  return [
    { key: '1', label: 'Zmiana 1', entries: buckets['1'] },
    { key: '2', label: 'Zmiana 2', entries: buckets['2'] },
    { key: '3', label: 'Zmiana 3', entries: buckets['3'] }
  ];
};

export default function RaportZmianowyPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'RAPORT_ZMIANOWY');
  const adminMode = isAdmin(user);

  const [activeTab, setActiveTab] = useState<'plan' | 'live' | 'summary'>('live');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionDate, setSessionDate] = useState(() => getTodayKey());
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const [search, setSearch] = useState('');
  const [manualIndex, setManualIndex] = useState('');
  const [manualStation, setManualStation] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [entryDrafts, setEntryDrafts] = useState<Record<string, string>>({});
  const [editingItems, setEditingItems] = useState<
    Record<string, { indexCode: string; station: string; description: string }>
  >({});
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryDraft, setEditingEntryDraft] = useState('');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const defaultRange = useMemo(() => getDefaultSummaryRange(), []);
  const [summaryFrom, setSummaryFrom] = useState(toLocalInputValue(defaultRange.start));
  const [summaryTo, setSummaryTo] = useState(toLocalInputValue(defaultRange.end));
  const [summaryIndex, setSummaryIndex] = useState('');
  const [summaryStation, setSummaryStation] = useState('');
  const [summaryGroupBy, setSummaryGroupBy] = useState<'station' | 'plan'>('station');
  const [summaryRows, setSummaryRows] = useState<RaportZmianowyEntryLog[]>([]);
  const [planOrderKeys, setPlanOrderKeys] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('raport-zmianowy-tab');
    if (stored === 'plan' || stored === 'live' || stored === 'summary') {
      setActiveTab(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('raport-zmianowy-tab', activeTab);
  }, [activeTab]);

  const todayKey = useMemo(() => getTodayKey(), []);
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError
  } = useQuery({
    queryKey: ['raport-zmianowy-sessions', todayKey],
    queryFn: () => getRaportZmianowySessions(todayKey),
    retry: false
  });

  const {
    data: sessionData,
    isLoading: sessionLoading,
    error: sessionError
  } = useQuery({
    queryKey: ['raport-zmianowy-session', activeSessionId],
    queryFn: () => getRaportZmianowySession(activeSessionId ?? ''),
    enabled: Boolean(activeSessionId),
    retry: false
  });

  const [stickySessionData, setStickySessionData] = useState<RaportZmianowySessionData | null>(
    null
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessions.length === 0) return;
    if (activeSessionId) return;
    const stored = window.localStorage.getItem('raport-zmianowy-active-session');
    const fallback = sessions[0]?.id ?? null;
    const next = stored && sessions.some((session) => session.id === stored) ? stored : fallback;
    if (next) {
      setActiveSessionId(next);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!activeSessionId) return;
    window.localStorage.setItem('raport-zmianowy-active-session', activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessionData) return;
    setStickySessionData(sessionData);
  }, [sessionData]);

  useEffect(() => {
    if (!sessionsError) return;
    toast({
      title: 'Błąd pobierania raportów',
      description: sessionsError.message ?? 'Nie udało się pobrać danych.'
    });
  }, [sessionsError, toast]);

  const activeSessionData = sessionData ?? stickySessionData;

  useEffect(() => {
    let cancelled = false;
    if (summaryGroupBy !== 'plan') {
      setPlanOrderKeys([]);
      return undefined;
    }
    const sessionIds = Array.from(
      new Set(summaryRows.map((entry) => entry.sessionId).filter(Boolean))
    ) as string[];
    if (sessionIds.length === 0) {
      setPlanOrderKeys([]);
      return undefined;
    }
    const loadPlanOrder = async () => {
      const sessionsData = await Promise.all(
        sessionIds.map(async (sessionId) => {
          if (activeSessionData?.session.id === sessionId && activeSessionData) {
            return activeSessionData;
          }
          try {
            return await getRaportZmianowySession(sessionId);
          } catch {
            return null;
          }
        })
      );
      const orderedSessions = sessionsData
        .filter(Boolean)
        .sort((a, b) => a!.session.dateKey.localeCompare(b!.session.dateKey, 'pl', { numeric: true }))
        .map((item) => item!);
      const seen = new Set<string>();
      const order: string[] = [];
      orderedSessions.forEach((session) => {
        session.items.forEach((item) => {
          const station = normalizeLabel(item.station, 'Brak maszyny');
          const index = normalizeLabel(item.indexCode, 'Brak indeksu');
          const key = `${station}||${index}`;
          if (seen.has(key)) return;
          seen.add(key);
          order.push(key);
        });
      });
      if (!cancelled) {
        setPlanOrderKeys(order);
      }
    };
    void loadPlanOrder();
    return () => {
      cancelled = true;
    };
  }, [activeSessionData, summaryGroupBy, summaryRows]);

  useEffect(() => {
    if (!sessionError) return;
    toast({
      title: 'Błąd pobierania raportu',
      description: sessionError.message ?? 'Nie udało się pobrać danych.'
    });
  }, [sessionError, toast]);

  const entriesByItem = useMemo(() => {
    const map = new Map<string, RaportZmianowyEntry[]>();
    (activeSessionData?.entries ?? []).forEach((entry) => {
      const list = map.get(entry.itemId) ?? [];
      list.push(entry);
      map.set(entry.itemId, list);
    });
    map.forEach((list) => {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    return map;
  }, [activeSessionData?.entries]);

  const filteredItems = useMemo(() => {
    const items = activeSessionData?.items ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const indexCode = item.indexCode.toLowerCase();
      const station = item.station?.toLowerCase() ?? '';
      const description = item.description?.toLowerCase() ?? '';
      return (
        indexCode.includes(query) ||
        station.includes(query) ||
        description.includes(query)
      );
    });
  }, [activeSessionData?.items, search]);

  const createSessionMutation = useMutation({
    mutationFn: createRaportZmianowySession,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-sessions'] });
      queryClient.setQueryData(['raport-zmianowy-session', data.session.id], data);
      setActiveSessionId(data.session.id);
      toast({ title: 'Utwórzono raport', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        SHEET_REQUIRED: 'Podaj nazwę planu / arkusza.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie zapisano raportu.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const removeSessionMutation = useMutation({
    mutationFn: removeRaportZmianowySession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-sessions'] });
      queryClient.removeQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      setActiveSessionId(null);
      toast({ title: 'Usunięto raport', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunięto raportu.', tone: 'error' });
    }
  });

  const addItemMutation = useMutation({
    mutationFn: addRaportZmianowyItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      setManualIndex('');
      setManualStation('');
      setManualDescription('');
      toast({ title: 'Dodano indeks', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INDEX_REQUIRED: 'Podaj indeks.',
        NOT_FOUND: 'Brak aktywnego raportu.'
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
    mutationFn: updateRaportZmianowyItem,
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      setEditingItems((prev) => {
        const next = { ...prev };
        delete next[payload.itemId];
        return next;
      });
      toast({ title: 'Zapisano indeks', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
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

  const addEntryMutation = useMutation({
    mutationFn: addRaportZmianowyEntry,
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      setEntryDrafts((prev) => ({ ...prev, [payload.itemId]: '' }));
      toast({ title: 'Dodano wpis', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOTE_REQUIRED: 'Podaj treść wpisu.',
        NOT_FOUND: 'Nie znaleziono indeksu.'
      };
      const fallback = messageMap[err.message];
      toast({
        title: fallback ?? 'Nie dodano wpisu.',
        description: fallback ? undefined : `Kod błędu: ${err.message}`,
        tone: 'error'
      });
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: updateRaportZmianowyEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      setEditingEntryId(null);
      setEditingEntryDraft('');
      toast({ title: 'Zapisano zmiany', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOTE_REQUIRED: 'Podaj treść wpisu.',
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

  const removeEntryMutation = useMutation({
    mutationFn: removeRaportZmianowyEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['raport-zmianowy-session', activeSessionId] });
      toast({ title: 'Usunięto wpis', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunięto wpisu.', tone: 'error' });
    }
  });

  const fetchSummaryMutation = useMutation({
    mutationFn: getRaportZmianowyEntries,
    onSuccess: (data) => {
      setSummaryRows(data);
      toast({ title: 'Wczytano dane do podsumowania', tone: 'success' });
    },
    onError: (err: Error) => {
      toast({
        title: 'Nie udało się pobrać danych.',
        description: err.message ? `Kod błędu: ${err.message}` : undefined,
        tone: 'error'
      });
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
      toast({ title: 'Wybierz lub utwórz raport.', tone: 'error' });
      return;
    }
    addItemMutation.mutate({
      sessionId: activeSessionId,
      indexCode: manualIndex.trim(),
      description: manualDescription.trim() || null,
      station: manualStation.trim() || null
    });
  };

  const handleStartEditItem = (item: RaportZmianowyItem) => {
    setEditingItems((prev) => ({
      ...prev,
      [item.id]: {
        indexCode: item.indexCode,
        station: item.station ?? '',
        description: item.description ?? ''
      }
    }));
  };

  const handleSaveEditItem = (itemId: string) => {
    const draft = editingItems[itemId];
    if (!draft) return;
    updateItemMutation.mutate({
      itemId,
      indexCode: draft.indexCode,
      station: draft.station.trim() || null,
      description: draft.description.trim() || null
    });
  };

  const handleCancelEditItem = (itemId: string) => {
    setEditingItems((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleAddEntry = (item: RaportZmianowyItem) => {
    if (readOnly) {
      toast({ title: 'Brak uprawnień do zapisu', tone: 'error' });
      return;
    }
    const note = (entryDrafts[item.id] ?? '').trim();
    if (!note) {
      toast({ title: 'Podaj treść wpisu.', tone: 'error' });
      return;
    }
    addEntryMutation.mutate({
      itemId: item.id,
      note,
      authorId: user?.id ?? null,
      authorName: user?.name ?? user?.username ?? 'nieznany'
    });
  };

  const handleStartEditEntry = (entry: RaportZmianowyEntry) => {
    setEditingEntryId(entry.id);
    setEditingEntryDraft(entry.note);
  };

  const handleSaveEditEntry = (entryId: string) => {
    const note = editingEntryDraft.trim();
    if (!note) {
      toast({ title: 'Podaj treść wpisu.', tone: 'error' });
      return;
    }
    updateEntryMutation.mutate({
      entryId,
      note,
      editedById: user?.id ?? null,
      editedByName: user?.name ?? user?.username ?? 'nieznany'
    });
  };

  const handleCancelEditEntry = () => {
    setEditingEntryId(null);
    setEditingEntryDraft('');
  };

  const handleRemoveEntry = (entryId: string) => {
    if (!adminMode) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Usunąć ten wpis?');
      if (!ok) return;
    }
    removeEntryMutation.mutate(entryId);
  };

  const handleGenerateSummary = () => {
    const payload = {
      from: summaryFrom ? new Date(summaryFrom).toISOString() : undefined,
      to: summaryTo ? new Date(summaryTo).toISOString() : undefined,
      indexCode: summaryIndex.trim() || undefined,
      station: summaryStation.trim() || undefined
    };
    fetchSummaryMutation.mutate(payload);
  };

  const summaryGroups = useMemo<SummaryGroup[]>(() => {
    const groups = new Map<string, RaportZmianowyEntryLog[]>();
    summaryRows.forEach((entry) => {
      if (summaryGroupBy === 'station') {
        const station = normalizeLabel(entry.station, 'Brak maszyny');
        const list = groups.get(station) ?? [];
        list.push(entry);
        groups.set(station, list);
        return;
      }
      const station = normalizeLabel(entry.station, 'Brak maszyny');
      const index = normalizeLabel(entry.indexCode, 'Brak indeksu');
      const key = `${station}||${index}`;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    });

    const planOrderMap = new Map(planOrderKeys.map((key, idx) => [key, idx]));

    const stationCollator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
    return Array.from(groups.entries())
      .map(([key, entries]) => {
        const label =
          summaryGroupBy === 'station'
            ? key
            : key.split('||').filter(Boolean).join(' - ');
        return {
          key,
          label,
          entries: [...entries].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        };
      })
      .sort((a, b) => {
        if (summaryGroupBy === 'station') {
          return stationCollator.compare(a.label, b.label);
        }
        const aIndex = planOrderMap.get(a.key) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = planOrderMap.get(b.key) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.label.localeCompare(b.label, 'pl', { numeric: true });
      });
  }, [planOrderKeys, summaryGroupBy, summaryRows]);

  const handleExportExcel = () => {
    if (summaryRows.length === 0) {
      toast({ title: 'Brak danych do eksportu.', tone: 'error' });
      return;
    }
    const rows = summaryRows.map((entry) => ({
      Grupa:
        summaryGroupBy === 'station'
          ? entry.station ?? ''
          : `${normalizeLabel(entry.station)} - ${normalizeLabel(entry.indexCode)}`,
      Maszyna: entry.station ?? '',
      Indeks: entry.indexCode,
      Opis: entry.description ?? '',
      'Data i godzina': new Date(entry.createdAt).toLocaleString('pl-PL'),
      Autor: entry.authorName,
      Wpis: entry.note
    }));
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Raport');
    XLSX.writeFile(
      workbook,
      `Raport_zmianowy_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const handleExportPdf = async () => {
    if (summaryRows.length === 0) {
      toast({ title: 'Brak danych do eksportu.', tone: 'error' });
      return;
    }
    const summaryHeader = `${summaryFrom || '...'} -> ${summaryTo || '...'}`;
    const normalizeIndex = (value?: string | null) => String(value ?? '').trim();
    const normalizeStation = (value?: string | null) =>
      String(value ?? '').trim() || 'Brak maszyny';
    const makePairKey = (station: string, index: string) => `${station}||${index}`;
    let rows = '';
    if (summaryGroupBy === 'station') {
      const stationCollator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
      const indexCollator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
      const entriesByStation = new Map<string, Map<string, RaportZmianowyEntryLog[]>>();
      summaryRows.forEach((entry) => {
        const station = normalizeStation(entry.station);
        const index = normalizeIndex(entry.indexCode) || 'Brak indeksu';
        if (!entriesByStation.has(station)) {
          entriesByStation.set(station, new Map());
        }
        const stationMap = entriesByStation.get(station)!;
        const list = stationMap.get(index) ?? [];
        list.push(entry);
        stationMap.set(index, list);
      });
      Array.from(entriesByStation.values()).forEach((stationMap) => {
        stationMap.forEach((list) => {
          list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      });
      const stationOrder = Array.from(entriesByStation.keys()).sort((a, b) =>
        stationCollator.compare(a, b)
      );
      rows = stationOrder
        .map((station) => {
          const indices = Array.from(entriesByStation.get(station)?.keys() ?? []).sort((a, b) =>
            indexCollator.compare(a, b)
          );
          const rowspan = indices.length || 1;
          return indices
            .map((index, idx) => {
              const entries = entriesByStation.get(station)?.get(index) ?? [];
              const events = entries.map((entry) => {
                const dateLabel = new Date(entry.createdAt).toLocaleString('pl-PL');
                const author = entry.authorName ?? 'nieznany';
                const note = entry.note ?? '';
                return `${dateLabel} - ${author}: ${note}`;
              });
              const eventsHtml = events.map((event) => escapeHtml(event)).join('<br/>');
              const stationCell =
                idx === 0
                  ? `<td class="station" rowspan="${rowspan}">${escapeHtml(station)}</td>`
                  : '';
              return `
          <tr>
            ${stationCell}
            <td class="index">${escapeHtml(index)}</td>
            <td class="events">${eventsHtml}</td>
          </tr>`;
            })
            .join('');
        })
        .join('');
    } else {
      const sessionIds = Array.from(
        new Set(summaryRows.map((entry) => entry.sessionId).filter(Boolean))
      );
      const sessions: Array<{ dateKey: string; items: RaportZmianowyItem[] }> = [];
      for (const sessionId of sessionIds) {
        if (activeSessionData?.session.id === sessionId && activeSessionData) {
          sessions.push({
            dateKey: activeSessionData.session.dateKey,
            items: activeSessionData.items
          });
          continue;
        }
        try {
          const data = await getRaportZmianowySession(sessionId);
          sessions.push({ dateKey: data.session.dateKey, items: data.items });
        } catch {
          // ignore missing session data; fallback to index sort
        }
      }
      sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey, 'pl', { numeric: true }));

      const orderedPairsFromPlan: Array<{ station: string; index: string }> = [];
      const seenPairs = new Set<string>();
      sessions.forEach((session) => {
        session.items.forEach((item) => {
          const station = normalizeStation(item.station);
          const index = normalizeIndex(item.indexCode) || 'Brak indeksu';
          const key = makePairKey(station, index);
          if (seenPairs.has(key)) return;
          seenPairs.add(key);
          orderedPairsFromPlan.push({ station, index });
        });
      });

      const entriesByPair = new Map<string, RaportZmianowyEntryLog[]>();
      summaryRows.forEach((entry) => {
        const station = normalizeStation(entry.station);
        const index = normalizeIndex(entry.indexCode) || 'Brak indeksu';
        const key = makePairKey(station, index);
        const list = entriesByPair.get(key) ?? [];
        list.push(entry);
        entriesByPair.set(key, list);
      });
      entriesByPair.forEach((list) => {
        list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });

      const orderedPairs: Array<{ station: string; index: string }> = [];
      const remainingPairs = new Set(entriesByPair.keys());
      orderedPairsFromPlan.forEach((pair) => {
        const key = makePairKey(pair.station, pair.index);
        if (!remainingPairs.has(key)) return;
        orderedPairs.push(pair);
        remainingPairs.delete(key);
      });
      Array.from(remainingPairs)
        .sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }))
        .forEach((key) => {
          const [station, index] = key.split('||');
          orderedPairs.push({ station, index });
        });

      const stationOrder: string[] = [];
      const stationMap = new Map<string, Array<{ station: string; index: string }>>();
      orderedPairs.forEach((pair) => {
        if (!stationMap.has(pair.station)) {
          stationMap.set(pair.station, []);
          stationOrder.push(pair.station);
        }
        stationMap.get(pair.station)?.push(pair);
      });

      rows = stationOrder
        .map((station) => {
          const pairs = stationMap.get(station) ?? [];
          const rowspan = pairs.length;
          return pairs
            .map((pair, idx) => {
              const key = makePairKey(pair.station, pair.index);
              const entries = entriesByPair.get(key) ?? [];
              const events = entries.map((entry) => {
                const dateLabel = new Date(entry.createdAt).toLocaleString('pl-PL');
                const author = entry.authorName ?? 'nieznany';
                const note = entry.note ?? '';
                return `${dateLabel} - ${author}: ${note}`;
              });
              const eventsHtml = events.map((event) => escapeHtml(event)).join('<br/>');
              const stationCell =
                idx === 0
                  ? `<td class="station" rowspan="${rowspan}">${escapeHtml(station)}</td>`
                  : '';
              return `
          <tr>
            ${stationCell}
            <td class="index">${escapeHtml(pair.index)}</td>
            <td class="events">${eventsHtml}</td>
          </tr>`;
            })
            .join('');
        })
        .join('');
    }
    const groupSections = `
      <section class="group">
        <table>
          <thead>
            <tr>
              <th>Maszyna</th>
              <th>Indeks</th>
              <th>Zdarzenia</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>`;
    const html = `
      <!doctype html>
      <html lang="pl">
        <head>
          <meta charset="UTF-8" />
          <title>Raport zmianowy</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { margin-bottom: 4px; }
            .meta { color: #444; font-size: 12px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; vertical-align: top; }
            th { background: #f5f5f5; text-align: left; }
            .group { margin-top: 18px; }
            td.events { white-space: normal; }
          </style>
        </head>
        <body>
          <h1>Raport zmianowy</h1>
          <div class="meta">Zakres: ${escapeHtml(summaryHeader)}</div>
          ${groupSections}
        </body>
      </html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Raport zmianowy"
        subtitle="Import planu i rejestrowanie zdarzeń na zmianach produkcyjnych"
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'plan' | 'live' | 'summary')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="flex-col sm:flex-row">
            <TabsTrigger
              value="plan"
              className="w-full justify-center data-[state=active]:bg-[var(--value-purple)] data-[state=active]:text-bg sm:w-auto"
            >
              Wczytywanie planu
            </TabsTrigger>
            <TabsTrigger
              value="live"
              className="w-full justify-center data-[state=active]:bg-[var(--brand)] data-[state=active]:text-bg sm:w-auto"
            >
              Raport na żywo
            </TabsTrigger>
            <TabsTrigger
              value="summary"
              className="w-full justify-center data-[state=active]:bg-[#ff6a00] data-[state=active]:text-bg sm:w-auto"
            >
              Podsumowanie
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="plan" className="space-y-6">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Plik z planem
                </label>
                <Input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
              </div>
              <div className="min-w-[220px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Arkusz
                </label>
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
              <div className="min-w-[180px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Data planu
                </label>
                <Input
                  type="date"
                  value={sessionDate}
                  onChange={(event) => setSessionDate(event.target.value)}
                />
              </div>
              <Button onClick={handleImport} disabled={readOnly || createSessionMutation.isPending}>
                Importuj plan
              </Button>
            </div>
            {fileName && (
              <p className="text-xs text-dim">Wybrany plik: {fileName}</p>
            )}
          </Card>

        </TabsContent>

        <TabsContent value="live" className="space-y-6">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[260px] flex-1">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Aktywny raport
                </label>
                <SelectField
                  value={activeSessionId ?? ''}
                  onChange={(event) => setActiveSessionId(event.target.value || null)}
                >
                  <option value="">Wybierz raport</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {buildSessionLabel(session)}
                    </option>
                  ))}
                </SelectField>
              </div>
              {adminMode && activeSessionId && (
                <Button
                  variant="outline"
                  className="text-danger border-danger/60 hover:border-danger"
                  onClick={() => removeSessionMutation.mutate(activeSessionId)}
                >
                  Usuń raport
                </Button>
              )}
            </div>
            {sessionsLoading && <p className="text-sm text-dim">Wczytywanie raportów...</p>}
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[240px] flex-1">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Szukaj po indeksie, maszynie lub opisie..."
                />
              </div>
              <Badge tone="neutral">
                {filteredItems.length} / {activeSessionData?.items.length ?? 0} indeksów
              </Badge>
            </div>
          </Card>

          {sessionLoading ? (
            <EmptyState
              title="Wczytywanie raportu"
              description="Pobieramy dane aktywnego raportu."
            />
          ) : !activeSessionData ? (
            <EmptyState
              title="Brak aktywnego raportu"
              description="Zaimportuj plan lub wybierz raport, aby rozpocząć wpisy."
            />
          ) : (
            <div className="space-y-4">
              {filteredItems.length === 0 ? (
                <EmptyState
                  title="Brak indeksów"
                  description="Nie znaleziono indeksów spełniających kryteria."
                />
              ) : (
                filteredItems.map((item) => {
                  const entries = entriesByItem.get(item.id) ?? [];
                  const expanded = expandedItems[item.id] ?? false;
                  const visibleEntries = expanded ? entries : entries.slice(-3);
                  const editingItem = editingItems[item.id];
                  const canEditItem = !readOnly;
                  return (
                    <Card key={item.id} className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-title">
                            {item.station ? (
                              <span className="text-violet-400">{item.station}</span>
                            ) : null}
                            {item.station ? ' - ' : null}
                            <span className="text-orange-400">{item.indexCode}</span>
                          </p>
                          {item.description && (
                            <p className="text-sm text-dim">{item.description}</p>
                          )}
                        </div>
                        {canEditItem && !editingItem && (
                          <Button variant="ghost" onClick={() => handleStartEditItem(item)}>
                            Edytuj indeks
                          </Button>
                        )}
                      </div>

                      {editingItem && (
                        <div className="grid gap-3 md:grid-cols-3">
                          <Input
                            value={editingItem.indexCode}
                            onChange={(event) =>
                              setEditingItems((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...editingItem,
                                  indexCode: event.target.value
                                }
                              }))
                            }
                            placeholder="Indeks"
                          />
                          <Input
                            value={editingItem.station}
                            onChange={(event) =>
                              setEditingItems((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...editingItem,
                                  station: event.target.value
                                }
                              }))
                            }
                            placeholder="Maszyna"
                          />
                          <Input
                            value={editingItem.description}
                            onChange={(event) =>
                              setEditingItems((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...editingItem,
                                  description: event.target.value
                                }
                              }))
                            }
                            placeholder="Opis"
                          />
                          <div className="flex gap-2">
                            <Button onClick={() => handleSaveEditItem(item.id)}>Zapisz</Button>
                            <Button variant="ghost" onClick={() => handleCancelEditItem(item.id)}>
                              Anuluj
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                          Dodaj wpis
                        </label>
                        <textarea
                          className={textAreaClass}
                          value={entryDrafts[item.id] ?? ''}
                          onChange={(event) =>
                            setEntryDrafts((prev) => ({
                              ...prev,
                              [item.id]: event.target.value
                            }))
                          }
                          rows={3}
                          placeholder="Opisz co się działo..."
                        />
                        <div className="flex justify-end">
                          <Button onClick={() => handleAddEntry(item)} disabled={readOnly}>
                            Dodaj wpis
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                          Ostatnie wpisy
                        </p>
                        {visibleEntries.length === 0 ? (
                          <p className="text-xs text-dim">Brak wpisów.</p>
                        ) : (
                          <div className="space-y-2">
                            {visibleEntries.map((entry) => {
                              const isEditing = editingEntryId === entry.id;
                              const canEdit = entry.authorId
                                ? entry.authorId === user?.id
                                : entry.authorName === user?.name;
                              return (
                                <div
                                  key={entry.id}
                                  className={cn(
                                    'rounded-xl border border-border/50 bg-[rgba(255,255,255,0.03)] p-3',
                                    isEditing && 'border-[rgba(255,122,26,0.4)]'
                                  )}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs text-dim">
                                      {new Date(entry.createdAt).toLocaleString('pl-PL')} -{' '}
                                      {entry.authorName}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {entry.editedAt && (
                                        <Badge tone="neutral">
                                          Edytowano{' '}
                                          {new Date(entry.editedAt).toLocaleString('pl-PL')}
                                        </Badge>
                                      )}
                                      {canEdit && !isEditing && (
                                        <Button
                                          variant="ghost"
                                          onClick={() => handleStartEditEntry(entry)}
                                        >
                                          Edytuj
                                        </Button>
                                      )}
                                      {adminMode && (
                                        <Button
                                          variant="ghost"
                                          className="text-danger hover:text-danger"
                                          onClick={() => handleRemoveEntry(entry.id)}
                                        >
                                          Usuń
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {isEditing ? (
                                    <div className="mt-2 space-y-2">
                                      <textarea
                                        className={textAreaClass}
                                        value={editingEntryDraft}
                                        onChange={(event) =>
                                          setEditingEntryDraft(event.target.value)
                                        }
                                        rows={3}
                                      />
                                      <div className="flex gap-2">
                                        <Button onClick={() => handleSaveEditEntry(entry.id)}>
                                          Zapisz
                                        </Button>
                                        <Button variant="ghost" onClick={handleCancelEditEntry}>
                                          Anuluj
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="mt-2 whitespace-pre-wrap text-sm text-body">
                                      {entry.note}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {entries.length > 3 && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setExpandedItems((prev) => ({
                                ...prev,
                                [item.id]: !expanded
                              }))
                            }
                          >
                            {expanded ? 'Pokaż mniej' : 'Pokaż więcej'}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          )}

          <Card className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Indeks
                </label>
                <Input
                  value={manualIndex}
                  onChange={(event) => setManualIndex(event.target.value)}
                  placeholder="Indeks"
                />
              </div>
              <div className="min-w-[180px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Wtryskarka / stół
                </label>
                <Input
                  value={manualStation}
                  onChange={(event) => setManualStation(event.target.value)}
                  placeholder="Maszyna"
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Opis
                </label>
                <Input
                  value={manualDescription}
                  onChange={(event) => setManualDescription(event.target.value)}
                  placeholder="Opis indeksu"
                />
              </div>
              <Button onClick={handleAddManual} disabled={readOnly}>
                Dodaj indeks ręcznie
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <Card className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Od
                </label>
                <Input
                  type="datetime-local"
                  value={summaryFrom}
                  onChange={(event) => setSummaryFrom(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Do
                </label>
                <Input
                  type="datetime-local"
                  value={summaryTo}
                  onChange={(event) => setSummaryTo(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Indeks
                </label>
                <Input
                  value={summaryIndex}
                  onChange={(event) => setSummaryIndex(event.target.value)}
                  placeholder="Filtr po indeksie"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Maszyna
                </label>
                <Input
                  value={summaryStation}
                  onChange={(event) => setSummaryStation(event.target.value)}
                  placeholder="Filtr po maszynie"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px]">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                  Grupuj po
                </label>
                <SelectField
                  value={summaryGroupBy}
                  onChange={(event) => setSummaryGroupBy(event.target.value as 'station' | 'plan')}
                >
                  <option value="station">Maszyna</option>
                  <option value="plan">Kolejność planu</option>
                </SelectField>
              </div>
              <Button onClick={handleGenerateSummary} disabled={fetchSummaryMutation.isPending}>
                Generuj podsumowanie
              </Button>
              <Button variant="ghost" onClick={handleExportPdf}>
                PDF
              </Button>
              <Button variant="ghost" onClick={handleExportExcel}>
                Excel
              </Button>
            </div>
          </Card>

          {fetchSummaryMutation.isPending ? (
            <EmptyState title="Wczytywanie danych" description="Trwa pobieranie wpisów." />
          ) : summaryRows.length === 0 ? (
            <EmptyState
              title="Brak danych"
              description="Wybierz zakres i wygeneruj podsumowanie."
            />
          ) : (
            <div className="space-y-4">
              {summaryGroups.map((group) => (
                <Card key={group.key} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-semibold text-title">{group.label}</p>
                    <Badge tone="neutral">{group.entries.length} wpisów</Badge>
                  </div>
                  <div className="space-y-3">
                    {splitEntriesByShift(group.entries).map((shift) => (
                      <div
                        key={shift.key}
                        className="rounded-xl border border-border/50 bg-[rgba(255,255,255,0.03)] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                            {shift.label}
                          </p>
                          <Badge tone="neutral">{shift.entries.length} wpisów</Badge>
                        </div>
                        {shift.entries.length === 0 ? (
                          <p className="mt-2 text-xs text-dim">Brak wpisów.</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {shift.entries.map((entry) => (
                              <div
                                key={entry.id}
                                className="rounded-xl border border-border/50 bg-[rgba(255,255,255,0.03)] p-3"
                              >
                                <p className="text-xs text-dim">
                                  {new Date(entry.createdAt).toLocaleString('pl-PL')} -{' '}
                                  {entry.authorName}
                                </p>
                                <p className="mt-1 text-sm text-title">
                                  {entry.station ? (
                                    <span className="text-violet-400">{entry.station}</span>
                                  ) : null}
                                  {entry.station ? ' - ' : null}
                                  <span className="text-orange-400">{entry.indexCode}</span>
                                </p>
                                {entry.description && (
                                  <p className="text-xs text-dim">{entry.description}</p>
                                )}
                                <p className="mt-2 whitespace-pre-wrap text-sm">{entry.note}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}


