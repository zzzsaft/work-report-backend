import { AppError } from "../../lib/errors.js";
import { getWecomAuthClient } from "./clients.js";
import { fetchWecomJson, getContactAccessToken } from "./http.js";
import { ensurePlainObject, normalizeNumberList, normalizeOptionalString, normalizeStringList } from "./normalizers.js";
import type { WecomBasicResponse, WecomCreateUserResponse, WecomInviteResponse, WecomJoinQrcodeResponse } from "./types.js";

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
