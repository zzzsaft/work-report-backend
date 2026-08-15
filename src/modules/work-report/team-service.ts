import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

const UNASSIGNED_TEAM_ID = "team-unassigned";
const UNASSIGNED_TEAM_NAME = "未分配班组";

export class TeamService {
  constructor(private readonly db: PrismaClient) {}

  list = async () => {
    const teams = await this.db.team.findMany({
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

    // Add virtual unassigned team
    const unassignedUsers = await this.db.user.findMany({
      where: { teamId: null },
      select: {
        id: true,
        name: true,
        employeeNo: true,
        teamName: true
      }
    });

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
      return this.db.user.findMany({
        where: { teamId: null },
        select: {
          id: true,
          name: true,
          employeeNo: true,
          teamName: true,
          nameInitials: true
        },
        orderBy: { name: "asc" }
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
}
