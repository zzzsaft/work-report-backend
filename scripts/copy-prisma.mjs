import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(rootDir, "prisma");
const targetDir = resolve(rootDir, "dist", "prisma");

if (!existsSync(sourceDir)) {
  throw new Error(`Prisma schema directory not found: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });
