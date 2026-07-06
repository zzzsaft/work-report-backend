import { AppError } from "../../lib/errors.js";

export const PERMISSION_GROUPS = ["worker", "leader", "admin"] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const roleNames: Record<PermissionGroup, string> = {
  worker: "员工",
  leader: "小组长",
  admin: "管理员"
};

export const getPermissionGroup = (roles: string[]): PermissionGroup => {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("leader")) return "leader";
  return "worker";
};

export const assertPermissionGroup = (permissionGroup: PermissionGroup) => {
  if (!PERMISSION_GROUPS.includes(permissionGroup)) {
    throw new AppError(400, "权限组无效");
  }
};
