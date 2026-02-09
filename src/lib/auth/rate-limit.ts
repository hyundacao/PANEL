type LoginAttemptState = {
  fails: number;
  windowStartAt: number;
  blockedUntil: number;
  lastSeenAt: number;
};

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const CLEANUP_EVERY_MS = 5 * 60 * 1000;

const attempts = new Map<string, LoginAttemptState>();
let nextCleanupAt = 0;

const cleanup = (now: number) => {
  if (now < nextCleanupAt) return;
  const keepForMs = Math.max(WINDOW_MS, BLOCK_MS) * 3;
  for (const [key, state] of attempts.entries()) {
    const stale = now - state.lastSeenAt > keepForMs;
    const blockExpired = state.blockedUntil <= now;
    if (stale && blockExpired) {
      attempts.delete(key);
    }
  }
  nextCleanupAt = now + CLEANUP_EVERY_MS;
};

export const buildLoginRateLimitKey = (username: string, clientIp: string) =>
  `${username.trim().toLowerCase()}|${clientIp.trim() || 'unknown'}`;

export const getLoginBlockState = (key: string) => {
  const now = Date.now();
  cleanup(now);
  const state = attempts.get(key);
  if (!state) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  if (state.blockedUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((state.blockedUntil - now) / 1000)
      )
    };
  }
  return { blocked: false, retryAfterSeconds: 0 };
};

export const registerLoginFailure = (key: string) => {
  const now = Date.now();
  cleanup(now);
  const current = attempts.get(key);
  if (!current) {
    attempts.set(key, {
      fails: 1,
      windowStartAt: now,
      blockedUntil: 0,
      lastSeenAt: now
    });
    return;
  }
  let fails = current.fails;
  let windowStartAt = current.windowStartAt;
  let blockedUntil = current.blockedUntil;

  if (now - windowStartAt > WINDOW_MS) {
    fails = 0;
    windowStartAt = now;
  }

  fails += 1;
  if (fails >= MAX_FAILURES) {
    blockedUntil = now + BLOCK_MS;
    fails = 0;
    windowStartAt = now;
  }

  attempts.set(key, {
    fails,
    windowStartAt,
    blockedUntil,
    lastSeenAt: now
  });
};

export const clearLoginFailures = (key: string) => {
  attempts.delete(key);
};
