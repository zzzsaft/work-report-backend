import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const listPrismaFiles = (dir) => {
  const files = [];

  const walk = (currentDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".prisma")) {
        files.push(fullPath);
      }
    }
  };

  walk(dir);
  return files;
};

const hasModelFiles = (dir) => {
  if (!existsSync(resolve(dir, "schema.prisma"))) return false;

  return listPrismaFiles(dir).some((file) => {
    if (file === resolve(dir, "schema.prisma")) return false;
    return true;
  });
};

const candidates = [resolve(rootDir, "prisma"), resolve(rootDir, "dist", "prisma")];
const schemaDir = candidates.find(hasModelFiles);

if (!schemaDir) {
  throw new Error(
    `Could not find a Prisma schema directory with split model files. Checked: ${candidates.join(", ")}`
  );
}

const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
const result = spawnSync(prismaBin, ["generate", "--schema", schemaDir], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
