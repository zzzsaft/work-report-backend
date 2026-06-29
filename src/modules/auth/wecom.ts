import fs from "node:fs";
import path from "node:path";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { generateLocalToken } from "../../lib/jwt.js";
import { decryptJson, encryptJson, isWechatProxyEncryptedBody } from "./wechat-proxy-crypto.js";

interface RawWechatAppConfig {
  agentId?: number;
  corpSecret?: string;
  name?: string;
  clientId?: string;
  allowedOrigins?: string[];
  scopes?: string[];
}

interface RawWechatCorpConfig {
  corpId?: string;
  name?: string;
  apps?: RawWechatAppConfig[];
}

export interface WecomAuthClient {
  clientId: string;
  corpId: string;
  corpName: string;
  agentId: number;
  appName: string;
  corpSecret: string;
  allowedOrigins: string[];
  scopes: string[];
}

interface WecomTokenResponse {
  errcode: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

interface WecomUserInfoResponse {
  errcode: number;
  errmsg?: string;
  UserId?: string;
  userid?: string;
  user_ticket?: string;
}

interface WecomContactUserResponse {
  errcode: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  avatar?: string;
  thumb_avatar?: string;
}

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

const parseOriginList = (value?: string) => {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      // Fall through to comma-separated parsing.
    }
  }
  return trimmed.split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean);
};

const clientOriginEnvName = (clientId: string) =>
  `WECHAT_AUTH_ALLOWED_ORIGINS_${clientId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;

const originsForClient = (
  clientId: string | undefined,
  configuredOrigins: string[] | undefined,
  env: NodeJS.ProcessEnv
) => [
  ...new Set([
    ...(configuredOrigins ?? []),
    ...parseOriginList(env.WECHAT_AUTH_ALLOWED_ORIGINS),
    ...(clientId ? parseOriginList(env[clientOriginEnvName(clientId)]) : [])
  ].filter(Boolean))
];

const normalizeRawConfigs = (configs: RawWechatCorpConfig[], env: NodeJS.ProcessEnv) =>
  configs.flatMap((corp) =>
    (corp.apps ?? [])
      .filter((app) => corp.corpId && app.clientId && app.agentId && app.corpSecret)
      .map((app) => ({
        clientId: app.clientId?.trim() ?? "",
        corpId: corp.corpId ?? "",
        corpName: corp.name ?? "",
        agentId: app.agentId ?? 0,
        appName: app.name ?? "",
        corpSecret: app.corpSecret ?? "",
        allowedOrigins: originsForClient(app.clientId?.trim(), app.allowedOrigins, env),
        scopes: app.scopes?.filter(Boolean) ?? []
      }))
  );

const parseJsonConfig = (value: string | undefined): RawWechatCorpConfig[] => {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const loadWechatJson = (cwd = process.cwd()): RawWechatCorpConfig[] => {
  const configPath = path.resolve(cwd, "wechat.json");
  if (!fs.existsSync(configPath)) return [];
  return parseJsonConfig(fs.readFileSync(configPath, "utf8"));
};

const loadEnvFallbackClients = (env: NodeJS.ProcessEnv): WecomAuthClient[] => {
  const clients: WecomAuthClient[] = [];
  const addClient = (clientId: string, corpId?: string, corpSecret?: string, agentId?: string, appName = "") => {
    const parsedAgentId = Number(agentId);
    if (!corpId || !corpSecret || !Number.isFinite(parsedAgentId)) return;
    clients.push({
      clientId,
      corpId: corpId.trim(),
      corpName: "",
      agentId: parsedAgentId,
      appName,
      corpSecret: corpSecret.trim(),
      allowedOrigins: originsForClient(clientId, [], env),
      scopes: []
    });
  };

  addClient(
    "legacy-frontend",
    env.WECOM_LEGACY_CORP_ID ?? env.CORP_ID,
    env.WECOM_LEGACY_CORP_SECRET ?? env.CORP_SECRET_CRM ?? env.CORP_SECRET,
    env.WECOM_LEGACY_AGENT_ID ?? env.CORP_AGENTID_CRM ?? env.CORP_AGENTID,
    env.WECOM_LEGACY_APP_NAME ?? "CRM"
  );
  addClient(
    "new-frontend",
    env.WECOM_NEW_CORP_ID ?? env.CORP_ID_J1,
    env.WECOM_NEW_CORP_SECRET ?? env.CORP_SECRET_J1,
    env.WECOM_NEW_AGENT_ID ?? env.CORP_AGENTID_J1,
    env.WECOM_NEW_APP_NAME ?? "frontend"
  );
  return clients;
};

export const loadWecomAuthClients = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) => {
  const configured = [
    ...normalizeRawConfigs(parseJsonConfig(env.WECHAT_AUTH_CLIENTS ?? env.WECOM_AUTH_CLIENTS), env),
    ...normalizeRawConfigs(loadWechatJson(cwd), env),
    ...loadEnvFallbackClients(env)
  ];
  const byClientId = new Map<string, WecomAuthClient>();
  for (const client of configured) {
    if (!byClientId.has(client.clientId)) byClientId.set(client.clientId, client);
  }
  return [...byClientId.values()];
};

export const getWecomAuthClient = (clientId: string) => {
  const client = loadWecomAuthClients().find((item) => item.clientId === clientId);
  if (!client) throw new AppError(400, "INVALID_CLIENT");
  return client;
};

export const isOriginAllowed = (client: WecomAuthClient, origin: unknown) => {
  if (client.allowedOrigins.length === 0 || typeof origin !== "string") return true;
  return client.allowedOrigins.includes(origin);
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new AppError(502, "WECOM_UNAVAILABLE");
  return (await response.json()) as T;
};

const wecomUrl = (pathname: string) => new URL(pathname, config.wecomApiBaseUrl);

const fetchWechatProxyJson = async <T>(
  method: "GET" | "POST",
  pathName: string,
  query: Record<string, unknown> = {},
  payload: Record<string, unknown> = {}
): Promise<T | null> => {
  if (!config.wechatProxyCryptoSecret) return null;
  if (!pathName.startsWith("/cgi-bin/")) throw new AppError(500, "WECOM_PROXY_PATH_INVALID");

  const response = await fetch(new URL("/wechat/proxy", config.wechatProxyHost).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encrypted: encryptJson(
        {
          method,
          path: pathName,
          tokenType: "none",
          query,
          payload
        },
        config.wechatProxyCryptoSecret
      )
    })
  });

  const body = await response.json().catch(() => null);
  if (!isWechatProxyEncryptedBody(body)) throw new AppError(502, "WECOM_PROXY_INVALID_RESPONSE");
  if (!response.ok) throw new AppError(502, "WECOM_PROXY_FAILED");
  return decryptJson<T>(body.encrypted, config.wechatProxyCryptoSecret);
};

const fetchWecomJson = async <T>(
  method: "GET" | "POST",
  pathName: string,
  query: Record<string, unknown> = {},
  payload: Record<string, unknown> = {}
): Promise<T> => {
  const proxyData = await fetchWechatProxyJson<T>(method, pathName, query, payload);
  if (proxyData) return proxyData;

  const url = wecomUrl(pathName);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  if (method === "GET") return fetchJson<T>(url.toString());

  const response = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new AppError(502, "WECOM_UNAVAILABLE");
  return (await response.json()) as T;
};

const getAccessToken = async (client: WecomAuthClient) => {
  const cacheKey = `${client.corpId}:${client.agentId}:${client.corpSecret}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const data = await fetchWecomJson<WecomTokenResponse>("GET", "/cgi-bin/gettoken", {
    corpid: client.corpId,
    corpsecret: client.corpSecret
  });
  if (data.errcode !== 0 || !data.access_token || !data.expires_in) {
    throw new AppError(502, "WECOM_TOKEN_FAILED");
  }

  accessTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(data.expires_in - 60, 60) * 1000
  });
  return data.access_token;
};

const getUserIdByCode = async (client: WecomAuthClient, accessToken: string, code: string) => {
  const data = await fetchWecomJson<WecomUserInfoResponse>("GET", "/cgi-bin/auth/getuserinfo", {
    access_token: accessToken,
    code
  });
  const userId = data.UserId ?? data.userid;
  if (data.errcode !== 0 || !userId) throw new AppError(401, "INVALID_CODE");
  return userId;
};

const getContactUser = async (accessToken: string, userId: string) => {
  try {
    const data = await fetchWecomJson<WecomContactUserResponse>("GET", "/cgi-bin/user/get", {
      access_token: accessToken,
      userid: userId
    });
    if (data.errcode !== 0) return null;
    return data;
  } catch {
    return null;
  }
};

export const exchangeWecomCode = async (clientId: string, code: string) => {
  if (!code) throw new AppError(400, "MISSING_CODE");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getAccessToken(client);
  const userId = await getUserIdByCode(client, accessToken, code);
  const profile = await getContactUser(accessToken, userId);
  const name = profile?.name ?? userId;
  const avatar = profile?.avatar ?? profile?.thumb_avatar ?? null;
  const token = generateLocalToken({
    userId,
    wecomUserId: userId,
    corpId: client.corpId,
    clientId: client.clientId,
    scopes: client.scopes,
    name,
    avatar
  });

  return {
    token,
    user: {
      userId,
      wecomUserId: userId,
      corpId: client.corpId,
      clientId: client.clientId,
      name,
      avatar
    }
  };
};

export const clearWecomAuthCache = () => {
  accessTokenCache.clear();
};
