import jwt, { type JwtPayload as JsonWebTokenPayload } from "jsonwebtoken";
import { config } from "./config.js";

const JWT_ISSUER = "jdy-backend";
const DEFAULT_CLIENT_IDS = ["work-report"] as const;

export interface LocalJwtPayload {
  sub?: string;
  userId: string;
  wecomUserId?: string | null;
  corpId?: string;
  clientId?: string;
  scopes?: string[];
  name?: string | null;
  avatar?: string | null;
  gender?: string | null;
  qrCode?: string | null;
  mobile?: string | null;
  email?: string | null;
  bizMail?: string | null;
  address?: string | null;
  department?: unknown;
  departmentOrder?: unknown;
  position?: string | null;
  isLeaderInDept?: unknown;
  directLeader?: unknown;
  telephone?: string | null;
  alias?: string | null;
  extattr?: unknown;
  wecomStatus?: number | null;
  externalProfile?: unknown;
  externalPosition?: string | null;
  openUserid?: string | null;
  mainDepartment?: number | null;
}

export interface LocalAuthenticatedJwt extends LocalJwtPayload {
  sub: string;
  corpId: string;
  clientId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

const jwtSecret = () => {
  if (config.jwtSecret) return config.jwtSecret;
  if (process.env.NODE_ENV === "production") return "";
  return "development-only-jwt-secret";
};

const expectedClientIds = () =>
  config.authClientIds.length > 0 ? config.authClientIds : DEFAULT_CLIENT_IDS;

const normalizePayload = (payload: LocalJwtPayload): LocalAuthenticatedJwt => ({
  ...payload,
  sub: payload.sub ?? payload.userId,
  corpId: payload.corpId ?? "",
  clientId: payload.clientId ?? "work-report",
  scopes: payload.scopes ?? []
});

export const generateLocalToken = (payload: LocalJwtPayload) => {
  const secret = jwtSecret();
  if (!secret) throw new Error("JWT_SECRET is required to generate auth tokens");

  const normalized = normalizePayload(payload);
  return jwt.sign(normalized, secret, {
    expiresIn: config.authTokenTtl as jwt.SignOptions["expiresIn"],
    issuer: JWT_ISSUER,
    audience: normalized.clientId
  });
};

export const verifyLocalToken = (
  token: string,
  clientIds: readonly string[] = expectedClientIds()
): LocalAuthenticatedJwt | null => {
  const secret = jwtSecret();
  if (!secret || !token || clientIds.length === 0) return null;

  try {
    const decoded = jwt.verify(token, secret, {
      issuer: JWT_ISSUER,
      audience: clientIds as [string, ...string[]]
    }) as unknown as JsonWebTokenPayload & LocalJwtPayload;
    return normalizePayload(decoded);
  } catch (error) {
    try {
      const legacy = jwt.verify(token, secret) as JsonWebTokenPayload & LocalJwtPayload;
      if (legacy.iss || legacy.aud) throw error;
      return normalizePayload(legacy);
    } catch {
      return null;
    }
  }
};
