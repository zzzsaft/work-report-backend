import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { generateLocalToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";
import { decryptJson, encryptJson, isWechatProxyEncryptedBody } from "./crypto.js";

interface RawWechatAppConfig {
  agentId?: number;
  corpSecret?: string;
  contactCorpSecret?: string;
  contactSecret?: string;
  addressBookSecret?: string;
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
  contactCorpSecret: string;
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
  user_doc_ticket?: string;
}

interface WecomUserDetailResponse {
  errcode: number;
  errmsg?: string;
  userid?: string;
  gender?: string;
  avatar?: string;
  qr_code?: string;
  mobile?: string;
  email?: string;
  biz_mail?: string;
  address?: string;
}

interface WecomContactUserResponse {
  errcode: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  gender?: string;
  avatar?: string;
  thumb_avatar?: string;
  mobile?: string;
  email?: string;
  biz_mail?: string;
  qr_code?: string;
  address?: string;
  department?: unknown;
  order?: unknown;
  position?: string;
  is_leader_in_dept?: unknown;
  direct_leader?: unknown;
  telephone?: string;
  alias?: string;
  extattr?: unknown;
  status?: number;
  external_profile?: unknown;
  external_position?: string;
  open_userid?: string;
  main_department?: number;
}

interface WecomCreateUserResponse {
  errcode: number;
  errmsg?: string;
  created_department_list?: {
    department_info?: Array<{
      name?: string;
      id?: number;
    }>;
  };
}

interface WecomJoinQrcodeResponse {
  errcode: number;
  errmsg?: string;
  join_qrcode?: string;
}

interface WecomBasicResponse {
  errcode: number;
  errmsg?: string;
}

interface WecomCreateDepartmentResponse extends WecomBasicResponse {
  id?: number;
}

interface WecomDepartmentIdItem {
  id?: number;
  parentid?: number;
  order?: number;
}

interface WecomDepartmentSimpleListResponse extends WecomBasicResponse {
  department_id?: WecomDepartmentIdItem[];
}

interface WecomUserDepartmentItem {
  userid?: string;
  department?: number;
}

interface WecomUserDepartmentListResponse extends WecomBasicResponse {
  next_cursor?: string;
  dept_user?: WecomUserDepartmentItem[];
}

interface WecomInviteResponse extends WecomBasicResponse {
  invaliduser?: string[];
  invalidparty?: number[];
  invalidtag?: number[];
}

export const DEFAULT_WECOM_CLIENT_ID = "work-report";
const OLD_WECOM_CLIENT_IDS = new Set(["legacy-frontend", "new-frontend"]);

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

export const normalizeWecomClientId = (clientId: unknown) => {
  const normalized = String(clientId ?? "").trim() || DEFAULT_WECOM_CLIENT_ID;
  return OLD_WECOM_CLIENT_IDS.has(normalized) ? DEFAULT_WECOM_CLIENT_ID : normalized;
};

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

export const getWecomAuthClient = (clientId: string) => {
  const normalizedClientId = normalizeWecomClientId(clientId);
  const client = loadWecomAuthClients().find((item) => item.clientId === normalizedClientId);
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
  const cacheKey = `${client.corpId}:${client.corpSecret}`;
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

const getContactAccessToken = async (client: WecomAuthClient) => {
  if (!client.contactCorpSecret) throw new AppError(500, "WECOM_CONTACT_CORP_SECRET_MISSING");

  const cacheKey = `${client.corpId}:${client.contactCorpSecret}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const data = await fetchWecomJson<WecomTokenResponse>("GET", "/cgi-bin/gettoken", {
    corpid: client.corpId,
    corpsecret: client.contactCorpSecret
  });
  if (data.errcode !== 0 || !data.access_token || !data.expires_in) {
    throw new AppError(502, "WECOM_CONTACT_TOKEN_FAILED");
  }

  accessTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(data.expires_in - 60, 60) * 1000
  });
  return data.access_token;
};

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeDisplayName = (value: unknown, userId: string) => {
  const name = normalizeOptionalString(value);
  if (!name) return null;
  return name.toLowerCase() === userId.toLowerCase() ? null : name;
};

const normalizeOptionalNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const ensurePlainObject = (value: unknown, errorCode: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, errorCode);
  return value as Record<string, unknown>;
};

const normalizeStringList = (value: unknown, fieldName: string, maxLength: number) => {
  if (!Array.isArray(value)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  const items = value.map((item) => normalizeOptionalString(item)).filter((item): item is string => Boolean(item));
  if (items.length !== value.length || items.length === 0 || items.length > maxLength) {
    throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  }
  return items;
};

const normalizeNumberList = (value: unknown, fieldName: string, maxLength: number) => {
  if (!Array.isArray(value)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  const items = value.map((item) => Number(item)).filter((item) => Number.isInteger(item));
  if (items.length !== value.length || items.length === 0 || items.length > maxLength) {
    throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  }
  return items;
};

const normalizeInteger = (value: unknown, fieldName: string) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new AppError(400, `INVALID_${fieldName.toUpperCase()}`);
  return parsed;
};

const normalizeOptionalInteger = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeInteger(value, fieldName);
};

const normalizeOptionalDepartmentOrder = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= 2 ** 32) throw new AppError(400, "INVALID_ORDER");
  return parsed;
};

const departmentDbPayload = (
  clientId: string,
  department: {
    id: number;
    parentid: number;
    name?: unknown;
    name_en?: unknown;
    order?: unknown;
  }
) => ({
  clientId,
  departmentId: department.id,
  parentId: department.parentid,
  name: normalizeOptionalString(department.name),
  nameEn: normalizeOptionalString(department.name_en),
  order:
    department.order === undefined || department.order === null
      ? null
      : BigInt(normalizeOptionalDepartmentOrder(department.order) ?? 0)
});

const upsertWecomDepartment = async (
  clientId: string,
  department: {
    id: number;
    parentid: number;
    name?: unknown;
    name_en?: unknown;
    order?: unknown;
  }
) => {
  const data = departmentDbPayload(clientId, department);
  await prisma.wecomDepartment.upsert({
    where: { clientId_departmentId: { clientId, departmentId: data.departmentId } },
    create: data,
    update: {
      parentId: data.parentId,
      ...(department.name !== undefined ? { name: data.name } : {}),
      ...(department.name_en !== undefined ? { nameEn: data.nameEn } : {}),
      ...(department.order !== undefined ? { order: data.order } : {})
    }
  });
};

const syncUserDepartmentRows = async (
  clientId: string,
  rows: Array<{ userid: string; department: number }>,
  options: { replaceAll: boolean }
) => {
  const uniqueRows = [...new Map(rows.map((row) => [`${row.userid}:${row.department}`, row])).values()];
  const departmentIds = [...new Set(uniqueRows.map((row) => row.department))];
  await prisma.$transaction(async (tx) => {
    const oldUserIds = options.replaceAll
      ? await tx.wecomUserDepartment.findMany({
          where: { clientId },
          select: { userId: true },
          distinct: ["userId"]
        })
      : [];
    for (const departmentId of departmentIds) {
      await tx.wecomDepartment.upsert({
        where: { clientId_departmentId: { clientId, departmentId } },
        create: {
          clientId,
          departmentId,
          parentId: departmentId === 1 ? 0 : 1
        },
        update: {}
      });
    }

    if (options.replaceAll) await tx.wecomUserDepartment.deleteMany({ where: { clientId } });
    if (uniqueRows.length > 0) {
      await tx.wecomUserDepartment.createMany({
        data: uniqueRows.map((row) => ({
          clientId,
          userId: row.userid,
          departmentId: row.department
        })),
        skipDuplicates: true
      });
    }

    const departmentsByUser = new Map<string, number[]>();
    for (const row of uniqueRows) {
      const departments = departmentsByUser.get(row.userid) ?? [];
      departments.push(row.department);
      departmentsByUser.set(row.userid, departments);
    }

    const currentUserIds = new Set(departmentsByUser.keys());
    for (const { userId } of oldUserIds) {
      if (currentUserIds.has(userId)) continue;
      await tx.user.updateMany({
        where: {
          OR: [{ id: userId }, { wecomUserId: userId }]
        },
        data: {
          department: [],
          mainDepartment: null
        }
      });
    }

    for (const [userId, departments] of departmentsByUser) {
      const departmentJson = departments as Prisma.InputJsonArray;
      await tx.user.updateMany({
        where: {
          OR: [{ id: userId }, { wecomUserId: userId }]
        },
        data: {
          department: departmentJson,
          mainDepartment: departments[0] ?? null
        }
      });
    }
  });
};

const getUserInfoByCode = async (client: WecomAuthClient, accessToken: string, code: string) => {
  const data = await fetchWecomJson<WecomUserInfoResponse>("GET", "/cgi-bin/auth/getuserinfo", {
    access_token: accessToken,
    code
  });
  const userId = data.UserId ?? data.userid;
  if (data.errcode !== 0 || !userId) throw new AppError(401, "INVALID_CODE");
  return {
    userId,
    userTicket: normalizeOptionalString(data.user_ticket)
  };
};

const getUserDetail = async (accessToken: string, userTicket: string) => {
  try {
    const data = await fetchWecomJson<WecomUserDetailResponse>(
      "POST",
      "/cgi-bin/auth/getuserdetail",
      { access_token: accessToken },
      { user_ticket: userTicket }
    );
    if (data.errcode !== 0) return null;
    return {
      userid: normalizeOptionalString(data.userid),
      gender: normalizeOptionalString(data.gender),
      avatar: normalizeOptionalString(data.avatar),
      qrCode: normalizeOptionalString(data.qr_code),
      mobile: normalizeOptionalString(data.mobile),
      email: normalizeOptionalString(data.email),
      bizMail: normalizeOptionalString(data.biz_mail),
      address: normalizeOptionalString(data.address)
    };
  } catch {
    return null;
  }
};

const getContactUser = async (accessToken: string, userId: string) => {
  try {
    const data = await fetchWecomJson<WecomContactUserResponse>("GET", "/cgi-bin/user/get", {
      access_token: accessToken,
      userid: userId
    });
    if (data.errcode !== 0) return null;
    return {
      userid: normalizeOptionalString(data.userid),
      name: normalizeOptionalString(data.name),
      gender: normalizeOptionalString(data.gender),
      avatar: normalizeOptionalString(data.avatar),
      thumbAvatar: normalizeOptionalString(data.thumb_avatar),
      mobile: normalizeOptionalString(data.mobile),
      email: normalizeOptionalString(data.email),
      bizMail: normalizeOptionalString(data.biz_mail),
      qrCode: normalizeOptionalString(data.qr_code),
      address: normalizeOptionalString(data.address),
      position: normalizeOptionalString(data.position),
      telephone: normalizeOptionalString(data.telephone),
      alias: normalizeOptionalString(data.alias),
      wecomStatus: normalizeOptionalNumber(data.status),
      externalPosition: normalizeOptionalString(data.external_position),
      openUserid: normalizeOptionalString(data.open_userid),
      mainDepartment: normalizeOptionalNumber(data.main_department),
      ...(hasOwn(data, "department") ? { department: data.department } : {}),
      ...(hasOwn(data, "order") ? { departmentOrder: data.order } : {}),
      ...(hasOwn(data, "is_leader_in_dept") ? { isLeaderInDept: data.is_leader_in_dept } : {}),
      ...(hasOwn(data, "direct_leader") ? { directLeader: data.direct_leader } : {}),
      ...(hasOwn(data, "extattr") ? { extattr: data.extattr } : {}),
      ...(hasOwn(data, "external_profile") ? { externalProfile: data.external_profile } : {})
    };
  } catch {
    return null;
  }
};

export const exchangeWecomCode = async (clientId: string, code: string) => {
  if (!code) throw new AppError(400, "MISSING_CODE");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getAccessToken(client);
  const userInfo = await getUserInfoByCode(client, accessToken, code);
  const profile = userInfo.userTicket ? await getUserDetail(accessToken, userInfo.userTicket) : null;
  const userId = profile?.userid ?? userInfo.userId;
  const contact = await getContactUser(accessToken, userId);
  const realName = normalizeDisplayName(contact?.name, userId);
  const avatar = profile?.avatar ?? contact?.avatar ?? contact?.thumbAvatar ?? null;
  const profilePayload = profile || contact
    ? {
        avatar,
        gender: profile?.gender ?? contact?.gender ?? null,
        qrCode: profile?.qrCode ?? contact?.qrCode ?? null,
        mobile: profile?.mobile ?? contact?.mobile ?? null,
        email: profile?.email ?? contact?.email ?? null,
        bizMail: profile?.bizMail ?? contact?.bizMail ?? null,
        address: profile?.address ?? contact?.address ?? null,
        ...(contact?.position !== undefined ? { position: contact.position } : {}),
        ...(contact?.telephone !== undefined ? { telephone: contact.telephone } : {}),
        ...(contact?.alias !== undefined ? { alias: contact.alias } : {}),
        ...(contact?.wecomStatus !== undefined ? { wecomStatus: contact.wecomStatus } : {}),
        ...(contact?.externalPosition !== undefined ? { externalPosition: contact.externalPosition } : {}),
        ...(contact?.openUserid !== undefined ? { openUserid: contact.openUserid } : {}),
        ...(contact?.mainDepartment !== undefined ? { mainDepartment: contact.mainDepartment } : {}),
        ...("department" in (contact ?? {}) ? { department: contact?.department } : {}),
        ...("departmentOrder" in (contact ?? {}) ? { departmentOrder: contact?.departmentOrder } : {}),
        ...("isLeaderInDept" in (contact ?? {}) ? { isLeaderInDept: contact?.isLeaderInDept } : {}),
        ...("directLeader" in (contact ?? {}) ? { directLeader: contact?.directLeader } : {}),
        ...("extattr" in (contact ?? {}) ? { extattr: contact?.extattr } : {}),
        ...("externalProfile" in (contact ?? {}) ? { externalProfile: contact?.externalProfile } : {})
      }
    : {};
  const token = generateLocalToken({
    userId,
    wecomUserId: userId,
    corpId: client.corpId,
    clientId: client.clientId,
    scopes: client.scopes,
    ...(realName ? { name: realName } : {}),
    ...profilePayload
  });

  return {
    token,
    user: {
      userId,
      wecomUserId: userId,
      corpId: client.corpId,
      clientId: client.clientId,
      name: realName ?? userId,
      avatar,
      ...profilePayload
    }
  };
};

export const createWecomContactUser = async (clientId: string, user: unknown) => {
  const payload = ensurePlainObject(user, "INVALID_WECOM_USER");
  if (!normalizeOptionalString(payload.userid)) throw new AppError(400, "MISSING_USERID");
  if (!normalizeOptionalString(payload.name)) throw new AppError(400, "MISSING_NAME");

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomCreateUserResponse>(
    "POST",
    "/cgi-bin/user/create",
    { access_token: accessToken },
    payload
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_CREATE_USER_FAILED");
  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "created",
    createdDepartmentList: data.created_department_list ?? null
  };
};

export const updateWecomContactUser = async (clientId: string, user: unknown) => {
  const payload = ensurePlainObject(user, "INVALID_WECOM_USER");
  if (!normalizeOptionalString(payload.userid)) throw new AppError(400, "MISSING_USERID");

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomBasicResponse>(
    "POST",
    "/cgi-bin/user/update",
    { access_token: accessToken },
    payload
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_UPDATE_USER_FAILED");
  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "updated"
  };
};

export const batchDeleteWecomContactUsers = async (clientId: string, useridlist: unknown) => {
  const payload = { useridlist: normalizeStringList(useridlist, "useridlist", 200) };
  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomBasicResponse>(
    "POST",
    "/cgi-bin/user/batchdelete",
    { access_token: accessToken },
    payload
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_BATCH_DELETE_USER_FAILED");
  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "deleted"
  };
};

export const createWecomDepartment = async (clientId: string, department: unknown) => {
  const payload = ensurePlainObject(department, "INVALID_WECOM_DEPARTMENT");
  if (!normalizeOptionalString(payload.name)) throw new AppError(400, "MISSING_NAME");
  const parentid = normalizeOptionalInteger(payload.parentid, "parentid");
  if (parentid === undefined) throw new AppError(400, "MISSING_PARENTID");
  const normalizedPayload: Record<string, unknown> = {
    ...payload,
    parentid,
    ...(payload.id !== undefined ? { id: normalizeInteger(payload.id, "id") } : {}),
    ...(payload.order !== undefined ? { order: normalizeOptionalDepartmentOrder(payload.order) } : {})
  };
  if (typeof normalizedPayload.id === "number" && normalizedPayload.id <= 1) throw new AppError(400, "INVALID_ID");

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomCreateDepartmentResponse>(
    "POST",
    "/cgi-bin/department/create",
    { access_token: accessToken },
    normalizedPayload
  );

  if (data.errcode !== 0 || !data.id) throw new AppError(502, data.errmsg || "WECOM_CREATE_DEPARTMENT_FAILED");
  await upsertWecomDepartment(clientId, {
    id: data.id,
    parentid,
    name: normalizedPayload.name,
    name_en: normalizedPayload.name_en,
    order: normalizedPayload.order
  });

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "created",
    id: data.id
  };
};

export const updateWecomDepartment = async (clientId: string, department: unknown) => {
  const payload = ensurePlainObject(department, "INVALID_WECOM_DEPARTMENT");
  const id = normalizeOptionalInteger(payload.id, "id");
  if (id === undefined) throw new AppError(400, "MISSING_ID");
  const normalizedPayload: Record<string, unknown> = {
    ...payload,
    id,
    ...(payload.parentid !== undefined ? { parentid: normalizeInteger(payload.parentid, "parentid") } : {}),
    ...(payload.order !== undefined ? { order: normalizeOptionalDepartmentOrder(payload.order) } : {})
  };

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomBasicResponse>(
    "POST",
    "/cgi-bin/department/update",
    { access_token: accessToken },
    normalizedPayload
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_UPDATE_DEPARTMENT_FAILED");

  const existing = await prisma.wecomDepartment.findUnique({
    where: { clientId_departmentId: { clientId, departmentId: id } }
  });
  await upsertWecomDepartment(clientId, {
    id,
    parentid: normalizeOptionalInteger(normalizedPayload.parentid, "parentid") ?? existing?.parentId ?? 1,
    ...(payload.name !== undefined ? { name: normalizedPayload.name } : {}),
    ...(payload.name_en !== undefined ? { name_en: normalizedPayload.name_en } : {}),
    ...(payload.order !== undefined ? { order: normalizedPayload.order } : {})
  });

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "updated"
  };
};

export const deleteWecomDepartment = async (clientId: string, idValue: unknown) => {
  const id = normalizeInteger(idValue, "id");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomBasicResponse>("GET", "/cgi-bin/department/delete", {
    access_token: accessToken,
    id
  });

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_DELETE_DEPARTMENT_FAILED");
  await prisma.wecomDepartment.deleteMany({ where: { clientId, departmentId: id } });

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "deleted"
  };
};

export const listWecomDepartmentIds = async (clientId: string, idValue?: unknown) => {
  const id = normalizeOptionalInteger(idValue, "id");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomDepartmentSimpleListResponse>("GET", "/cgi-bin/department/simplelist", {
    access_token: accessToken,
    ...(id !== undefined ? { id } : {})
  });

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_LIST_DEPARTMENTS_FAILED");
  const departments = (data.department_id ?? [])
    .map((item) => ({
      id: normalizeOptionalNumber(item.id),
      parentid: normalizeOptionalNumber(item.parentid),
      order: normalizeOptionalNumber(item.order)
    }))
    .filter((item): item is { id: number; parentid: number; order: number | null } =>
      Number.isInteger(item.id) && Number.isInteger(item.parentid)
    );

  await prisma.$transaction(
    departments.map((department) =>
      prisma.wecomDepartment.upsert({
        where: { clientId_departmentId: { clientId, departmentId: department.id } },
        create: {
          clientId,
          departmentId: department.id,
          parentId: department.parentid,
          order: department.order === null ? null : BigInt(department.order)
        },
        update: {
          parentId: department.parentid,
          order: department.order === null ? null : BigInt(department.order)
        }
      })
    )
  );

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    departmentId: departments.map((department) => ({
      id: department.id,
      parentid: department.parentid,
      order: department.order
    })),
    department_id: departments.map((department) => ({
      id: department.id,
      parentid: department.parentid,
      order: department.order
    }))
  };
};

export const listWecomUserDepartmentIds = async (clientId: string, options: unknown = {}) => {
  const payload = ensurePlainObject(options, "INVALID_WECOM_USER_DEPARTMENT_LIST");
  const cursor = normalizeOptionalString(payload.cursor);
  const limit = normalizeOptionalInteger(payload.limit, "limit") ?? 10000;
  if (limit < 1 || limit > 10000) throw new AppError(400, "INVALID_LIMIT");

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomUserDepartmentListResponse>(
    "POST",
    "/cgi-bin/user/list_id",
    { access_token: accessToken },
    {
      ...(cursor ? { cursor } : {}),
      limit
    }
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_LIST_USER_DEPARTMENTS_FAILED");
  const rows = (data.dept_user ?? [])
    .map((item) => ({
      userid: normalizeOptionalString(item.userid),
      department: normalizeOptionalNumber(item.department)
    }))
    .filter((item): item is { userid: string; department: number } =>
      Boolean(item.userid) && Number.isInteger(item.department)
    );
  await syncUserDepartmentRows(clientId, rows, { replaceAll: false });

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    nextCursor: normalizeOptionalString(data.next_cursor) ?? "",
    next_cursor: normalizeOptionalString(data.next_cursor) ?? "",
    deptUser: rows,
    dept_user: rows
  };
};

export const syncWecomUserDepartmentIds = async (clientId: string, options: unknown = {}) => {
  const payload = ensurePlainObject(options, "INVALID_WECOM_USER_DEPARTMENT_SYNC");
  const limit = normalizeOptionalInteger(payload.limit, "limit") ?? 10000;
  if (limit < 1 || limit > 10000) throw new AppError(400, "INVALID_LIMIT");
  if (normalizeOptionalString(payload.cursor)) {
    throw new AppError(400, "CURSOR_NOT_ALLOWED_FOR_FULL_SYNC");
  }

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const rows: Array<{ userid: string; department: number }> = [];
  let cursor = "";
  let nextCursor = "";

  do {
    const data = await fetchWecomJson<WecomUserDepartmentListResponse>(
      "POST",
      "/cgi-bin/user/list_id",
      { access_token: accessToken },
      {
        ...(cursor ? { cursor } : {}),
        limit
      }
    );
    if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_SYNC_USER_DEPARTMENTS_FAILED");
    rows.push(
      ...(data.dept_user ?? [])
        .map((item) => ({
          userid: normalizeOptionalString(item.userid),
          department: normalizeOptionalNumber(item.department)
        }))
        .filter((item): item is { userid: string; department: number } =>
          Boolean(item.userid) && Number.isInteger(item.department)
        )
    );
    nextCursor = normalizeOptionalString(data.next_cursor) ?? "";
    cursor = nextCursor;
  } while (cursor);

  await syncUserDepartmentRows(clientId, rows, { replaceAll: true });

  return {
    errcode: 0,
    errmsg: "ok",
    synced: rows.length,
    nextCursor,
    next_cursor: nextCursor
  };
};

export const inviteWecomContacts = async (clientId: string, invite: unknown) => {
  const payload = ensurePlainObject(invite, "INVALID_WECOM_INVITE");
  const normalizedPayload: Record<string, unknown> = {};

  if (payload.user !== undefined) normalizedPayload.user = normalizeStringList(payload.user, "user", 1000);
  if (payload.party !== undefined) normalizedPayload.party = normalizeNumberList(payload.party, "party", 100);
  if (payload.tag !== undefined) normalizedPayload.tag = normalizeNumberList(payload.tag, "tag", 100);
  if (!normalizedPayload.user && !normalizedPayload.party && !normalizedPayload.tag) {
    throw new AppError(400, "EMPTY_WECOM_INVITE_TARGETS");
  }

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomInviteResponse>(
    "POST",
    "/cgi-bin/batch/invite",
    { access_token: accessToken },
    normalizedPayload
  );

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_INVITE_FAILED");
  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    invalidUser: data.invaliduser ?? [],
    invalidParty: data.invalidparty ?? [],
    invalidTag: data.invalidtag ?? [],
    invaliduser: data.invaliduser ?? [],
    invalidparty: data.invalidparty ?? [],
    invalidtag: data.invalidtag ?? []
  };
};

export const getWecomJoinQrcode = async (clientId: string, sizeType: unknown = 3) => {
  const parsedSizeType = Number(sizeType ?? 3);
  if (!Number.isInteger(parsedSizeType) || parsedSizeType < 1 || parsedSizeType > 4) {
    throw new AppError(400, "INVALID_SIZE_TYPE");
  }

  const client = getWecomAuthClient(clientId);
  const accessToken = await getContactAccessToken(client);
  const data = await fetchWecomJson<WecomJoinQrcodeResponse>("GET", "/cgi-bin/corp/get_join_qrcode", {
    access_token: accessToken,
    size_type: parsedSizeType
  });

  if (data.errcode !== 0 || !data.join_qrcode) throw new AppError(502, data.errmsg || "WECOM_JOIN_QRCODE_FAILED");
  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    joinQrcode: data.join_qrcode,
    join_qrcode: data.join_qrcode,
    expiresInDays: 7,
    sizeType: parsedSizeType
  };
};

export const clearWecomAuthCache = () => {
  accessTokenCache.clear();
};
