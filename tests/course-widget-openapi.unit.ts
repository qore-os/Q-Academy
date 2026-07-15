import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

test("course widget OpenAPI distinguishes public and private image sources", () => {
  for (const name of ["CourseWidgetCreate", "CourseWidgetUpdate"]) {
    const schema = openApiDocument.components.schemas[name] as {
      oneOf?: Array<{
        required?: string[];
        properties?: Record<string, unknown>;
      }>;
    };
    assert.equal(schema.oneOf?.length, 4);
    const publicImage = schema.oneOf?.[2];
    const privateImage = schema.oneOf?.[3];
    assert.deepEqual(publicImage?.required, [
      "type",
      "imageUrl",
      "altText",
      "linkUrl",
    ]);
    assert.deepEqual(privateImage?.required, [
      "type",
      "mediaAssetId",
      "altText",
      "linkUrl",
    ]);
    assert.ok(publicImage?.properties?.imageUrl);
    assert.ok(privateImage?.properties?.mediaAssetId);
    assert.match(JSON.stringify(privateImage), /canonical download URL/i);
  }
});
