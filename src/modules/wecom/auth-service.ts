import { generateLocalToken } from "../../lib/jwt.js";
import { AppError } from "../../lib/errors.js";
import { getWecomAuthClient } from "./clients.js";
import { fetchWecomJson, getAccessToken } from "./http.js";
import { hasOwn, normalizeDisplayName, normalizeOptionalNumber, normalizeOptionalString } from "./normalizers.js";
import type { WecomAuthClient, WecomContactUserResponse, WecomUserDetailResponse, WecomUserInfoResponse } from "./types.js";

export const getUserInfoByCode = async (client: WecomAuthClient, accessToken: string, code: string) => {
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

export const getUserDetail = async (accessToken: string, userTicket: string) => {
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

export const getContactUser = async (accessToken: string, userId: string) => {
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
