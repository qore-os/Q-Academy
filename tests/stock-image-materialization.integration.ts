import assert from "node:assert/strict";
import test from "node:test";

import { downloadStockImage } from "../src/lib/stock-image-provider";
import type { StockImageProviderConfiguration } from "../src/lib/stock-image-model";

const configuration: StockImageProviderConfiguration = {
  enabled: true,
  provider: "Test stock",
  baseUrl: new URL("https://stock.example.test/v1/"),
  apiKey: "test-key",
  allowedHosts: new Set(["stock.example.test"]),
};

function imageResponse(contentType = "image/webp") {
  let closed = false;
  return {
    statusCode: 200,
    headers: {
      "content-type": contentType,
      "content-length": "4",
    },
    body: (async function* () {
      yield new Uint8Array([1, 2, 3, 4]);
    })(),
    close: () => {
      closed = true;
    },
    wasClosed: () => closed,
  };
}

test("stock cover materialization pins the host and accepts bounded image bytes", async () => {
  const response = imageResponse();
  const image = await downloadStockImage(
    "https://stock.example.test/images/cover.webp",
    {
      configuration,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      open: async () => response,
    },
  );
  assert.equal(image.contentType, "image/webp");
  assert.deepEqual([...image.bytes], [1, 2, 3, 4]);
  assert.equal(response.wasClosed(), true);
});

test("stock cover materialization rejects private targets and non-images", async () => {
  await assert.rejects(
    downloadStockImage("https://stock.example.test/images/cover.webp", {
      configuration,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      open: async () => imageResponse(),
    }),
  );
  await assert.rejects(
    downloadStockImage("https://stock.example.test/images/cover.webp", {
      configuration,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      open: async () => imageResponse("text/html"),
    }),
  );
});
