import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { ApiError } from "@/lib/api/errors";

export type SafeWebhookTarget = {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

function isPublicUnicastAddress(value: string) {
  try {
    let address = ipaddr.parse(value);
    if (address.kind() === "ipv6") {
      const ipv6Address = address as ipaddr.IPv6;
      if (ipv6Address.isIPv4MappedAddress()) {
        address = ipv6Address.toIPv4Address();
      }
    }
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolveSafeWebhookTarget(
  value: string,
): Promise<SafeWebhookTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      422,
      "validation_error",
      "Die Webhook-URL ist ungueltig.",
    );
  }
  const developmentLocalhost =
    process.env.NODE_ENV !== "production" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1");
  if (
    url.protocol !== "https:" &&
    !(developmentLocalhost && url.protocol === "http:")
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Webhook-Ziele muessen HTTPS verwenden.",
    );
  }
  if (url.username || url.password) {
    throw new ApiError(
      422,
      "validation_error",
      "Webhook-URLs duerfen keine Zugangsdaten enthalten.",
    );
  }
  if (!developmentLocalhost && url.port && url.port !== "443") {
    throw new ApiError(
      422,
      "validation_error",
      "Webhook-Ziele duerfen nur den HTTPS-Port 443 verwenden.",
    );
  }
  if (developmentLocalhost) {
    const address =
      url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
    return {
      url,
      addresses: [
        {
          address,
          family: isIP(address) === 6 ? 6 : 4,
        },
      ],
    };
  }
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await lookup(url.hostname, {
        all: true,
        verbatim: true,
      }).catch(() => {
        throw new ApiError(
          422,
          "validation_error",
          "Das Webhook-Ziel konnte nicht sicher aufgeloest werden.",
        );
      });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicUnicastAddress(address))
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Webhook-Ziele duerfen nicht auf private Netze zeigen.",
    );
  }
  return {
    url,
    addresses: addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })),
  };
}

export async function assertSafeWebhookUrl(value: string) {
  return (await resolveSafeWebhookTarget(value)).url;
}
