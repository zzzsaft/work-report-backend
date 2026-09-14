import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

const UNASSIGNED_TEAM_ID = "team-unassigned";
const UNASSIGNED_TEAM_NAME = "未分配班组";

export class TeamService {
  constructor(private readonly db: PrismaClient) {}

  list = async () => {
    const rawTeams = await this.db.team.findMany({
      orderBy: { name: "asc" },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            employeeNo: true,
            teamName: true
          }
        },
        operations: {
          select: {
            id: true,
            operationCode: true,
            operationName: true
          }
        }
      }
    });

    // 将真实DB中名为"未分配班组"的团队成员并入虚拟未分配行，同时过滤掉真实团队本身
    const teams = rawTeams.filter((t) => t.name !== UNASSIGNED_TEAM_NAME);
    const realUnassigned = rawTeams.find((t) => t.name === UNASSIGNED_TEAM_NAME);
    const realUnassignedUserIds = new Set(realUnassigned?.users?.map((u) => u.id) ?? []);

    const nullTeamUsers = await this.db.user.findMany({
      where: { teamId: null },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        teamName: true
      }
    });
    // 合并：真实"未分配班组"里的成员 + teamId 为 null 的成员，按 id 去重
    const mergedUsers = new Map<string, { id: string; name: string; employeeNo: string | null; teamName: string | null }>();
    if (realUnassigned) {
      for (const u of realUnassigned.users) mergedUsers.set(u.id, u);
    }
    for (const u of nullTeamUsers) {
      if (!mergedUsers.has(u.id)) mergedUsers.set(u.id, u);
    }
    // 防止重复统计：若 teamId=null 的用户已在 realUnassignedUserIds 中出现过，按 ID 去重保证一致
    const unassignedUsers = Array.from(mergedUsers.values());
    void realUnassignedUserIds;

    const unassignedTeam = {
      id: UNASSIGNED_TEAM_ID,
      name: UNASSIGNED_TEAM_NAME,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      users: unassignedUsers,
      operations: []
    };

    return [unassignedTeam, ...teams];
  };

  create = async (name: string, description?: string) => {
    const existing = await this.db.team.findUnique({ where: { name } });
    if (existing) {
      throw new AppError(400, `班组"${name}"已存在`);
    }
    if (name === UNASSIGNED_TEAM_NAME) {
      throw new AppError(400, "不能创建名为\"未分配班组\"的班组");
    }
    return this.db.team.create({
      data: { name, description }
    });
  };

  update = async (id: string, name: string, description?: string) => {
    if (id === UNASSIGNED_TEAM_ID) {
      throw new AppError(400, "默认班组不可编辑");
    }
    const team = await this.db.team.findUnique({ where: { id } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }
    const existing = await this.db.team.findUnique({ where: { name } });
    if (existing && existing.id !== id) {
      throw new AppError(400, `班组"${name}"已存在`);
    }
    return this.db.team.update({
      where: { id },
      data: { name, description }
    });
  };

  delete = async (id: string) => {
    if (id === UNASSIGNED_TEAM_ID) {
      throw new AppError(400, "默认班组不可删除");
    }
    const team = await this.db.team.findUnique({ where: { id } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }
    // Move users to unassigned before deleting
    await this.db.user.updateMany({
      where: { teamId: id },
      data: { teamId: null, teamName: null }
    });
    await this.db.team.delete({ where: { id } });
    return { count: 1 };
  };

  getMembers = async (teamId: string) => {
    if (teamId === UNASSIGNED_TEAM_ID) {
      const realUnassigned = await this.db.team.findFirst({
        where: { name: UNASSIGNED_TEAM_NAME },
        select: { id: true }
      });
      const baseWhere = { teamId: null } as {
        teamId?: string | null;
        OR?: Array<{ teamId: string | null }>;
      };
      if (realUnassigned) {
        delete baseWhere.teamId;
        baseWhere.OR = [{ teamId: null }, { teamId: realUnassigned.id }];
      }
      return this.db.user.findMany({
        where: baseWhere,
        select: {
          id: true,
          name: true,
          employeeNo: true,
          teamName: true,
          nameInitials: true
        },
        orderBy: { name: "asc" },
        distinct: ["id"]
      });
    }
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }
    return this.db.user.findMany({
      where: { teamId },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        teamName: true,
        nameInitials: true
      },
      orderBy: { name: "asc" }
    });
  };

  addMember = async (teamId: string, userId: string) => {
    if (teamId === UNASSIGNED_TEAM_ID) {
      throw new AppError(400, "不能添加成员到未分配班组");
    }
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AppError(404, "班组不存在");
    }
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "用户不存在");
    }
    return this.db.user.update({
      where: { id: userId },
      data: { teamId, teamName: team.name }
    });
  };

  removeMember = async (teamId: string, userId: string) => {
    if (teamId === UNASSIGNED_TEAM_ID) {
      throw new AppError(400, "未分配班组的成员已在未分配状态");
    }
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "用户不存在");
    }
    if (user.teamId !== teamId) {
      throw new AppError(400, "该用户不在此班组");
    }
    return this.db.user.update({
      where: { id: userId },
      data: { teamId: null, teamName: null }
    });
  };

  setMemberTeam = async (userId: string, teamId: string | null) => {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "用户不存在");
    }
    let teamName: string | null = null;
    if (teamId && teamId !== UNASSIGNED_TEAM_ID) {
      const team = await this.db.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new AppError(404, "班组不存在");
      }
      teamName = team.name;
    }
    return this.db.user.update({
      where: { id: userId },
      data: {
        teamId: teamId === UNASSIGNED_TEAM_ID ? null : teamId,
        teamName
      }
    });
  };

  // 批量分配人员到班组
  batchSetMemberTeams = async (userIds: string[], teamId: string | null) => {
    if (userIds.length === 0) {
      throw new AppError(400, "请选择要分配的人员");
    }
    let teamName: string | null = null;
    if (teamId && teamId !== UNASSIGNED_TEAM_ID) {
      const team = await this.db.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new AppError(404, "班组不存在");
      }
      teamName = team.name;
    }
    const realTeamId = teamId === UNASSIGNED_TEAM_ID ? null : teamId;
    const result = await this.db.user.updateMany({
      where: { id: { in: userIds } },
      data: { teamId: realTeamId, teamName }
    });
    return { count: result.count };
  };
}
