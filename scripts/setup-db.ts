import { spawn } from "node:child_process";
import { loadProjectEnvironment } from "./load-environment";
import { assertDestructiveSeedAllowed } from "./seed-guard";

loadProjectEnvironment();
assertDestructiveSeedAllowed(process.env);

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

await run("npx", ["tsx", "scripts/migrate.ts"]);
await run("npx", ["tsx", "scripts/seed.ts"]);
