import { constants, createPrivateKey, createPublicKey, publicEncrypt } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { verifyLocalToken } from "../../lib/jwt.js";
import { extractAuthToken, resolveUser } from "../../middleware/auth.js";
import { exchangeWecomCode } from "../wecom/service.js";

interface XftSsoLoginUrlOptions {
  userid: string;
  todoId?: string | null;
  pageId?: string | null;
  timestamp?: number;
  privateKey?: string;
  connectorId?: string;
  flowId?: string;
  loginBaseUrl?: string;
}

const normalizePrivateKey = (privateKey: string) => {
  const trimmed = privateKey.trim().replace(/\\n/g, "\n");
  if (!trimmed) throw new AppError(500, "XFT_SSO_PRIVATE_KEY 未配置");
  if (trimmed.includes("BEGIN")) return trimmed;
  return `-----BEGIN RSA PRIVATE KEY-----\n${trimmed}\n-----END RSA PRIVATE KEY-----`;
};

const xftLoginEndpoint = (
  connectorId = config.xftSsoConnectorId,
  flowId = config.xftSsoFlowId,
  loginBaseUrl = config.xftSsoLoginBaseUrl
) => `${loginBaseUrl.replace(/\/+$/, "")}/${connectorId}_${flowId}`;

export const encryptXftSsoSecret = (
  userInfo: { userid: string; timestamp: number },
  privateKey = config.xftSsoPrivateKey
) => {
  const key = createPrivateKey(normalizePrivateKey(privateKey));
  const publicKey = createPublicKey(key);
  return publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_PADDING
    },
    Buffer.from(JSON.stringify(userInfo))
  ).toString("base64");
};

export const buildXftSsoLoginUrl = ({
  userid,
  todoId,
  pageId,
  timestamp = Date.now(),
  privateKey = config.xftSsoPrivateKey,
  connectorId = config.xftSsoConnectorId,
  flowId = config.xftSsoFlowId,
  loginBaseUrl = config.xftSsoLoginBaseUrl
}: XftSsoLoginUrlOptions) => {
  const normalizedUserId = userid.trim().slice(0, 20);
  if (!normalizedUserId) throw new AppError(400, "userid 缺失");

  const url = new URL(xftLoginEndpoint(connectorId, flowId, loginBaseUrl));
  url.searchParams.set("secret", encryptXftSsoSecret({ userid: normalizedUserId, timestamp }, privateKey));

  if (todoId) {
    url.searchParams.set("extTyp", "todo");
    url.searchParams.set("extPam", JSON.stringify({ toDoType: "0", toDoId: todoId }));
  } else {
    url.searchParams.set("pageId", pageId?.trim() || "workbench");
  }

  return url.toString();
};

const queryString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getXftSsoUseridFromToken = async (token: string) => {
  const localToken = verifyLocalToken(token);
  const localWecomId = localToken?.wecomUserId;
  if (localWecomId) return localWecomId.slice(0, 20);

  const user = await resolveUser(token);
  if (user.wecomUserId) return user.wecomUserId.slice(0, 20);
  throw new AppError(403, "token 中缺少 wecomUserId");
};

export const xftSsoLogin: RequestHandler = async (req, res) => {
  const token =
    extractAuthToken(req.headers.authorization, req.cookies) ||
    queryString(req.query.token) ||
    queryString(req.query.access_token);

  if (token) {
    res.redirect(
      buildXftSsoLoginUrl({
        userid: await getXftSsoUseridFromToken(token),
        todoId: queryString(req.query.todoid) || queryString(req.query.todoId) || null,
        pageId: queryString(req.query.pageId) || null
      })
    );
    return;
  }

  const code = queryString(req.query.code);
  if (!code) throw new AppError(400, "code 缺失");

  const clientId = queryString(req.query.clientId) || config.xftSsoWecomClientId;
  const result = await exchangeWecomCode(clientId, code);
  const userid = (result.user.wecomUserId || result.user.userId).slice(0, 20);

  res.redirect(
    buildXftSsoLoginUrl({
      userid,
      todoId: queryString(req.query.todoid) || queryString(req.query.todoId) || null,
      pageId: queryString(req.query.pageId) || null
    })
  );
};

export const testXftSsoLogin: RequestHandler = (_req, res) => {
  res.redirect(buildXftSsoLoginUrl({ userid: "ceshi" }));
};
