import type { JSHandle, Locator, Page } from "@playwright/test";

export type BrowserFilePayload = Readonly<{
  name: string;
  mimeType: string;
  buffer: Buffer;
}>;

export async function createFileDataTransfer(
  page: Page,
  files: readonly BrowserFilePayload[],
): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((payloads) => {
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.base64);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      transfer.items.add(
        new File([bytes], payload.name, { type: payload.mimeType }),
      );
    }
    return transfer;
  }, files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.buffer.toString("base64"),
  })));
}

export async function dropFiles(
  page: Page,
  target: Locator,
  files: readonly BrowserFilePayload[],
) {
  const dataTransfer = await createFileDataTransfer(page, files);
  const element = await target.elementHandle();
  if (!element) {
    await dataTransfer.dispose();
    throw new Error("Drop target is not attached.");
  }
  try {
    await element.dispatchEvent("dragenter", { dataTransfer });
    await element.dispatchEvent("drop", { dataTransfer });
  } finally {
    await element.dispose();
    await dataTransfer.dispose();
  }
}
