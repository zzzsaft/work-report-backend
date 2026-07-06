import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getWecomAuthClient } from "./clients.js";
import { departmentDbPayload, syncUserDepartmentRows, upsertWecomDepartment } from "./department-store.js";
import { fetchWecomJson, getAccessToken, getContactAccessToken } from "./http.js";
import {
  ensurePlainObject,
  normalizeDepartmentLeader,
  normalizeInteger,
  normalizeOptionalDepartmentOrder,
  normalizeOptionalInteger,
  normalizeOptionalNumber,
  normalizeOptionalString
} from "./normalizers.js";
import type {
  WecomBasicResponse,
  WecomCreateDepartmentResponse,
  WecomDepartmentDetail,
  WecomDepartmentDetailResponse,
  WecomDepartmentListResponse,
  WecomDepartmentSimpleListResponse,
  WecomUserDepartmentListResponse
} from "./types.js";

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

export const getWecomDepartment = async (clientId: string, idValue: unknown) => {
  const id = normalizeInteger(idValue, "id");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getAccessToken(client);
  const data = await fetchWecomJson<WecomDepartmentDetailResponse>("GET", "/cgi-bin/department/get", {
    access_token: accessToken,
    id
  });

  if (data.errcode !== 0 || !data.department) throw new AppError(502, data.errmsg || "WECOM_GET_DEPARTMENT_FAILED");
  const departmentId = normalizeOptionalNumber(data.department.id);
  const parentId = normalizeOptionalNumber(data.department.parentid);
  if (departmentId === null || parentId === null || !Number.isInteger(departmentId) || !Number.isInteger(parentId)) {
    throw new AppError(502, "WECOM_GET_DEPARTMENT_INVALID_RESPONSE");
  }
  const department = {
    id: departmentId,
    parentid: parentId,
    name: data.department.name,
    name_en: data.department.name_en,
    department_leader: data.department.department_leader,
    order: normalizeOptionalNumber(data.department.order)
  };

  await upsertWecomDepartment(clientId, {
    id: department.id,
    parentid: department.parentid,
    name: department.name,
    name_en: department.name_en,
    department_leader: department.department_leader,
    order: department.order
  });

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    department: {
      id: department.id,
      parentid: department.parentid,
      name: department.name,
      name_en: department.name_en,
      department_leader: normalizeDepartmentLeader(department.department_leader) ?? [],
      order: department.order
    }
  };
};

export const normalizeWecomDepartmentDetail = (department: WecomDepartmentDetail) => {
  const departmentId = normalizeOptionalNumber(department.id);
  const parentId = normalizeOptionalNumber(department.parentid);
  if (departmentId === null || parentId === null || !Number.isInteger(departmentId) || !Number.isInteger(parentId)) {
    return null;
  }

  return {
    id: departmentId,
    parentid: parentId,
    name: department.name,
    name_en: department.name_en,
    department_leader: department.department_leader,
    order: normalizeOptionalNumber(department.order)
  };
};

export const listWecomDepartments = async (clientId: string, idValue?: unknown) => {
  const id = normalizeOptionalInteger(idValue, "id");
  const client = getWecomAuthClient(clientId);
  const accessToken = await getAccessToken(client);
  const data = await fetchWecomJson<WecomDepartmentListResponse>("GET", "/cgi-bin/department/list", {
    access_token: accessToken,
    ...(id !== undefined ? { id } : {})
  });

  if (data.errcode !== 0) throw new AppError(502, data.errmsg || "WECOM_LIST_DEPARTMENT_DETAILS_FAILED");
  const departments = (data.department ?? [])
    .map(normalizeWecomDepartmentDetail)
    .filter((department): department is NonNullable<ReturnType<typeof normalizeWecomDepartmentDetail>> =>
      Boolean(department)
    );

  await prisma.$transaction(
    departments.map((department) =>
      prisma.wecomDepartment.upsert({
        where: { clientId_departmentId: { clientId, departmentId: department.id } },
        create: departmentDbPayload(clientId, department),
        update: {
          parentId: department.parentid,
          name: normalizeOptionalString(department.name),
          nameEn: normalizeOptionalString(department.name_en),
          departmentLeader: normalizeDepartmentLeader(department.department_leader) ?? Prisma.JsonNull,
          order: department.order === null ? null : BigInt(department.order)
        }
      })
    )
  );

  return {
    errcode: data.errcode,
    errmsg: data.errmsg ?? "ok",
    department: departments.map((department) => ({
      id: department.id,
      parentid: department.parentid,
      name: department.name,
      name_en: department.name_en,
      department_leader: normalizeDepartmentLeader(department.department_leader) ?? [],
      order: department.order
    }))
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

  const result = {
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

  const departmentDetails = await Promise.all(
    departments.map((department) => getWecomDepartment(clientId, department.id))
  );

  return {
    ...result,
    departments: departmentDetails.map((item) => item.department)
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
