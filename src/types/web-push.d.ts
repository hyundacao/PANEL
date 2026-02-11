declare module 'web-push' {
  export type WebPushSubscription = {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  export type WebPushSendOptions = {
    TTL?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
  };

  export type WebPushError = Error & {
    statusCode?: number;
    body?: string;
    headers?: Record<string, string>;
  };

  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: WebPushSubscription,
      payload?: string,
      options?: WebPushSendOptions
    ): Promise<void>;
  };

  export default webpush;
}
