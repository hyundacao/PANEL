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
  orderNo?: number;
};

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalized = (value: unknown) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .toLowerCase();

const fixedDeviceCollator = new Intl.Collator('pl', {
  numeric: true,
  sensitivity: 'base'
});

const fixedInventoryDeviceGroupOrder = (device: FixedInventoryDevice) => {
  const name = normalized(device.name);
  if (name.includes('grawimetr')) return 3;
  if (device.type === 'dryer' || name.includes('suszark')) return 2;
  if (name.includes('bufor')) return 1;
  return 0;
};

export const compareFixedInventoryDevices = (
  left: FixedInventoryDevice,
  right: FixedInventoryDevice
) => {
  const leftOrder = typeof left.orderNo === 'number' && Number.isFinite(left.orderNo)
    ? left.orderNo
    : null;
  const rightOrder = typeof right.orderNo === 'number' && Number.isFinite(right.orderNo)
    ? right.orderNo
    : null;

  if (leftOrder !== null || rightOrder !== null) {
    if (leftOrder === null) return 1;
    if (rightOrder === null) return -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }

  const groupOrder = fixedInventoryDeviceGroupOrder(left) - fixedInventoryDeviceGroupOrder(right);
  if (groupOrder) return groupOrder;
  return fixedDeviceCollator.compare(left.name, right.name);
};

export const sortFixedInventoryDevices = (devices: FixedInventoryDevice[]) =>
  [...devices].sort(compareFixedInventoryDevices);

export const normalizeFixedInventoryDevices = (value: unknown): FixedInventoryDevice[] => {
  if (!Array.isArray(value)) return [];
  const devices = new Map<string, FixedInventoryDevice>();
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<FixedInventoryDevice>;
    const id = text(candidate.id) || `fixed-device-legacy-${index + 1}`;
    const fullQty = Number(candidate.fullQty ?? 0);
    const orderNo = typeof candidate.orderNo === 'number' && Number.isFinite(candidate.orderNo)
      ? candidate.orderNo
      : undefined;
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
      active: Boolean(candidate.active),
      orderNo
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
