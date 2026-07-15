import {
  OPENAI_TRANSCRIPTION_MODEL,
  parseOpenAiTranscriptionArguments,
  readOpenAiApiKeyFile,
  redactedTranscriptionFailure,
  runOpenAiTranscriptionPreflight,
  transcribeMediaToWebVtt,
} from "./openai-whisper-transcribe-core";

async function main() {
  const configuration = parseOpenAiTranscriptionArguments(process.argv.slice(2));
  const apiKey = await readOpenAiApiKeyFile(configuration.apiKeyFile);
  if (configuration.mode === "preflight") {
    await runOpenAiTranscriptionPreflight({
      apiKey,
      temperature: configuration.temperature,
    });
    console.log(JSON.stringify({
      ok: true,
      provider: "openai",
      model: OPENAI_TRANSCRIPTION_MODEL,
      canary: "verified",
    }));
    return;
  }
  const result = await transcribeMediaToWebVtt({
    apiKey,
    inputPath: configuration.inputPath,
    outputVttPath: configuration.outputVttPath,
    providerLanguage: configuration.providerLanguage,
    temperature: configuration.temperature,
  });
  console.log(JSON.stringify({
    ok: true,
    provider: "openai",
    model: OPENAI_TRANSCRIPTION_MODEL,
    chunks: result.chunks,
    segments: result.segments,
  }));
}

void main().catch((error) => {
  console.error(JSON.stringify(redactedTranscriptionFailure(error)));
  process.exitCode = 1;
});
