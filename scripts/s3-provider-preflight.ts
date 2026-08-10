import { createAwsS3ProviderContractAdapter } from "../src/lib/media/s3-provider-contract-aws";
import {
  runS3ProviderContractPreflight,
  S3ProviderContractError,
} from "../src/lib/media/s3-provider-contract";
import {
  MediaStorageConfigurationError,
  resolveMediaStorageConfiguration,
} from "../src/lib/media/storage-configuration";
import {
  runStratoS3CompatibilityPreflight,
  StratoS3CompatibilityError,
} from "../src/lib/media/s3-strato-compatibility-preflight";
import { resolveS3BrowserUploadOriginInventory } from "../src/lib/media/s3-browser-upload-origins";
import { loadProjectEnvironment } from "./load-environment";

const HELP = `Q-Academy S3-Provider-Contract-Preflight

Erforderlich:
  --confirm-bucket <bucket>   Muss exakt MEDIA_S3_BUCKET entsprechen

Optional:
  --json                      Maschinenlesbare, geheimnisfreie Ausgabe
  --help                      Diese Hilfe anzeigen

Der Test schreibt ausschliesslich unter einem zufaelligen
q-academy-provider-contract-canary/v1/... Praefix und entfernt im Anschluss
alle dort erzeugten Versionen und Delete-Marker. Zusaetzlich liest er die
Bucket-Lifecycle- und CORS-Konfiguration. Im versionierten Modus prueft er
zusaetzlich den acht-taegigen Privacy-Export-Vertrag, den bucketweiten
Multipart-Abbruch nach maximal sieben Tagen sowie einen nativen
Create/UploadPart/ListParts/Complete/Abort-Vertrag mit drei SHA-256-Teilen.`;

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

function productionS3Configuration() {
  const configuration = resolveMediaStorageConfiguration({
    ...process.env,
    NODE_ENV: "production",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_CLAMAV_HOST: "127.0.0.1",
    MEDIA_CLAMAV_PORT: "3310",
  });
  if (configuration.driver !== "s3") {
    throw new Error("The media storage driver is not S3.");
  }
  return configuration;
}

function browserOrigins() {
  return resolveS3BrowserUploadOriginInventory(process.env);
}

function printFailure(error: unknown, json: boolean) {
  const contractError =
    error instanceof S3ProviderContractError ||
    error instanceof StratoS3CompatibilityError
      ? error
      : null;
  const code =
    contractError?.code ??
    (error instanceof MediaStorageConfigurationError
      ? "invalid_configuration"
      : "preflight_failed");
  const canaryPrefix = contractError?.canaryPrefix ?? null;
  if (json) {
    console.error(JSON.stringify({ ok: false, code, canaryPrefix }));
  } else {
    console.error(
      `S3 provider contract failed: code=${code}${
        canaryPrefix ? ` canaryPrefix=${canaryPrefix}` : ""
      }`,
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
    loadProjectEnvironment();
    const configuration = productionS3Configuration();
    if (configuration.compatibilityMode === "strato-hidrive") {
      const result = await runStratoS3CompatibilityPreflight({
        configuration,
        confirmBucket: parsed.confirmBucket,
        expectedOrigins: browserOrigins(),
      });
      if (parsed.json) {
        console.log(JSON.stringify({ ok: true, ...result }));
      } else {
        console.log(
          `STRATO compatibility contract passed for bucket=${result.bucket}; ` +
            `canaryPrefix=${result.canaryPrefix}; browserPostCors=verified; ` +
            `browserOrigins=${result.browserUploadOriginCount}; ` +
            `browserPostPolicy=verified; anonymousAccess=blocked; ` +
            `etagAndDigest=verified; copySourceIfMatch=enforced; ` +
            `cleanup=verified; nativeVersioning=false; nativeLifecycle=false; ` +
            `principalIsolation=false`,
        );
      }
      return;
    }
    const adapter = createAwsS3ProviderContractAdapter(configuration);
    const result = await runS3ProviderContractPreflight({
      adapter,
      confirmBucket: parsed.confirmBucket,
      expectedOrigins: browserOrigins(),
      multipartUploadTtlSeconds:
        configuration.limits.multipartUploadTtlSeconds,
    }).finally(() => adapter.destroy());
    if (parsed.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else {
      console.log(
        `S3 provider contract passed for bucket=${result.bucket}; ` +
          `canaryPrefix=${result.canaryPrefix}; ` +
          `privacyExportLifecycle=${result.privacyExportExpirationDays}d; ` +
          `incompleteMultipartLifecycle<=${result.incompleteMultipartAbortDays}d; ` +
          `browserPutCors=verified(${result.browserUploadOriginCount}); multipart=verified; abort=verified; ` +
          `cleanup=verified`,
      );
    }
  } catch (error) {
    printFailure(error, parsed.json);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  printFailure(error, process.argv.includes("--json"));
  process.exitCode = 1;
});
