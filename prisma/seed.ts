import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const main = async () => {
  const workerRole = await prisma.role.upsert({
    where: { code: "worker" },
    create: { code: "worker", name: "员工" },
    update: {}
  });
  await prisma.role.upsert({
    where: { code: "leader" },
    create: { code: "leader", name: "小组长" },
    update: {}
  });
  const adminRole = await prisma.role.upsert({
    where: { code: "admin" },
    create: { code: "admin", name: "管理员" },
    update: {}
  });

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    create: {
      username: "admin",
      passwordHash: await bcrypt.hash("admin1", 10),
      name: "管理员",
      status: "active"
    },
    update: {
      name: "管理员",
      status: "active",
      passwordHash: await bcrypt.hash("admin1", 10)
    }
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    create: { userId: admin.id, roleId: adminRole.id },
    update: {}
  });

  const worker = await prisma.user.upsert({
    where: { id: "demo-worker" },
    create: {
      id: "demo-worker",
      employeeNo: "EMP-20240018",
      name: "张师傅",
      nameInitials: "zsf",
      teamName: "生产一组"
    },
    update: {}
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: worker.id, roleId: workerRole.id } },
    create: { userId: worker.id, roleId: workerRole.id },
    update: {}
  });

  const workOrder = await prisma.workOrder.upsert({
    where: { orderNo: "WO-20260623-018" },
    create: {
      orderNo: "WO-20260623-018",
      productCode: "CP-JSJ-240623-07",
      productName: "减速机外壳",
      plannedQuantity: 120,
      completedQuantity: 74,
      dueDate: new Date("2026-06-25T00:00:00+08:00"),
      status: "in_progress"
    },
    update: {}
  });

  const part = await prisma.workOrderPart.upsert({
    where: { workOrderId_partNo: { workOrderId: workOrder.id, partNo: "0" } },
    create: {
      workOrderId: workOrder.id,
      partNo: "0",
      partCode: "PART-CASE-001",
      partName: "壳体主件",
      plannedQuantity: 40,
      completedQuantity: 0
    },
    update: {}
  });

  await prisma.operationPool.upsert({
    where: {
      workOrderId_partId_operationNo: {
        workOrderId: workOrder.id,
        partId: part.id,
        operationNo: "60"
      }
    },
    create: {
      workOrderId: workOrder.id,
      partId: part.id,
      operationNo: "60",
      operationCode: "OP-060",
      operationName: "终检前倒角",
      operationNote: "重点检查窗口边、孔口倒角，完成后流转终检。",
      plannedQuantity: 40,
      plannedStart: new Date("2026-06-24T10:00:00+08:00"),
      remainingQuantity: 40,
      estimatedHours: 2.5,
      claimedWorkers: 0,
      maxClaimWorkers: 2,
      status: "available",
      source: "system"
    },
    update: {}
  });
};

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
