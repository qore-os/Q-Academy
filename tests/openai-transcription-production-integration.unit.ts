import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function composeServiceBlock(compose: string, serviceName: string) {
  const escapedName = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^  ${escapedName}:[^\\r\\n]*$`, "m").exec(compose);
  assert.ok(start?.index !== undefined, `Missing ${serviceName} service.`);
  const remaining = compose.slice(start.index + start[0].length);
  const nextServiceOffset = remaining.search(
    /\r?\n  [a-z0-9][a-z0-9-]*:[^\r\n]*\r?\n/m,
  );
  return compose.slice(
    start.index,
    nextServiceOffset === -1
      ? compose.length
      : start.index + start[0].length + nextServiceOffset,
  );
}

function dockerTargetBlock(dockerfile: string, target: string) {
  const start = new RegExp(`^FROM [^\\r\\n]+ AS ${target}$`, "m").exec(
    dockerfile,
  );
  assert.ok(start?.index !== undefined, `Missing ${target} Docker target.`);
  const remaining = dockerfile.slice(start.index + start[0].length);
  const nextTargetOffset = remaining.search(/\r?\nFROM [^\r\n]+ AS [^\r\n]+/m);
  return dockerfile.slice(
    start.index,
    nextTargetOffset === -1
      ? dockerfile.length
      : start.index + start[0].length + nextTargetOffset,
  );
}

const compose = source("compose.production.yml");
const dockerfile = source("Dockerfile");
const productionEnvironment = source("deploy/.env.production.example");
const continuousIntegration = source(".github/workflows/ci.yml");
const transcriptionContract = source("src/lib/media/transcription-contract.ts");
const metricsRoute = source("src/app/api/internal/metrics/route.ts");

const transcriptExecutable = "/app/node_modules/.bin/tsx";
const transcriptScript = "/app/scripts/openai-transcribe.ts";
const credentialTarget = "/run/secrets/q-academy-openai-transcription-api-key";
const credentialSource =
  "${OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE:-/etc/q-academy/openai-transcription-api-key}";
const runtimeArguments = JSON.stringify([
  transcriptScript,
  "--input",
  "{input}",
  "--output-vtt",
  "{output}",
  "--language",
  "{language}",
]);
const preflightArguments = JSON.stringify([transcriptScript, "--preflight"]);

test("production uses one exact OpenAI transcription executable contract", () => {
  assert.match(
    transcriptionContract,
    /OPENAI_TRANSCRIPTION_MODEL\s*=\s*\r?\n?\s*"gpt-4o-transcribe-diarize"/,
  );
  assert.match(
    transcriptionContract,
    /OPENAI_TRANSCRIPTION_RESPONSE_FORMAT = "diarized_json"/,
  );
  assert.match(
    transcriptionContract,
    /OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY = "auto"/,
  );
  for (const serviceName of ["media-runner", "media-preflight"]) {
    const service = composeServiceBlock(compose, serviceName);
    assert.ok(
      service.includes(
        "MEDIA_TRANSCRIPTION_ENABLED: ${MEDIA_TRANSCRIPTION_ENABLED:-false}",
      ),
    );
    assert.ok(
      service.includes(`MEDIA_TRANSCRIPT_COMMAND: ${transcriptExecutable}`),
    );
    assert.ok(
      service.includes(
        `MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON: '${runtimeArguments}'`,
      ),
    );
    assert.ok(
      service.includes(
        `MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON: '${preflightArguments}'`,
      ),
    );
    assert.doesNotMatch(
      service,
      /MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON:.*--help/,
    );
  }
});

test("the dedicated credential is a read-only bind mounted into only two services", () => {
  assert.equal(compose.split(`source: ${credentialSource}`).length - 1, 2);
  assert.equal(compose.split(`target: ${credentialTarget}`).length - 1, 2);

  for (const serviceName of ["media-runner", "media-preflight"]) {
    const service = composeServiceBlock(compose, serviceName).replaceAll(
      "\r\n",
      "\n",
    );
    const expectedMount = [
      "      - type: bind",
      `        source: ${credentialSource}`,
      `        target: ${credentialTarget}`,
      "        read_only: true",
      "        bind:",
      "          create_host_path: false",
    ].join("\n");
    assert.ok(service.includes(expectedMount));
  }

  for (const serviceName of [
    "app",
    "scheduler",
    "media-worker",
    "media-maintenance",
  ]) {
    const service = composeServiceBlock(compose, serviceName);
    assert.doesNotMatch(service, /OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE/);
    assert.doesNotMatch(service, /q-academy-openai-transcription-api-key/);
  }

  assert.doesNotMatch(
    compose,
    /^\s+(?:OPENAI_API_KEY|OPENAI_TRANSCRIPTION_API_KEY):/m,
  );
  assert.doesNotMatch(
    dockerfile,
    /^(?:ARG|ENV) (?:OPENAI_API_KEY|OPENAI_TRANSCRIPTION_API_KEY)/m,
  );
  assert.match(
    productionEnvironment,
    /^OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE=\/etc\/q-academy\/openai-transcription-api-key$/m,
  );
  assert.match(productionEnvironment, /^MEDIA_TRANSCRIPTION_ENABLED=false$/m);
  assert.doesNotMatch(
    productionEnvironment,
    /^(?:OPENAI_API_KEY|OPENAI_TRANSCRIPTION_API_KEY)=/m,
  );
  assert.doesNotMatch(productionEnvironment, /^MEDIA_TRANSCRIPT_COMMAND/m);
});

test("OpenAI transcription sources are packaged only in the media images", () => {
  const sourceNames = [
    "scripts/openai-transcribe-core.ts",
    "scripts/openai-transcribe.ts",
  ];
  for (const target of ["media-runner", "media-preflight"]) {
    const block = dockerTargetBlock(dockerfile, target);
    for (const sourceName of sourceNames) assert.ok(block.includes(sourceName));
  }
  for (const target of ["runner", "dispatcher"]) {
    const block = dockerTargetBlock(dockerfile, target);
    for (const sourceName of sourceNames) {
      assert.equal(
        block.includes(sourceName),
        false,
        `${target} packages ${sourceName}`,
      );
    }
  }

  assert.match(
    continuousIntegration,
    /for component in media-runner media-preflight; do[\s\S]*test -x \/app\/node_modules\/\.bin\/tsx[\s\S]*test -r \/app\/scripts\/openai-transcribe-core\.ts[\s\S]*test -r \/app\/scripts\/openai-transcribe\.ts/,
  );
  assert.match(
    continuousIntegration,
    /for component in app dispatcher; do[\s\S]*test ! -e \/app\/scripts\/openai-transcribe-core\.ts && test ! -e \/app\/scripts\/openai-transcribe\.ts/,
  );
});

test("metrics expose the active transcript contract without mislabeling custom providers", () => {
  const appService = composeServiceBlock(compose, "app");
  assert.ok(
    appService.includes(
      "MEDIA_TRANSCRIPTION_ENABLED: ${MEDIA_TRANSCRIPTION_ENABLED:-false}",
    ),
  );
  assert.ok(
    appService.includes(`MEDIA_TRANSCRIPT_COMMAND: ${transcriptExecutable}`),
  );
  assert.ok(
    appService.includes(
      `MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON: '${runtimeArguments}'`,
    ),
  );
  assert.match(
    metricsRoute,
    /name: "q_academy_media_transcription_contract_info"/,
  );
  assert.match(
    metricsRoute,
    /const transcriptProvider = configuredTranscriptionProviderId\(process\.env\)/,
  );
  assert.match(
    metricsRoute,
    /model: bundledOpenAi \? OPENAI_TRANSCRIPTION_MODEL : "none"/,
  );
  assert.match(
    metricsRoute,
    /response_format: bundledOpenAi[\s\S]*OPENAI_TRANSCRIPTION_RESPONSE_FORMAT[\s\S]*: "none"/,
  );
});
