import {
  ClamAvPreflightError,
  runClamAvPreflight,
} from "../src/lib/media/clamav-preflight";
import {
  MediaStorageConfigurationError,
  resolveClamAvConfiguration,
} from "../src/lib/media/storage-configuration";

const HELP = `Q-Academy ClamAV-Deep-Preflight

Erforderlich:
  --confirm-host <host>   Muss exakt MEDIA_CLAMAV_HOST entsprechen

Optional:
  --json                  Maschinenlesbare, geheimnisfreie Ausgabe
  --help                  Diese Hilfe anzeigen

Der Test streamt einen zufaelligen sauberen Canary und anschliessend den
harmlosen Standard-Antivirus-Testvektor direkt an clamd. Es werden keine
Dateien geschrieben.`;

type Arguments = Readonly<{
  confirmHost: string;
  json: boolean;
  help: boolean;
}>;

function parseArguments(argv: readonly string[]): Arguments {
  let confirmHost = "";
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--help") {
      if (argument === "--json") json = true;
      else help = true;
      continue;
    }
    if (argument !== "--confirm-host" || confirmHost) {
      throw new Error("Die CLI-Optionen sind ungueltig.");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--confirm-host benoetigt einen Wert.");
    }
    confirmHost = value.trim().toLowerCase();
    index += 1;
  }
  if (!help && !confirmHost) {
    throw new Error("--confirm-host ist erforderlich.");
  }
  return { confirmHost, json, help };
}

function printFailure(error: unknown, json: boolean) {
  const preflightError = error instanceof ClamAvPreflightError ? error : null;
  const code =
    preflightError?.code ??
    (error instanceof MediaStorageConfigurationError
      ? "invalid_configuration"
      : "preflight_failed");
  const stage = preflightError?.stage ?? null;
  if (json) console.error(JSON.stringify({ ok: false, code, stage }));
  else {
    console.error(
      `ClamAV deep preflight failed: code=${code}` +
        `${stage ? ` stage=${stage}` : ""}`,
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
    const configuration = resolveClamAvConfiguration({
      ...process.env,
      NODE_ENV: "production",
    });
    if (parsed.confirmHost !== configuration.host) {
      throw new MediaStorageConfigurationError([
        {
          field: "MEDIA_CLAMAV_HOST",
          message: "must exactly match --confirm-host.",
        },
      ]);
    }
    const result = await runClamAvPreflight({ configuration });
    if (parsed.json) console.log(JSON.stringify({ ok: true, ...result }));
    else console.log("ClamAV deep preflight passed; clean=verified; malware=blocked");
  } catch (error) {
    printFailure(error, parsed.json);
    process.exitCode = 1;
  }
}

await main();
