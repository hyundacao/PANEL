import webpush, {
  type WebPushError,
  type WebPushSubscription
} from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSeeTab } from '@/lib/auth/access';
import { mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import type { AppUser, WarehouseTab } from '@/lib/api/types';

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
  erp_warehouseman_source_warehouses?: string[] | null;
  erp_dispatcher_target_locations?: string[] | null;
};

type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type PushSubscriptionPreferencesInput = {
  warehousemanSourceWarehouses?: string[] | null;
  dispatcherTargetLocations?: string[] | null;
};

type SendWarehouseTransferPushContext = {
  sourceWarehouse?: string;
  targetWarehouse?: string;
  note?: string | null;
};

type WarehouseDocumentPushPayload = {
  documentId: string;
  documentNumber: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
  note?: string | null;
  actorUserId?: string | null;
};

let vapidConfigured = false;

const getPushConfig = () => {
  const publicKey =
    process.env.WEB_PUSH_PUBLIC_KEY ??
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ??
    '';
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY ?? '';
  const subject = process.env.WEB_PUSH_SUBJECT ?? 'mailto:no-reply@example.com';
  return {
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
    subject: subject.trim()
  };
};

const initVapid = () => {
  if (vapidConfigured) return true;
  const { publicKey, privateKey, subject } = getPushConfig();
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
};

const toCleanString = (value: unknown) => String(value ?? '').trim();

const toWebPushSubscription = (
  row: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>
): WebPushSubscription => ({
  endpoint: row.endpoint,
  keys: {
    p256dh: row.p256dh,
    auth: row.auth
  }
});

const removePushSubscriptionById = async (subscriptionId: string) => {
  if (!subscriptionId) return;
  await supabaseAdmin.from('push_subscriptions').delete().eq('id', subscriptionId);
};

const toPushText = (value?: string) => {
  const normalized = toCleanString(value);
  return normalized || '-';
};

const getEndpointHost = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
};

const isAndroidUserAgent = (userAgent?: string | null) =>
  /android/i.test(String(userAgent ?? ''));

type SupabaseLikeError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const isMissingPushPreferenceColumnsError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as SupabaseLikeError;
  const code = String(candidate.code ?? '');
  const text = [
    String(candidate.message ?? ''),
    String(candidate.details ?? ''),
    String(candidate.hint ?? '')
  ]
    .join(' ')
    .toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  return (
    text.includes('erp_warehouseman_source_warehouses') ||
    text.includes('erp_dispatcher_target_locations')
  );
};

const WAREHOUSEMAN_SOURCE_WAREHOUSE_OPTIONS = new Set([
  '1',
  '4',
  '10',
  '11',
  '13',
  '40',
  '41',
  '51',
  'LAKIERNIA',
  'INNA LOKALIZACJA'
]);

type WarehouseTransferFlowKind = 'WYDANIE' | 'ZWROT';

const toDistinctUserIds = (rows: PushSubscriptionRow[]) => [
  ...new Set(rows.map((row) => toCleanString(row.user_id)).filter(Boolean))
];

const loadActiveUsersById = async (userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, AppUser>();

  const { data, error } = await supabaseAdmin
    .from('app_users')
    .select('id, name, username, role, access, is_active, created_at, last_login')
    .in('id', userIds)
    .eq('is_active', true);

  if (error) {
    console.error('[push] Failed to load users for tab filtering', error);
    return new Map<string, AppUser>();
  }

  return new Map(((data ?? []) as DbUserRow[]).map(mapDbUser).map((user) => [user.id, user]));
};

const filterSubscriptionsByErpTabs = (
  subscriptions: PushSubscriptionRow[],
  usersById: Map<string, AppUser>,
  requiredTabs: WarehouseTab[]
) => {
  if (subscriptions.length === 0 || requiredTabs.length === 0) return subscriptions;
  return subscriptions.filter((row) => {
    const user = usersById.get(row.user_id);
    if (!user) return false;
    return requiredTabs.some((tab) => canSeeTab(user, 'PRZESUNIECIA_ERP', tab));
  });
};

const normalizeWarehouseTransferFlowKind = (value: unknown): WarehouseTransferFlowKind => {
  const normalized = toCleanString(value).toUpperCase();
  if (normalized === 'ZWROT') return 'ZWROT';
  return 'WYDANIE';
};

const parseWarehouseTransferFlowKindFromNote = (
  note: string | null | undefined
): WarehouseTransferFlowKind => {
  const normalizedNote = toCleanString(note);
  if (!normalizedNote) return 'WYDANIE';
  const markerMatch = normalizedNote.match(/\bFLOW_KIND\s*:\s*(WYDANIE|ZWROT)\b/i);
  if (markerMatch?.[1]) return normalizeWarehouseTransferFlowKind(markerMatch[1]);
  return 'WYDANIE';
};

const extractWarehousemanSourceWarehouseKey = (value: string | null | undefined) => {
  const normalized = toCleanString(value);
  if (!normalized) return null;
  if (/lakiernia/i.test(normalized)) return 'LAKIERNIA';
  if (/inna\s+lokalizacja/i.test(normalized)) return 'INNA LOKALIZACJA';
  const match = normalized.match(/\d+/);
  return match ? match[0] : null;
};

const normalizeWarehousemanSourceWarehouseFilterToken = (value: unknown) => {
  const normalized = toCleanString(value).toUpperCase();
  if (!normalized) return null;
  if (/^MAGAZYN\s+/.test(normalized)) {
    const stripped = normalized.replace(/^MAGAZYN\s+/, '').trim();
    if (stripped) return stripped;
  }
  if (normalized === 'INNA') return 'INNA LOKALIZACJA';
  if (normalized === 'LAK') return 'LAKIERNIA';
  return normalized;
};

const normalizeTargetLocationFilterToken = (value: unknown) =>
  toCleanString(value)
    .toLowerCase()
    .replace(/\s+/g, ' ');

const getDocumentSourceWarehouseKeyForWarehouseman = (
  payload?: SendWarehouseTransferPushContext
) => {
  if (!payload) return null;
  const flowKind = parseWarehouseTransferFlowKindFromNote(payload.note);
  if (flowKind === 'ZWROT') {
    return extractWarehousemanSourceWarehouseKey(payload.targetWarehouse ?? payload.sourceWarehouse);
  }
  return extractWarehousemanSourceWarehouseKey(payload.sourceWarehouse);
};

const shouldSendToWarehousemanSubscription = (
  row: PushSubscriptionRow,
  payload?: SendWarehouseTransferPushContext
) => {
  const selectedWarehouses = row.erp_warehouseman_source_warehouses;
  if (!Array.isArray(selectedWarehouses)) return true;
  const documentWarehouseKey = getDocumentSourceWarehouseKeyForWarehouseman(payload);
  if (!documentWarehouseKey) return false;
  const selectedSet = new Set(
    selectedWarehouses
      .map(normalizeWarehousemanSourceWarehouseFilterToken)
      .filter((item): item is string => Boolean(item))
      .filter((item) => WAREHOUSEMAN_SOURCE_WAREHOUSE_OPTIONS.has(item))
  );
  if (selectedSet.size === 0) return false;
  return selectedSet.has(documentWarehouseKey);
};

const shouldSendToDispatcherSubscription = (
  row: PushSubscriptionRow,
  payload?: SendWarehouseTransferPushContext
) => {
  const selectedLocations = row.erp_dispatcher_target_locations;
  if (!Array.isArray(selectedLocations)) return true;
  const flowKind = parseWarehouseTransferFlowKindFromNote(payload?.note);
  if (flowKind === 'ZWROT') return true;
  const targetLocationToken = normalizeTargetLocationFilterToken(payload?.targetWarehouse);
  if (!targetLocationToken) return false;
  const selectedSet = new Set(
    selectedLocations
      .map(normalizeTargetLocationFilterToken)
      .filter((item) => item.length > 0)
  );
  if (selectedSet.size === 0) return false;
  return selectedSet.has(targetLocationToken);
};

const filterSubscriptionsByDocumentPreferences = (
  subscriptions: PushSubscriptionRow[],
  usersById: Map<string, AppUser>,
  requiredTabs: WarehouseTab[],
  payload?: SendWarehouseTransferPushContext
) => {
  if (subscriptions.length === 0) return subscriptions;
  if (!payload) return subscriptions;

  const includesWarehouseman = requiredTabs.includes('erp-magazynier');
  const includesDispatcher = requiredTabs.includes('erp-rozdzielca');

  return subscriptions.filter((row) => {
    const user = usersById.get(row.user_id);
    if (!user) return false;

    const canReceiveAsWarehouseman =
      includesWarehouseman &&
      canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-magazynier') &&
      shouldSendToWarehousemanSubscription(row, payload);

    const canReceiveAsDispatcher =
      includesDispatcher &&
      canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-rozdzielca') &&
      shouldSendToDispatcherSubscription(row, payload);

    return canReceiveAsWarehouseman || canReceiveAsDispatcher;
  });
};

type SendWarehouseTransferPushInput = {
  title: string;
  body: string;
  url: string;
  tag: string;
  requiredTabs: WarehouseTab[];
  context?: SendWarehouseTransferPushContext;
};

const sendWarehouseTransferPush = async ({
  title,
  body,
  url,
  tag,
  requiredTabs,
  context
}: SendWarehouseTransferPushInput) => {
  if (!initVapid()) {
    console.warn('[push] VAPID not configured');
    return;
  }

  let data: unknown[] | null = null;
  let error: unknown = null;

  const withPreferences = await supabaseAdmin
    .from('push_subscriptions')
    .select(
      'id, user_id, endpoint, p256dh, auth, user_agent, erp_warehouseman_source_warehouses, erp_dispatcher_target_locations'
    );
  data = (withPreferences.data ?? null) as unknown[] | null;
  error = withPreferences.error;

  if (error && isMissingPushPreferenceColumnsError(error)) {
    const fallback = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth, user_agent');
    data = (fallback.data ?? null) as unknown[] | null;
    error = fallback.error;
  }

  if (error) {
    console.error('[push] Failed to load subscriptions', error);
    return;
  }

  const allSubscriptions = (data ?? []) as PushSubscriptionRow[];
  if (allSubscriptions.length === 0) {
    console.warn('[push] No subscriptions found');
    return;
  }

  const usersById = await loadActiveUsersById(toDistinctUserIds(allSubscriptions));
  const tabFilteredSubscriptions = filterSubscriptionsByErpTabs(
    allSubscriptions,
    usersById,
    requiredTabs
  );
  if (tabFilteredSubscriptions.length === 0) {
    console.warn('[push] No subscriptions after ERP tab filtering', {
      requiredTabs,
      totalSubscriptions: allSubscriptions.length
    });
    return;
  }

  const subscriptions = filterSubscriptionsByDocumentPreferences(
    tabFilteredSubscriptions,
    usersById,
    requiredTabs,
    context
  );
  if (subscriptions.length === 0) {
    console.warn('[push] No subscriptions after ERP preference filtering', {
      requiredTabs,
      totalSubscriptions: allSubscriptions.length,
      tabFilteredSubscriptions: tabFilteredSubscriptions.length,
      tag
    });
    return;
  }

  const androidSubscriptions = subscriptions.filter((row) =>
    isAndroidUserAgent(row.user_agent)
  ).length;
  const desktopSubscriptions = subscriptions.filter((row) => {
    const userAgent = String(row.user_agent ?? '');
    const isAndroid = isAndroidUserAgent(userAgent);
    return !isAndroid && /windows nt|macintosh|x11|linux/i.test(userAgent);
  }).length;
  console.warn('[push] Sending ERP push', {
    requiredTabs,
    totalSubscriptions: allSubscriptions.length,
    tabFilteredSubscriptions: tabFilteredSubscriptions.length,
    filteredSubscriptions: subscriptions.length,
    androidSubscriptions,
    desktopSubscriptions,
    tag
  });

  const message = JSON.stringify({
    title,
    body,
    url,
    tag
  });

  const sendResults = await Promise.allSettled(
    subscriptions.map(async (row) => {
      const endpointHost = getEndpointHost(row.endpoint);
      const platform = isAndroidUserAgent(row.user_agent) ? 'android' : 'desktop';
      try {
        await webpush.sendNotification(toWebPushSubscription(row), message, {
          TTL: 60 * 60,
          urgency: 'high'
        });
        console.warn('[push] Send accepted', {
          endpointHost,
          platform,
          tag
        });
        return { accepted: 1, removed: 0, failed: 0 };
      } catch (error) {
        const pushError = error as WebPushError;
        const statusCode = Number(pushError?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) {
          await removePushSubscriptionById(row.id);
          console.warn('[push] Removed stale subscription', {
            endpointHost,
            platform,
            statusCode,
            tag
          });
          return { accepted: 0, removed: 1, failed: 0 };
        }
        console.error('[push] Send failed', {
          endpoint: row.endpoint,
          statusCode,
          message: pushError?.message ?? 'UNKNOWN'
        });
        return { accepted: 0, removed: 0, failed: 1 };
      }
    })
  );

  let acceptedCount = 0;
  let removedCount = 0;
  let failedCount = 0;
  sendResults.forEach((result) => {
    if (result.status !== 'fulfilled') {
      failedCount += 1;
      return;
    }
    acceptedCount += result.value.accepted;
    removedCount += result.value.removed;
    failedCount += result.value.failed;
  });
  console.warn('[push] Send summary', {
    tag,
    attempted: subscriptions.length,
    acceptedCount,
    removedCount,
    failedCount
  });
};

export const isWebPushConfigured = () => {
  const { publicKey, privateKey, subject } = getPushConfig();
  return Boolean(publicKey && privateKey && subject);
};

export const getWebPushPublicKey = () => {
  const { publicKey } = getPushConfig();
  return publicKey || null;
};

export const normalizePushSubscription = (value: unknown): PushSubscriptionInput | null => {
  if (!value || typeof value !== 'object') return null;
  const rawEndpoint = (value as { endpoint?: unknown }).endpoint;
  const rawKeys = (value as { keys?: unknown }).keys;
  if (!rawKeys || typeof rawKeys !== 'object') return null;
  const endpoint = toCleanString(rawEndpoint);
  const p256dh = toCleanString((rawKeys as { p256dh?: unknown }).p256dh);
  const auth = toCleanString((rawKeys as { auth?: unknown }).auth);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth }
  };
};

const normalizeStringArrayPreference = (
  value: unknown,
  normalizer: (item: unknown) => string,
  allowedValues?: Set<string>
): string[] | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item) => normalizer(item))
    .filter((item) => item.length > 0)
    .filter((item) => (allowedValues ? allowedValues.has(item) : true));
  return [...new Set(normalized)];
};

export const normalizePushSubscriptionPreferences = (
  value: unknown
): PushSubscriptionPreferencesInput => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as {
    warehousemanSourceWarehouses?: unknown;
    dispatcherTargetLocations?: unknown;
  };

  const warehousemanSourceWarehouses = normalizeStringArrayPreference(
    raw.warehousemanSourceWarehouses,
    (item) => normalizeWarehousemanSourceWarehouseFilterToken(item) ?? '',
    WAREHOUSEMAN_SOURCE_WAREHOUSE_OPTIONS
  );

  const dispatcherTargetLocations = normalizeStringArrayPreference(
    raw.dispatcherTargetLocations,
    normalizeTargetLocationFilterToken
  );

  return {
    ...(warehousemanSourceWarehouses !== undefined
      ? { warehousemanSourceWarehouses }
      : {}),
    ...(dispatcherTargetLocations !== undefined ? { dispatcherTargetLocations } : {})
  };
};

export const hasPushSubscriptionForUser = async (userId: string) => {
  if (!userId) return false;
  const { count, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return Number(count ?? 0) > 0;
};

export const upsertPushSubscriptionForUser = async (
  userId: string,
  subscription: PushSubscriptionInput,
  userAgent?: string | null,
  preferences?: PushSubscriptionPreferencesInput
) => {
  const nowIso = new Date().toISOString();
  const payload = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent ? toCleanString(userAgent) || null : null,
    updated_at: nowIso,
    last_seen_at: nowIso,
    ...(Object.prototype.hasOwnProperty.call(preferences ?? {}, 'warehousemanSourceWarehouses')
      ? {
          erp_warehouseman_source_warehouses:
            preferences?.warehousemanSourceWarehouses ?? null
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(preferences ?? {}, 'dispatcherTargetLocations')
      ? {
          erp_dispatcher_target_locations: preferences?.dispatcherTargetLocations ?? null
        }
      : {})
  };

  let { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error && isMissingPushPreferenceColumnsError(error)) {
    const fallbackPayload = {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent ? toCleanString(userAgent) || null : null,
      updated_at: nowIso,
      last_seen_at: nowIso
    };
    const fallback = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(fallbackPayload, { onConflict: 'endpoint' });
    error = fallback.error;
  }

  if (error) throw error;
  console.warn('[push] Subscription upserted', {
    userId,
    endpointHost: getEndpointHost(subscription.endpoint),
    platform: isAndroidUserAgent(userAgent) ? 'android' : 'desktop'
  });
};

export const removePushSubscriptionForUser = async (userId: string, endpoint?: string) => {
  if (!userId) return;
  const normalizedEndpoint = toCleanString(endpoint);
  if (!normalizedEndpoint) return;

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('endpoint', normalizedEndpoint);
  if (error) throw error;
  console.warn('[push] Subscription removed', {
    userId,
    endpointHost: getEndpointHost(normalizedEndpoint)
  });
};

export const sendWarehouseTransferDocumentCreatedPush = async (
  payload: WarehouseDocumentPushPayload
) => {
  const title = 'Nowy dokument ERP';
  const warehousePart = payload.sourceWarehouse
    ? `Magazyn: ${toPushText(payload.sourceWarehouse)}`
    : payload.targetWarehouse
      ? `Magazyn docelowy: ${toPushText(payload.targetWarehouse)}`
      : '';
  const documentLabel = toPushText(payload.documentNumber);
  const body = warehousePart
    ? `Został utworzony nowy dokument: ${documentLabel} | ${warehousePart}`
    : `Został utworzony nowy dokument: ${documentLabel}`;
  await sendWarehouseTransferPush({
    title,
    body,
    url: '/przesuniecia-magazynowe',
    tag: `erp-document-created-${payload.documentId}`,
    requiredTabs: ['erp-magazynier', 'erp-rozdzielca'],
    context: {
      sourceWarehouse: payload.sourceWarehouse,
      targetWarehouse: payload.targetWarehouse,
      note: payload.note
    }
  });
};

export const sendWarehouseTransferDocumentIssuedPush = async (
  payload: WarehouseDocumentPushPayload
) => {
  const documentLabel = toPushText(payload.documentNumber);
  const targetPart = payload.targetWarehouse
    ? `Lokalizacja docelowa: ${toPushText(payload.targetWarehouse)}`
    : payload.sourceWarehouse
      ? `Magazyn źródłowy: ${toPushText(payload.sourceWarehouse)}`
      : '';
  const title = 'Dokument ERP wydany';
  const body = targetPart
    ? `Dokument ${documentLabel} jest gotowy do przyjęcia | ${targetPart}`
    : `Dokument ${documentLabel} jest gotowy do przyjęcia`;

  await sendWarehouseTransferPush({
    title,
    body,
    url: '/przesuniecia-magazynowe',
    tag: `erp-document-issued-${payload.documentId}`,
    requiredTabs: ['erp-magazynier', 'erp-rozdzielca'],
    context: {
      sourceWarehouse: payload.sourceWarehouse,
      targetWarehouse: payload.targetWarehouse,
      note: payload.note
    }
  });
};
