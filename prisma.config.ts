import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

const schemaDir = existsSync("prisma/schema.prisma") ? "prisma" : "dist/prisma";
const schemaPath = `${schemaDir}/schema.prisma`;

export default defineConfig({
  schema: schemaPath,
  migrations: {
    path: `${schemaDir}/migrations`,
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
