import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const ALLOWED_NODE_ENVS = new Set(["test", "development"]);
const REQUIRED_CONFIRMATION = "work-report";

const maskDatabaseUrl = (value: string | undefined) => {
  if (!value) return "<not set>";

  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@/]+)(?::([^@/]*))?@/, "://***:***@");
  }
};

const assertCleanupAllowed = () => {
  const nodeEnv = process.env.NODE_ENV || "";
  const confirmation = process.env.CONFIRM_CLEANUP || "";

  console.log(`[Cleanup] NODE_ENV=${nodeEnv || "<not set>"}`);
  console.log(`[Cleanup] DATABASE_URL=${maskDatabaseUrl(process.env.DATABASE_URL)}`);

  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new Error("[Cleanup] Refusing to run unless NODE_ENV is test or development");
  }

  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`[Cleanup] Refusing to run unless CONFIRM_CLEANUP=${REQUIRED_CONFIRMATION}`);
  }
};

const main = async () => {
  assertCleanupAllowed();

  const prisma = new PrismaClient();

  console.log("[Cleanup] Deleting all operation-related test data...");

  try {
    await prisma.operationAssignment.deleteMany({});
    console.log("[Cleanup] Deleted OperationAssignment records");

    await prisma.operationPool.deleteMany({});
    console.log("[Cleanup] Deleted OperationPool records");

    await prisma.workOrderPart.deleteMany({});
    console.log("[Cleanup] Deleted WorkOrderPart records");

    await prisma.workOrder.deleteMany({});
    console.log("[Cleanup] Deleted WorkOrder records");

    console.log("[Cleanup] All operation-related test data has been cleaned up");
  } finally {
    await prisma.$disconnect();
  }
};

main()
  .catch((error) => {
    console.error("[Cleanup] Error:", error);
    process.exit(1);
  });
