import { Router } from "express";
import type { Request, Response } from "express";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { verifyLocalToken } from "../../lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles, requireAdminUser, resolveUser } from "../../middleware/auth.js";
import { authAccountService } from "./accounts.js";
import { exchangeWecomCode, getWecomAuthClient, isOriginAllowed } from "./wecom.js";

const router = Router();
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_AUTH_ATTEMPT_ENTRIES = 10000;

const cookieOptions = {
  httpOnly: true,
  secure: config.authCookieSecure,
  sameSite: "lax" as const,
  path: "/"
};

const canTryAuth = (ip: string | undefined, path: string) => {
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

const exchangeToken = async (req: Request, res: Response, clientId: string) => {
  if (!canTryAuth(req.ip, req.path)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }

  const client = getWecomAuthClient(clientId);
  if (!isOriginAllowed(client, req.headers.origin)) {
    res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
    return;
  }

  const code = String(req.body?.code ?? "").trim();
  const result = await exchangeWecomCode(clientId, code);
  await resolveUser(result.token);
  res.cookie(config.authCookieName, result.token, {
    ...cookieOptions,
    maxAge: 30 * 60 * 1000
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(result);
};

router.post("/auth/wecom/token", async (req, res, next) => {
  try {
    const clientId = String(req.body?.clientId ?? "").trim();
    if (!clientId) throw new AppError(400, "INVALID_CLIENT");
    await exchangeToken(req, res, clientId);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/token", async (req, res, next) => {
  try {
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
    await exchangeToken(req, res, "legacy-frontend");
  } catch (error) {
    next(error);
  }
});

router.post("/auth/password/token", async (req, res, next) => {
  try {
    if (!canTryAuth(req.ip, req.path)) {
      res.status(429).json({ error: "RATE_LIMITED" });
      return;
    }

    const result = await authAccountService.login({
      clientId: req.body?.clientId,
      username: req.body?.username,
      password: req.body?.password
    });
    res.cookie(config.authCookieName, result.token, {
      ...cookieOptions,
      maxAge: 30 * 60 * 1000
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", async (req, res, next) => {
  try {
    const token = extractAuthToken(req.headers.authorization, req.cookies);
    if (!token) throw new AppError(401, "token 缺失或失效");

    const user = await resolveUser(token);
    const localToken = verifyLocalToken(token);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      userId: user.id,
      wecomUserId: user.wecomUserId ?? null,
      corpId: localToken?.corpId ?? "",
      clientId: localToken?.clientId ?? "legacy-frontend",
      scopes: localToken?.scopes ?? [],
      name: user.name,
      avatar: user.avatar ?? null,
      roles: user.roles,
      capabilities: getCapabilitiesForRoles(user.roles)
    });
  } catch (error) {
    next(error);
  }
});

const requireAdmin = async (req: Request) => {
  const token = extractAuthToken(req.headers.authorization, req.cookies);
  return requireAdminUser(token);
};

router.get("/auth/admin/accounts", async (req, res, next) => {
  try {
    await requireAdmin(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await authAccountService.listAccounts(req.query.keyword));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/accounts", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const account = await authAccountService.createAccount({
      username: req.body?.username,
      password: req.body?.password,
      name: req.body?.name,
      roles: req.body?.roles,
      enabled: req.body?.enabled
    });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

router.patch("/auth/admin/accounts/:id", async (req, res, next) => {
  try {
    await requireAdmin(req);
    res.json(
      await authAccountService.updateAccount(req.params.id, {
        name: req.body?.name,
        roles: req.body?.roles,
        enabled: req.body?.enabled,
        password: req.body?.password,
        passwordHash: req.body?.passwordHash
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/accounts/:id/reset-password", async (req, res, next) => {
  try {
    await requireAdmin(req);
    await authAccountService.resetPassword(req.params.id, req.body?.password);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(config.authCookieName, cookieOptions);
  res.setHeader("Cache-Control", "no-store");
  res.status(204).send();
});

export const authRouter = router;
