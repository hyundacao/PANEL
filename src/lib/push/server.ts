import webpush, {
  type WebPushError,
  type WebPushSubscription
} from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canSeeTab } from '@/lib/auth/access';
import { mapDbUser, type DbUserRow } from '@/lib/supabase/users';
import type { WarehouseTab } from '@/lib/api/types';

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type WarehouseDocumentPushPayload = {
  documentId: string;
  documentNumber: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
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

const toDistinctUserIds = (rows: PushSubscriptionRow[]) => [
  ...new Set(rows.map((row) => toCleanString(row.user_id)).filter(Boolean))
];

const filterSubscriptionsByErpTabs = async (
  subscriptions: PushSubscriptionRow[],
  requiredTabs: WarehouseTab[]
) => {
  if (subscriptions.length === 0 || requiredTabs.length === 0) return subscriptions;

  const userIds = toDistinctUserIds(subscriptions);
  if (userIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('app_users')
    .select('id, name, username, role, access, is_active, created_at, last_login')
    .in('id', userIds)
    .eq('is_active', true);

  if (error) {
    console.error('[push] Failed to load users for tab filtering', error);
    return [];
  }

  const allowedUserIds = new Set(
    ((data ?? []) as DbUserRow[]).map(mapDbUser).flatMap((user) =>
      requiredTabs.some((tab) => canSeeTab(user, 'PRZESUNIECIA_ERP', tab)) ? [user.id] : []
    )
  );

  return subscriptions.filter((row) => allowedUserIds.has(row.user_id));
};

type SendWarehouseTransferPushInput = {
  title: string;
  body: string;
  url: string;
  tag: string;
  requiredTabs: WarehouseTab[];
};

const sendWarehouseTransferPush = async ({
  title,
  body,
  url,
  tag,
  requiredTabs
}: SendWarehouseTransferPushInput) => {
  if (!initVapid()) {
    console.warn('[push] VAPID not configured');
    return;
  }

  const query = supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth');

  const { data, error } = await query;
  if (error) {
    console.error('[push] Failed to load subscriptions', error);
    return;
  }

  const allSubscriptions = (data ?? []) as PushSubscriptionRow[];
  if (allSubscriptions.length === 0) {
    console.warn('[push] No subscriptions found');
    return;
  }

  const subscriptions = await filterSubscriptionsByErpTabs(allSubscriptions, requiredTabs);
  if (subscriptions.length === 0) {
    console.warn('[push] No subscriptions after ERP tab filtering', {
      requiredTabs,
      totalSubscriptions: allSubscriptions.length
    });
    return;
  }
  console.warn('[push] Sending ERP push', {
    requiredTabs,
    totalSubscriptions: allSubscriptions.length,
    filteredSubscriptions: subscriptions.length,
    tag
  });

  const message = JSON.stringify({
    title,
    body,
    url,
    tag
  });

  await Promise.allSettled(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(toWebPushSubscription(row), message, {
          TTL: 60 * 60,
          urgency: 'high'
        });
      } catch (error) {
        const pushError = error as WebPushError;
        const statusCode = Number(pushError?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) {
          await removePushSubscriptionById(row.id);
          return;
        }
        console.error('[push] Send failed', {
          endpoint: row.endpoint,
          statusCode,
          message: pushError?.message ?? 'UNKNOWN'
        });
      }
    })
  );
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
  userAgent?: string | null
) => {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent ? toCleanString(userAgent) || null : null,
      updated_at: nowIso,
      last_seen_at: nowIso
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
};

export const removePushSubscriptionForUser = async (userId: string, endpoint?: string) => {
  if (!userId) return;
  const normalizedEndpoint = toCleanString(endpoint);
  if (!normalizedEndpoint) return;

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', normalizedEndpoint);
  if (error) throw error;
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
    requiredTabs: ['erp-magazynier', 'erp-rozdzielca']
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
    requiredTabs: ['erp-magazynier', 'erp-rozdzielca']
  });
};
