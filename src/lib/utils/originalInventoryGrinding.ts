export const isPieceGrindingUnit = (unit: string | null | undefined) =>
  /^(szt\.?|sztuk[ai]?|pcs?\.?|pieces?)$/i.test(String(unit ?? '').trim());

export const isKilogramGrindingUnit = (unit: string | null | undefined) =>
  /^kg\.?$/i.test(String(unit ?? '').trim());

/** Combines repeated visible lines while retaining every saved task for actions. */
export const groupGrindingTasksByMaterial = <T extends { materialName: string; unit: string; qty: number }>(
  tasks: readonly T[],
  normalizeName: (name: string) => string
): Array<{ key: string; qty: number; tasks: T[] }> => {
  const groups = new Map<string, { key: string; qty: number; tasks: T[] }>();
  for (const task of tasks) {
    const unitKey = isPieceGrindingUnit(task.unit) ? 'szt.' : task.unit.trim().toLowerCase();
    const key = `${normalizeName(task.materialName)}|${unitKey}`;
    const group = groups.get(key);
    if (group) {
      group.qty += task.qty;
      group.tasks.push(task);
    } else {
      groups.set(key, { key, qty: task.qty, tasks: [task] });
    }
  }
  return [...groups.values()];
};

type GrindingTask = {
  materialName: string;
  unit: string;
  qty: number;
  status: 'PENDING' | 'DONE';
  sourceReportDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export const grindingMaterialKey = (name: string, unit: string, normalizeName: (name: string) => string) =>
  `${normalizeName(name)}|${isPieceGrindingUnit(unit) ? 'szt' : isKilogramGrindingUnit(unit) ? 'kg' : unit.trim().toLowerCase()}`;

/** Report highlights follow unfinished work, independently of subsequent ERP imports. */
export const getPendingGrindingQuantities = (
  tasks: readonly GrindingTask[],
  reportDate: string,
  normalizeName: (name: string) => string
): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== 'PENDING' || !Number.isFinite(task.qty) || task.qty <= 0) continue;
    if (task.sourceReportDate && task.sourceReportDate > reportDate) continue;
    if (!normalizeName(task.materialName) || (!isPieceGrindingUnit(task.unit) && !isKilogramGrindingUnit(task.unit))) continue;
    const key = grindingMaterialKey(task.materialName, task.unit, normalizeName);
    quantities.set(key, (quantities.get(key) ?? 0) + task.qty);
  }
  return quantities;
};

type SnapshotEntry = {
  name: string;
  unit: string;
  availableQty: number;
  importedAt: string;
};

/** Only changes the app's view of ERP availability; the imported snapshot stays intact. */
export const applyPieceGrindingReservations = <T extends SnapshotEntry>(
  entries: readonly T[],
  tasks: readonly GrindingTask[],
  snapshotDate: string,
  normalizeName: (name: string) => string
): Array<T & { reservedGrindingQty: number }> => {
  const importedAtByName = new Map<string, string>();
  for (const entry of entries) {
    if (!isPieceGrindingUnit(entry.unit)) continue;
    const key = normalizeName(entry.name);
    const lastImport = importedAtByName.get(key);
    if (!lastImport || entry.importedAt > lastImport) importedAtByName.set(key, entry.importedAt);
  }

  const reservedByName = new Map<string, number>();
  for (const task of tasks) {
    if (!isPieceGrindingUnit(task.unit) || !Number.isFinite(task.qty) || task.qty <= 0) continue;
    if (task.sourceReportDate && task.sourceReportDate > snapshotDate) continue;
    const key = normalizeName(task.materialName);
    const importedAt = importedAtByName.get(key);
    if (!importedAt) continue;
    // Once grinding is done, keep the stock unavailable until a newer ERP import
    // can reflect the physical withdrawal. Pending tasks remain reserved across days.
    if (task.status === 'DONE' && (!task.completedAt || task.completedAt <= importedAt)) continue;
    reservedByName.set(key, (reservedByName.get(key) ?? 0) + task.qty);
  }

  const appliedNames = new Set<string>();
  return entries.map((entry) => {
    const key = normalizeName(entry.name);
    const reservedGrindingQty = isPieceGrindingUnit(entry.unit) && !appliedNames.has(key)
      ? (reservedByName.get(key) ?? 0)
      : 0;
    if (reservedGrindingQty > 0) appliedNames.add(key);
    return {
      ...entry,
      availableQty: entry.availableQty - reservedGrindingQty,
      reservedGrindingQty
    };
  });
};
