import { Router } from "express";
import type { Request, Response } from "express";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { verifyLocalToken } from "../../lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles, resolveUser } from "../../middleware/auth.js";
import { exchangeWecomCode, getWecomAuthClient, isOriginAllowed } from "./wecom.js";

const router = Router();
const authAttempts = new Map<string, { count: number; resetAt: number }>();

const cookieOptions = {
  httpOnly: true,
  secure: config.authCookieSecure,
  sameSite: "lax" as const,
  path: "/"
};

const canTryAuth = (ip: string | undefined, path: string) => {
  const now = Date.now();
  const key = `${ip ?? ""}:${path}`;
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
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

router.get("/auth/me", async (req, res, next) => {
  try {
    const token = extractAuthToken(req.headers.authorization, req.cookies);
    if (!token) throw new AppError(401, "token 缺失或失效");

    const user = await resolveUser(token);
    const localToken = verifyLocalToken(token);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      userId: user.id,
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

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(config.authCookieName, cookieOptions);
  res.setHeader("Cache-Control", "no-store");
  res.status(204).send();
});

export const authRouter = router;
