import "server-only";

import type { OidcLoginTransaction } from "@/lib/oidc-model";
import { oidcTransactionCookiePolicy } from "@/lib/oidc-cookie-policy";
import {
  openOidcLoginTransactionWithSecret,
  sealOidcLoginTransactionWithSecret,
} from "@/lib/oidc-transaction-crypto";
import { getSessionSecret } from "@/lib/server-environment";

export function oidcTransactionCookieName() {
  return oidcTransactionCookiePolicy(process.env.NODE_ENV === "production").name;
}

export function oidcTransactionCookieOptions() {
  return oidcTransactionCookiePolicy(process.env.NODE_ENV === "production")
    .options;
}

export async function sealOidcLoginTransaction(
  input: OidcLoginTransaction,
) {
  return sealOidcLoginTransactionWithSecret(input, getSessionSecret());
}

export async function openOidcLoginTransaction(value: string | undefined) {
  return openOidcLoginTransactionWithSecret(value, getSessionSecret());
}
