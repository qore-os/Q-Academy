import { defineConfig } from "drizzle-kit";
import { loadProjectEnvironment } from "./scripts/load-environment";
import { databaseUrlForEnvironment } from "./src/lib/server-environment-validation";

loadProjectEnvironment();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrlForEnvironment(process.env),
  },
  strict: true,
  verbose: true,
});
