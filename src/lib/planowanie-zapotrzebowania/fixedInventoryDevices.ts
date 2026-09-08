export const FIXED_INVENTORY_DEVICE_SOURCE_TYPE = 'FIXED_DEVICE';

export type FixedInventoryDeviceType = 'cs' | 'dryer';

export type FixedInventoryDevice = {
  id: string;
  type: FixedInventoryDeviceType;
  name: string;
  areaId: string;
  location: string;
  materialCode: string;
  materialName: string;
  fullQty: number;
  unit: string;
  active: boolean;
};

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalized = (value: unknown) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .toLowerCase();

export const normalizeFixedInventoryDevices = (value: unknown): FixedInventoryDevice[] => {
  if (!Array.isArray(value)) return [];
  const devices = new Map<string, FixedInventoryDevice>();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<FixedInventoryDevice>;
    const id = text(candidate.id) || `fixed-device-legacy-${index + 1}`;
    const fullQty = Number(candidate.fullQty ?? 0);
    devices.set(id, {
      id,
      type: candidate.type === 'dryer' ? 'dryer' : 'cs',
      name: text(candidate.name),
      areaId: text(candidate.areaId),
      location: text(candidate.location),
      materialCode: text(candidate.materialCode),
      materialName: text(candidate.materialName),
      fullQty: Number.isFinite(fullQty) ? Math.max(0, fullQty) : 0,
      unit: text(candidate.unit) || 'kg',
      active: Boolean(candidate.active)
    });
  });
  return [...devices.values()];
};

export const isFixedInventoryDeviceReady = (device: FixedInventoryDevice) =>
  Boolean(device.id && device.name && device.areaId && device.materialName && device.fullQty > 0);

export const fixedInventoryDeviceTypeLabel = (type: FixedInventoryDeviceType) =>
  type === 'dryer' ? 'Suszarka' : 'Bufor CS';

export const fixedInventoryDeviceSourceId = (deviceId: string, dateKey: string) =>
  `fixed-device:${deviceId}:${dateKey}`;

export const planningAreaIdForWarehouse = (warehouseId: unknown, warehouseName: unknown) => {
  const id = normalized(warehouseId).replace(/[ _]+/g, '-');
  const name = normalized(warehouseName).replace(/[-_]+/g, ' ');
  if (id === 'hall-1' || id === 'hala-1' || /^hala\s*1(?:\b|$)/.test(name)) return 'hala-1';
  if (id === 'hall-2' || id === 'hala-2' || /^hala\s*2(?:\b|$)/.test(name)) return 'hala-2';
  return '';
};
