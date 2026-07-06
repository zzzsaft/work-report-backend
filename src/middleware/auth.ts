import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { getCapabilitiesForRoles } from "../modules/auth/capabilities.js";
import { clearImportSignatureCache, verifyImportSignature } from "../modules/auth/import-signature.js";
import { extractAuthToken, clearAuthCacheEntries } from "../modules/auth/token.js";
import type { AuthenticatedUser } from "../modules/auth/types.js";
import { resolveUser } from "../modules/auth/user-resolver.js";

export type { AuthenticatedUser };
export { extractAuthToken, resolveUser, getCapabilitiesForRoles };

export const clearAuthCache = () => {
  clearAuthCacheEntries();
  clearImportSignatureCache();
};

export const requireAdminUser = async (token: string | undefined) => {
  if (!token) throw new AppError(401, "token 缺失或失效");
  const user = await resolveUser(token);
  if (!user.roles.includes("admin")) throw new AppError(403, "当前用户无权限");
  return user;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const isImportPath =
      req.path === "/leader/operations/import" ||
      req.path === "/api/operations/import";
    const isCompletePath = req.path === "/api/operations/complete";

    if (isCompletePath) {
      req.user = {
        id: "system-complete",
        name: "工序完工接口",
        roles: ["admin"]
      };
      next();
      return;
    }

    const importUser = isImportPath ? verifyImportSignature(req) : null;
    if (importUser) {
      req.user = importUser;
      next();
      return;
    }

    const token = extractAuthToken(req.headers.authorization, req.cookies);
    if (!token) throw new AppError(401, "token 缺失或失效");

    req.authToken = token;
    req.user = await resolveUser(token);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCapability = (capability: keyof ReturnType<typeof getCapabilitiesForRoles>): RequestHandler => {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, "token 缺失或失效"));
      return;
    }

    const capabilities = getCapabilitiesForRoles(req.user.roles);
    if (!capabilities[capability]) {
      next(new AppError(403, "当前用户无权限"));
      return;
    }
    next();
  };
};

export const requirePermissionManagement: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(new AppError(401, "token 缺失或失效"));
    return;
  }

  const capabilities = getCapabilitiesForRoles(req.user.roles);
  if (
    !capabilities.canAssignWorkers ||
    !capabilities.canForceRemoveAssignments ||
    !capabilities.canViewAllTeams
  ) {
    next(new AppError(403, "当前用户无权限"));
    return;
  }

  next();
};
