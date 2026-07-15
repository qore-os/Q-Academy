import {
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";

import { HUB_CUSTOM_CODE_MAX_LENGTH } from "@/lib/hub-custom-code-policy";

const HUB_SANDBOX_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const SANDBOX_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
].join("; ");

type HtmlNode = DefaultTreeAdapterMap["node"];

function applyScriptNonce(node: HtmlNode, nonce: string) {
  if ("tagName" in node && node.tagName === "script") {
    node.attrs = [
      ...node.attrs.filter((attribute) => attribute.name !== "nonce"),
      { name: "nonce", value: nonce },
    ];
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) applyScriptNonce(child, nonce);
  }
  if ("content" in node) applyScriptNonce(node.content, nonce);
}

function customCodeWithNonce(value: string, nonce: string) {
  const fragment = parseFragment(value);
  applyScriptNonce(fragment, nonce);
  return serialize(fragment);
}

export function hubCustomCodeDocument(value: unknown, nonce: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > HUB_CUSTOM_CODE_MAX_LENGTH ||
    typeof nonce !== "string" ||
    !HUB_SANDBOX_NONCE_PATTERN.test(nonce)
  ) {
    return null;
  }

  const code = customCodeWithNonce(value, nonce);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<style>html{color-scheme:light}*,*::before,*::after{box-sizing:border-box}body{margin:0;padding:16px;color:#243444;background:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>
</head>
<body>${code}</body>
</html>`;
}
