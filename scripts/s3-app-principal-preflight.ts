import { createAwsS3AppPrincipalContractAdapter } from "../src/lib/media/s3-app-principal-contract-aws";
import {
  runS3AppPrincipalContractPreflight,
  S3AppPrincipalContractError,
} from "../src/lib/media/s3-app-principal-contract";
import {
  MediaStorageConfigurationError,
  resolveMediaStorageConfiguration,
  type S3MediaStorageConfiguration,
} from "../src/lib/media/storage-configuration";

const HELP = `Q-Academy S3-App-Principal-Preflight

Erforderlich:
  --confirm-bucket <bucket>   Muss exakt MEDIA_S3_BUCKET entsprechen

Optional:
  --json                      Maschinenlesbare, geheimnisfreie Ausgabe
  --help                      Diese Hilfe anzeigen

Der Test verwendet zufaellige Canary-Keys unter incoming/tenants/... und
tenants/... . Der Worker-Principal legt Testobjekte an und entfernt danach
alle exakten Canary-Versionen. Er liest ausserdem den verpflichtenden
acht-taegigen Privacy-Export-Lifecycle; der App-Principal wird nur fuer seinen
produktiven Positiv- und Negativvertrag verwendet.`;

type Arguments = Readonly<{
  confirmBucket: string;
  json: boolean;
  help: boolean;
}>;

function parseArguments(argv: readonly string[]): Arguments {
  let confirmBucket = "";
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--help") {
      if (argument === "--json") json = true;
      else help = true;
      continue;
    }
    if (argument !== "--confirm-bucket" || confirmBucket) {
      throw new Error("Die CLI-Optionen sind ungueltig.");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--confirm-bucket benoetigt einen Wert.");
    }
    confirmBucket = value.trim();
    index += 1;
  }
  if (!help && !confirmBucket) {
    throw new Error("--confirm-bucket ist erforderlich.");
  }
  return { confirmBucket, json, help };
}

function configuration(input: {
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
}): S3MediaStorageConfiguration {
  const result = resolveMediaStorageConfiguration({
    ...process.env,
    NODE_ENV: "production",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_S3_ACCESS_KEY_ID: input.accessKeyId,
    MEDIA_S3_SECRET_ACCESS_KEY: input.secretAccessKey,
    MEDIA_CLAMAV_HOST: "127.0.0.1",
    MEDIA_CLAMAV_PORT: "3310",
  });
  if (result.driver !== "s3") {
    throw new Error("The media storage driver is not S3.");
  }
  return result;
}

function printFailure(error: unknown, json: boolean) {
  const contractError =
    error instanceof S3AppPrincipalContractError ? error : null;
  const code =
    contractError?.code ??
    (error instanceof MediaStorageConfigurationError
      ? "invalid_configuration"
      : "preflight_failed");
  const operation = contractError?.operation ?? null;
  const canaryId = contractError?.canaryId ?? null;
  if (json) {
    console.error(JSON.stringify({ ok: false, code, operation, canaryId }));
  } else {
    console.error(
      `S3 app-principal contract failed: code=${code}` +
        `${operation ? ` operation=${operation}` : ""}` +
        `${canaryId ? ` canaryId=${canaryId}` : ""}`,
    );
  }
}

async function main() {
  let parsed: Arguments;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    printFailure(error, process.argv.includes("--json"));
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    console.log(HELP);
    return;
  }

  try {
    const workerConfiguration = configuration({
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
    });
    const appConfiguration = configuration({
      accessKeyId: process.env.MEDIA_S3_APP_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_S3_APP_SECRET_ACCESS_KEY,
    });
    const adapter = createAwsS3AppPrincipalContractAdapter({
      workerConfiguration,
      appConfiguration,
    });
    const result = await runS3AppPrincipalContractPreflight({
      adapter,
      confirmBucket: parsed.confirmBucket,
    }).finally(() => adapter.destroy());
    if (parsed.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else {
      console.log(
        `S3 app-principal contract passed for bucket=${result.bucket}; ` +
          `canaryId=${result.canaryId}; privacyExportLifecycle=verified; ` +
          `cleanup=verified`,
      );
    }
  } catch (error) {
    printFailure(error, parsed.json);
    process.exitCode = 1;
  }
}

await main();
