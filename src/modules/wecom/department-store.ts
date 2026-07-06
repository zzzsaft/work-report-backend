import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { normalizeDepartmentLeader, normalizeOptionalDepartmentOrder, normalizeOptionalString } from "./normalizers.js";

export const departmentDbPayload = (
  clientId: string,
  department: {
    id: number;
    parentid: number;
    name?: unknown;
    name_en?: unknown;
    department_leader?: unknown;
    order?: unknown;
  }
) => ({
  clientId,
  departmentId: department.id,
  parentId: department.parentid,
  name: normalizeOptionalString(department.name),
  nameEn: normalizeOptionalString(department.name_en),
  departmentLeader: normalizeDepartmentLeader(department.department_leader) ?? Prisma.JsonNull,
  order:
    department.order === undefined || department.order === null
      ? null
      : BigInt(normalizeOptionalDepartmentOrder(department.order) ?? 0)
});

export const upsertWecomDepartment = async (
  clientId: string,
  department: {
    id: number;
    parentid: number;
    name?: unknown;
    name_en?: unknown;
    department_leader?: unknown;
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
      ...(department.department_leader !== undefined ? { departmentLeader: data.departmentLeader } : {}),
      ...(department.order !== undefined ? { order: data.order } : {})
    }
  });
};

export const syncUserDepartmentRows = async (
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
