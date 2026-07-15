import { loadProjectEnvironment } from "./load-environment";
import { assertDestructiveSeedAllowed } from "./seed-guard";

loadProjectEnvironment();
assertDestructiveSeedAllowed(process.env);

await import("./migrate");
await import("./seed");
