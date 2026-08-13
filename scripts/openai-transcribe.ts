import {
  parseOpenAiTranscriptionArguments,
  readOpenAiApiKeyFile,
  redactedTranscriptionFailure,
  runOpenAiTranscriptionPreflight,
  transcribeMediaToWebVtt,
} from "./openai-transcribe-core";
import {
  OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
  OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
  OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
} from "../src/lib/media/transcription-contract";

async function main() {
  const configuration = parseOpenAiTranscriptionArguments(
    process.argv.slice(2),
  );
  const apiKey = await readOpenAiApiKeyFile(configuration.apiKeyFile);
  if (configuration.mode === "preflight") {
    await runOpenAiTranscriptionPreflight({
      apiKey,
    });
    console.log(
      JSON.stringify({
        ok: true,
        provider: "openai",
        model: OPENAI_TRANSCRIPTION_MODEL,
        responseFormat: OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
        chunkingStrategy: OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
        requestContract: OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
        canary: "verified",
      }),
    );
    return;
  }
  const result = await transcribeMediaToWebVtt({
    apiKey,
    inputPath: configuration.inputPath,
    outputVttPath: configuration.outputVttPath,
    providerLanguage: configuration.providerLanguage,
  });
  console.log(
    JSON.stringify({
      ok: true,
      provider: "openai",
      model: OPENAI_TRANSCRIPTION_MODEL,
      responseFormat: OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
      chunkingStrategy: OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
      requestContract: OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
      chunks: result.chunks,
      segments: result.segments,
    }),
  );
}

void main().catch((error) => {
  console.error(JSON.stringify(redactedTranscriptionFailure(error)));
  process.exitCode = 1;
});
