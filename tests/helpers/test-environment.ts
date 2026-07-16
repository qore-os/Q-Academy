import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function testEnvironmentValue(name: string) {
  const processValue = process.env[name]?.trim();
  if (processValue) return processValue;

  let source: string;
  try {
    source = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const line = source
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

export function requiredTestEnvironmentValue(name: string) {
  const value = testEnvironmentValue(name);
  if (!value) throw new Error(`${name} is required by this test.`);
  return value;
}
