import "dotenv/config";

const numberFromEnv = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (!value) return fallback;
  return value.toLowerCase() === "true";
};

const corsOriginFromEnv = (name: string) => {
  const value = process.env[name];
  if (!value) return "*";

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) return "*";
  if (origins.length === 1) return origins[0];
  return origins;
};

export const config = {
  port: numberFromEnv("PORT", 8080),
  authApiBaseUrl: process.env.AUTH_API_BASE_URL || "http://hz.jc-times.com:2000/",
  corsOrigin: corsOriginFromEnv("CORS_ORIGIN"),
  corsCredentials: booleanFromEnv("CORS_CREDENTIALS", true),
  authCookieName: process.env.AUTH_COOKIE_NAME || "auth_token",
  authCacheTtlSeconds: numberFromEnv("AUTH_CACHE_TTL_SECONDS", 300),
  allowMockToken: booleanFromEnv("ALLOW_MOCK_TOKEN", false),
  mockAuthToken: process.env.MOCK_AUTH_TOKEN || "mock-token",
  mockUserId: process.env.MOCK_USER_ID || "demo-worker",
  mockUserName: process.env.MOCK_USER_NAME || "张师傅",
  mockUserRoles: (process.env.MOCK_USER_ROLES || "worker")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean),
  importApiKey: process.env.IMPORT_API_KEY || "",
  importApiSecret: process.env.IMPORT_API_SECRET || "",
  importSignatureTtlSeconds: numberFromEnv("IMPORT_SIGNATURE_TTL_SECONDS", 300)
};
