import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

const schemaPath = existsSync("prisma") ? "prisma" : "dist/prisma";

export default defineConfig({
  schema: schemaPath,
  migrations: {
    path: `${schemaPath}/migrations`,
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
