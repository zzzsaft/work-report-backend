import { Router } from "express";
import type { Request, Response } from "express";
import { config } from "../../lib/config.js";
import { extractAuthToken, requireAdminUser, resolveUser } from "../../middleware/auth.js";
import { canTryAuth } from "../auth/rate-limit.js";
import {
  batchDeleteWecomContactUsers,
  createWecomDepartment,
  createWecomContactUser,
  deleteWecomDepartment,
  exchangeWecomCode,
  getWecomDepartment,
  getWecomAuthClient,
  getWecomJoinQrcode,
  inviteWecomContacts,
  listWecomDepartmentIds,
  listWecomDepartments,
  listWecomUserDepartmentIds,
  DEFAULT_WECOM_CLIENT_ID,
  isOriginAllowed,
  normalizeWecomClientId,
  syncWecomUserDepartmentIds,
  updateWecomDepartment,
  updateWecomContactUser
} from "./service.js";

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: config.authCookieSecure,
  sameSite: "lax" as const,
  path: "/"
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

const requireAdmin = async (req: Request) => {
  const token = extractAuthToken(req.headers.authorization, req.cookies);
  return requireAdminUser(token);
};

router.post("/auth/wecom/token", async (req, res, next) => {
  try {
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    await exchangeToken(req, res, clientId);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/token", async (req, res, next) => {
  try {
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
    await exchangeToken(req, res, DEFAULT_WECOM_CLIENT_ID);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/users", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, user: nestedUser, ...topLevelUser } = req.body ?? {};
    const user = nestedUser ?? topLevelUser;
    res.status(201).json(await createWecomContactUser(clientId, user));
  } catch (error) {
    next(error);
  }
});

router.patch("/auth/admin/wecom/users/:userid", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, user: nestedUser, ...topLevelUser } = req.body ?? {};
    const user = {
      ...(nestedUser ?? topLevelUser),
      userid: String((nestedUser ?? topLevelUser)?.userid ?? req.params.userid).trim()
    };
    res.json(await updateWecomContactUser(clientId, user));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/users/batch-delete", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.json(await batchDeleteWecomContactUsers(clientId, req.body?.useridlist));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/departments", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, department: nestedDepartment, ...topLevelDepartment } = req.body ?? {};
    const department = nestedDepartment ?? topLevelDepartment;
    res.status(201).json(await createWecomDepartment(clientId, department));
  } catch (error) {
    next(error);
  }
});

router.patch("/auth/admin/wecom/departments/:id", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, department: nestedDepartment, ...topLevelDepartment } = req.body ?? {};
    const department = {
      ...(nestedDepartment ?? topLevelDepartment),
      id: (nestedDepartment ?? topLevelDepartment)?.id ?? req.params.id
    };
    res.json(await updateWecomDepartment(clientId, department));
  } catch (error) {
    next(error);
  }
});

router.delete("/auth/admin/wecom/departments/:id", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.query.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.json(await deleteWecomDepartment(clientId, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/admin/wecom/departments/simplelist", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.query.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.setHeader("Cache-Control", "no-store");
    res.json(await listWecomDepartmentIds(clientId, req.query.id));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/admin/wecom/departments/list", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.query.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.setHeader("Cache-Control", "no-store");
    res.json(await listWecomDepartments(clientId, req.query.id));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/admin/wecom/departments/:id", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.query.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.setHeader("Cache-Control", "no-store");
    res.json(await getWecomDepartment(clientId, req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/user-departments/list-id", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, ...options } = req.body ?? {};
    res.json(await listWecomUserDepartmentIds(clientId, options));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/user-departments/sync", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, ...options } = req.body ?? {};
    res.json(await syncWecomUserDepartmentIds(clientId, options));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/wecom/invite", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.body?.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    const { clientId: _clientId, ...invite } = req.body ?? {};
    res.json(await inviteWecomContacts(clientId, invite));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/admin/wecom/join-qrcode", async (req, res, next) => {
  try {
    await requireAdmin(req);
    const clientId = normalizeWecomClientId(req.query.clientId ?? DEFAULT_WECOM_CLIENT_ID);
    res.setHeader("Cache-Control", "no-store");
    res.json(await getWecomJoinQrcode(clientId, req.query.sizeType ?? req.query.size_type));
  } catch (error) {
    next(error);
  }
});

export const wecomRouter = router;
