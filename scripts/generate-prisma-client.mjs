import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const candidates = [
  resolve(rootDir, "prisma", "schema.prisma"),
  resolve(rootDir, "dist", "prisma", "schema.prisma")
];
const schemaPath = candidates.find((candidate) => existsSync(candidate));

if (!schemaPath) {
  throw new Error(
    `Could not find a Prisma schema file. Checked: ${candidates.join(", ")}`
  );
}

const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
const result = spawnSync(prismaBin, ["generate", "--schema", schemaPath], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
