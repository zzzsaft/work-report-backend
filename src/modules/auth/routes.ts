import { Router } from "express";
import type { Request, Response } from "express";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { verifyLocalToken } from "../../lib/jwt.js";
import { extractAuthToken, getCapabilitiesForRoles, requireAdminUser, resolveUser } from "../../middleware/auth.js";
import { authAccountService } from "./accounts.js";
import { canTryAuth } from "./rate-limit.js";
import { testXftSsoLogin, xftSsoLogin } from "../xft/sso.js";

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: config.authCookieSecure,
  sameSite: "lax" as const,
  path: "/"
};

router.get("/xft/sso", async (req, res, next) => {
  try {
    await xftSsoLogin(req, res, next);
  } catch (error) {
    next(error);
  }
});
router.post("/xft/test", testXftSsoLogin);

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
      clientId: localToken?.clientId ?? "work-report",
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
