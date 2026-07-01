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

const authClientIdsFromEnv = () => {
  const value = process.env.AUTH_CLIENT_IDS;
  const values = (value || "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);
  const isOldFrontendConfig =
    values.length > 0 && values.every((clientId) => ["legacy-frontend", "new-frontend"].includes(clientId));
  const normalizedValue = values.length === 0 || isOldFrontendConfig
    ? process.env.WECOM_CLIENT_ID || "work-report"
    : values.join(",");

  const authClientIds = normalizedValue
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);
  const wecomClientIds = wecomAuthClientIdsFromEnv();
  return [...new Set([...authClientIds, ...wecomClientIds])];
};

const normalizeWecomClientId = (clientId: unknown) => {
  const normalized = String(clientId ?? "").trim() || "work-report";
  return ["legacy-frontend", "new-frontend"].includes(normalized) ? "work-report" : normalized;
};

const wecomAuthClientIdsFromEnv = () => {
  const rawConfig = process.env.WECHAT_AUTH_CLIENTS ?? process.env.WECOM_AUTH_CLIENTS;
  if (!rawConfig?.trim()) return [];

  try {
    const parsed = JSON.parse(rawConfig) as Array<{ apps?: Array<{ clientId?: unknown }> }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((corp) =>
      (corp.apps ?? []).map((app) => normalizeWecomClientId(app.clientId)).filter(Boolean)
    );
  } catch {
    return [];
  }
};

export const config = {
  port: numberFromEnv("PORT", 8080),
  authApiBaseUrl: process.env.AUTH_API_BASE_URL || "http://hz.jc-times.com:2000/",
  corsOrigin: corsOriginFromEnv("CORS_ORIGIN"),
  corsCredentials: booleanFromEnv("CORS_CREDENTIALS", true),
  authCookieName: process.env.AUTH_COOKIE_NAME || "auth_token",
  authCookieSecure: booleanFromEnv("AUTH_COOKIE_SECURE", process.env.NODE_ENV === "production"),
  authCacheTtlSeconds: numberFromEnv("AUTH_CACHE_TTL_SECONDS", 300),
  jwtSecret: process.env.JWT_SECRET || "",
  authTokenTtl: process.env.AUTH_TOKEN_TTL || "30m",
  authClientIds: authClientIdsFromEnv(),
  wecomApiBaseUrl: process.env.WECOM_API_BASE_URL || "https://qyapi.weixin.qq.com",
  wechatProxyHost:
    process.env.WECHAT_PROXY_HOST ||
    process.env.JCTIMES_WECHAT_PROXY_HOST ||
    "http://122.226.146.110:780",
  wechatProxyCryptoSecret: process.env.WECHAT_PROXY_CRYPTO_SECRET || "",
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
  importSignatureTtlSeconds: numberFromEnv("IMPORT_SIGNATURE_TTL_SECONDS", 300),
  xftHost: process.env.XFT_HOST || "https://api.cmbchina.com",
  xftAppid: process.env.XFT_APPID || "",
  xftAuthoritySecret: process.env.XFT_AUTHORITY_SECRET || "",
  xftEnterpriseId: process.env.XFT_ENTERPRISE_ID || "",
  xftSsoPrivateKey: process.env.XFT_SSO_PRIVATE_KEY || process.env.RSA_PRIVATE_KEY || "",
  xftSsoConnectorId: process.env.XFT_SSO_CONNECTOR_ID || "223147993689554944",
  xftSsoFlowId: process.env.XFT_SSO_FLOW_ID || "224943279282388992",
  xftSsoWecomClientId: process.env.XFT_SSO_WECOM_CLIENT_ID || "work-report",
  xftSsoLoginBaseUrl:
    process.env.XFT_SSO_LOGIN_BASE_URL || "https://xft.cmbchina.com/xft-gateway/xft-login-new/xwapi/login"
};
