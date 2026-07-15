import * as nextEnvironmentModule from "@next/env";

type NextEnvironmentModule = typeof import("@next/env");

export function loadProjectEnvironment() {
  const environmentModule = nextEnvironmentModule as NextEnvironmentModule & {
    default?: NextEnvironmentModule;
  };
  const loadEnvConfig =
    environmentModule.loadEnvConfig ??
    environmentModule.default?.loadEnvConfig;
  if (!loadEnvConfig) {
    throw new Error("Could not load the Next.js environment configuration.");
  }
  loadEnvConfig(process.cwd());
}
