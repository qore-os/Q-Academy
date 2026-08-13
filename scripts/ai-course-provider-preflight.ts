import { loadAiApiKey } from "../src/lib/ai/api-key-credential-core";
import { runAiProviderPreflight } from "../src/lib/ai/provider-preflight-core";
import { loadProjectEnvironment } from "./load-environment";

async function main() {
  loadProjectEnvironment();
  const apiKey = loadAiApiKey();
  if (!apiKey) {
    throw new Error("An AI provider credential is required for the preflight.");
  }
  console.log(JSON.stringify(await runAiProviderPreflight({ apiKey })));
}

await main().catch(() => {
  console.error(
    JSON.stringify({
      ok: false,
      code: "ai_course_provider_preflight_failed",
    }),
  );
  process.exitCode = 1;
});
