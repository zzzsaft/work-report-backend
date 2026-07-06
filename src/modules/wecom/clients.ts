import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../lib/errors.js";
import { DEFAULT_WECOM_CLIENT_ID, OLD_WECOM_CLIENT_IDS } from "./constants.js";
import type { RawWechatCorpConfig, WecomAuthClient } from "./types.js";

let defaultAuthClientsCache: WecomAuthClient[] | null = null;

export const parseOriginList = (value?: string) => {
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

export const clientOriginEnvName = (clientId: string) =>
  `WECHAT_AUTH_ALLOWED_ORIGINS_${clientId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;

export const normalizeWecomClientId = (clientId: unknown) => {
  const normalized = String(clientId ?? "").trim() || DEFAULT_WECOM_CLIENT_ID;
  return OLD_WECOM_CLIENT_IDS.has(normalized) ? DEFAULT_WECOM_CLIENT_ID : normalized;
};

export const originsForClient = (
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

export const normalizeRawConfigs = (configs: RawWechatCorpConfig[], env: NodeJS.ProcessEnv) =>
  configs.flatMap((corp) =>
    (corp.apps ?? [])
      .filter((app) => corp.corpId && app.agentId && app.corpSecret)
      .map((app) => ({
        clientId: normalizeWecomClientId(app.clientId?.trim() || env.WECOM_CLIENT_ID || DEFAULT_WECOM_CLIENT_ID),
        corpId: corp.corpId ?? "",
        corpName: corp.name ?? "",
        agentId: app.agentId ?? 0,
        appName: app.name ?? "",
        corpSecret: app.corpSecret ?? "",
        contactCorpSecret: app.contactCorpSecret ?? app.contactSecret ?? app.addressBookSecret ?? "",
        allowedOrigins: originsForClient(app.clientId?.trim(), app.allowedOrigins, env),
        scopes: app.scopes?.filter(Boolean) ?? []
      }))
  );

export const parseJsonConfig = (value: string | undefined): RawWechatCorpConfig[] => {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

export const loadWechatJson = (cwd = process.cwd()): RawWechatCorpConfig[] => {
  const configPath = path.resolve(cwd, "wechat.json");
  if (!fs.existsSync(configPath)) return [];
  return parseJsonConfig(fs.readFileSync(configPath, "utf8"));
};

export const loadEnvFallbackClients = (env: NodeJS.ProcessEnv): WecomAuthClient[] => {
  const clients: WecomAuthClient[] = [];
  const addClient = (
    clientId: string,
    corpId?: string,
    corpSecret?: string,
    agentId?: string,
    appName = "",
    contactCorpSecret = env.WECOM_CONTACT_CORP_SECRET
  ) => {
    const parsedAgentId = Number(agentId);
    if (!corpId || !corpSecret || !Number.isFinite(parsedAgentId)) return;
    clients.push({
      clientId,
      corpId: corpId.trim(),
      corpName: "",
      agentId: parsedAgentId,
      appName,
      corpSecret: corpSecret.trim(),
      contactCorpSecret: contactCorpSecret?.trim() ?? "",
      allowedOrigins: originsForClient(clientId, [], env),
      scopes: []
    });
  };

  addClient(
    env.WECOM_CLIENT_ID || DEFAULT_WECOM_CLIENT_ID,
    env.WECOM_CORP_ID ?? env.WECOM_NEW_CORP_ID ?? env.WECOM_LEGACY_CORP_ID ?? env.CORP_ID,
    env.WECOM_CORP_SECRET ?? env.WECOM_NEW_CORP_SECRET ?? env.WECOM_LEGACY_CORP_SECRET ?? env.CORP_SECRET,
    env.WECOM_AGENT_ID ?? env.WECOM_NEW_AGENT_ID ?? env.WECOM_LEGACY_AGENT_ID ?? env.CORP_AGENTID,
    env.WECOM_APP_NAME ?? env.WECOM_NEW_APP_NAME ?? env.WECOM_LEGACY_APP_NAME ?? "work-report"
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

export const getDefaultWecomAuthClients = () => {
  defaultAuthClientsCache ??= loadWecomAuthClients();
  return defaultAuthClientsCache;
};

export const clearDefaultWecomAuthClientsCache = () => {
  defaultAuthClientsCache = null;
};

export const getWecomAuthClient = (clientId: string) => {
  const normalizedClientId = normalizeWecomClientId(clientId);
  const client = getDefaultWecomAuthClients().find((item) => item.clientId === normalizedClientId);
  if (!client) throw new AppError(400, "INVALID_CLIENT");
  return client;
};

export const isOriginAllowed = (client: WecomAuthClient, origin: unknown) => {
  if (client.allowedOrigins.length === 0 || typeof origin !== "string") return true;
  return client.allowedOrigins.includes(origin);
};
