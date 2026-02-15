import {
  getErpPushStatus,
  subscribeErpPush,
  unsubscribeErpPush,
  type ErpPushPreferences,
  type ErpPushStatus
} from '@/lib/api';

const SERVICE_WORKER_SCOPE = '/';
const SERVICE_WORKER_PATH = '/sw-push.js';

const localhostHosts = new Set(['localhost', '127.0.0.1']);

const canUsePushApi = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

const ensurePushApi = () => {
  if (!canUsePushApi()) {
    throw new Error('NOT_SUPPORTED');
  }
  if (
    !window.isSecureContext &&
    !localhostHosts.has(window.location.hostname.toLowerCase())
  ) {
    throw new Error('INSECURE_CONTEXT');
  }
};

const toUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64Safe);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
};

const toUint8ArrayOrNull = (value: ArrayBuffer | null) => {
  if (!value) return null;
  return new Uint8Array(value);
};

const areUint8ArraysEqual = (left: Uint8Array | null, right: Uint8Array | null) => {
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const getServiceWorkerRegistration = async () => {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: 'none'
  });
  await registration.update();
  return navigator.serviceWorker.ready;
};

const pushStatusDisabled = (status: ErpPushStatus): ErpPushStatus => ({
  ...status,
  enabled: false
});

export const syncErpPushStatus = async (): Promise<ErpPushStatus> => {
  const status = await getErpPushStatus();
  if (!status.configured || !status.publicKey) {
    return pushStatusDisabled(status);
  }

  if (!canUsePushApi()) {
    return pushStatusDisabled(status);
  }

  if (Notification.permission !== 'granted') {
    return pushStatusDisabled(status);
  }

  const registration = await getServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return pushStatusDisabled(status);
  }

  const expectedServerKey = toUint8Array(status.publicKey);
  const currentServerKey = toUint8ArrayOrNull(subscription.options.applicationServerKey);
  if (!areUint8ArraysEqual(currentServerKey, expectedServerKey)) {
    const previousEndpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => undefined);
    await unsubscribeErpPush(previousEndpoint).catch(() => undefined);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedServerKey
    });
  }

  await subscribeErpPush(subscription.toJSON());
  return {
    ...status,
    enabled: true
  };
};

export const enableErpPushNotifications = async (): Promise<ErpPushStatus> => {
  ensurePushApi();

  const status = await getErpPushStatus();
  if (!status.configured || !status.publicKey) {
    throw new Error('NOT_CONFIGURED');
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_NOT_GRANTED');
  }

  const registration = await getServiceWorkerRegistration();
  const applicationServerKey = toUint8Array(status.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => undefined);
    await unsubscribeErpPush(endpoint).catch(() => undefined);
  }
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });

  await subscribeErpPush(subscription.toJSON());
  return {
    ...status,
    enabled: true
  };
};

export const disableErpPushNotifications = async () => {
  let endpoint: string | undefined;
  if (canUsePushApi()) {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
    const subscription = await registration?.pushManager.getSubscription();
    endpoint = subscription?.endpoint;
    if (subscription) {
      await subscription.unsubscribe();
    }
  }
  if (endpoint) {
    await unsubscribeErpPush(endpoint);
  }
};

export const syncErpPushPreferences = async (
  preferences: ErpPushPreferences
) => {
  if (!canUsePushApi()) return;
  if (Notification.permission !== 'granted') return;

  const registration = await getServiceWorkerRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await subscribeErpPush(subscription.toJSON(), preferences);
};
