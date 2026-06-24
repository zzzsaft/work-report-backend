import { PrismaClient } from "@prisma/client";

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
  await prisma.role.upsert({
    where: { code: "admin" },
    create: { code: "admin", name: "管理员" },
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
    where: { workOrderId_partCode: { workOrderId: workOrder.id, partCode: "PART-CASE-001" } },
    create: {
      workOrderId: workOrder.id,
      partCode: "PART-CASE-001",
      partName: "壳体主件",
      plannedQuantity: 40,
      completedQuantity: 0
    },
    update: {}
  });

  await prisma.operationPool.upsert({
    where: {
      workOrderId_partId_operationCode: {
        workOrderId: workOrder.id,
        partId: part.id,
        operationCode: "OP-060"
      }
    },
    create: {
      workOrderId: workOrder.id,
      partId: part.id,
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
