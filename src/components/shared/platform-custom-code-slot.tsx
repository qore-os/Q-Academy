import { getPlatformCustomCodeCopy } from "@/lib/i18n/platform-custom-code";
import type { AppLocale } from "@/lib/i18n/model";
import {
  platformCustomCodeDocument,
  type PlatformCustomCodeConfiguration,
} from "@/lib/platform-custom-code";

export function PlatformCustomCodeSlot({
  configuration,
  slot,
  locale,
  nonce,
  preview = false,
}: {
  configuration: PlatformCustomCodeConfiguration;
  slot: "header" | "footer";
  locale: AppLocale;
  nonce: string | null;
  preview?: boolean;
}) {
  if (!preview && !configuration.enabled) return null;
  const code =
    slot === "header" ? configuration.headerCode : configuration.footerCode;
  if (!code.trim()) return null;
  const height =
    slot === "header" ? configuration.headerHeight : configuration.footerHeight;
  const copy = getPlatformCustomCodeCopy(locale);
  const title = `${slot === "header" ? copy.header : copy.footer}: ${copy.preview}`;
  const sandboxDocument = platformCustomCodeDocument({
    code,
    locale,
    allowedNetworkOrigins: configuration.allowedNetworkOrigins,
    nonce: nonce ?? "",
  });
  if (!sandboxDocument) return null;

  return (
    <iframe
      title={title}
      srcDoc={sandboxDocument}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow=""
      loading="eager"
      aria-hidden={height === 0 ? true : undefined}
      tabIndex={height === 0 ? -1 : undefined}
      data-platform-custom-code-slot={slot}
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
