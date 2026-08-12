import { generateCourseDraft } from "../src/lib/ai/course-draft";
import { loadAiApiKey } from "../src/lib/ai/api-key-credential-core";
import { loadProjectEnvironment } from "./load-environment";

async function main() {
  loadProjectEnvironment();
  if (!loadAiApiKey()) {
    throw new Error("An AI provider credential is required for the preflight.");
  }
  const result = await generateCourseDraft(
    {
      topic: "Provider readiness validation",
      targetAudience: "Platform operators",
      learningGoal:
        "Operators can verify that structured course generation is available.",
      level: "beginner",
      tone: "concise",
      scope: "compact",
      categoryId: "",
    },
    "en",
  );
  if (result.provider !== "openai-compatible" || result.fallbackReason) {
    throw new Error("The AI course provider returned a local fallback.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      provider: result.provider,
      model: result.model,
      schema: "generated-course-draft-v1",
      modules: result.draft.modules.length,
    }),
  );
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
