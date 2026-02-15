import {
  getErpPushStatus,
  subscribeErpPush,
  unsubscribeErpPush,
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

const getServiceWorkerRegistration = async () => {
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
  if (existing) return existing;
  await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE });
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
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return pushStatusDisabled(status);
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
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(status.publicKey)
    });
  }

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
