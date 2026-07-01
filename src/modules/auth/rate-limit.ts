const authAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_AUTH_ATTEMPT_ENTRIES = 10000;

export const canTryAuth = (ip: string | undefined, path: string) => {
  const now = Date.now();
  const key = `${ip ?? ""}:${path}`;

  for (const [attemptKey, attempt] of authAttempts) {
    if (attempt.resetAt <= now) authAttempts.delete(attemptKey);
  }

  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    while (authAttempts.size > MAX_AUTH_ATTEMPT_ENTRIES) {
      const oldestKey = authAttempts.keys().next().value;
      if (!oldestKey) break;
      authAttempts.delete(oldestKey);
    }
    return true;
  }
  current.count += 1;
  return current.count <= 20;
};
