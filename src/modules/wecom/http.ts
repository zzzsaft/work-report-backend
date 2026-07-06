import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { decryptJson, encryptJson, isWechatProxyEncryptedBody } from "./crypto.js";
import type { WecomAuthClient, WecomTokenResponse } from "./types.js";

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new AppError(502, "WECOM_UNAVAILABLE");
  return (await response.json()) as T;
};

export const wecomUrl = (pathname: string) => new URL(pathname, config.wecomApiBaseUrl);

export const fetchWechatProxyJson = async <T>(
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

export const fetchWecomJson = async <T>(
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

export const getAccessToken = async (client: WecomAuthClient) => {
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

export const getContactAccessToken = async (client: WecomAuthClient) => {
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

export const clearWecomTokenCache = () => {
  accessTokenCache.clear();
};
