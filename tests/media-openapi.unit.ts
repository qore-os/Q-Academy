import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

type Schema = Record<string, unknown> & {
  $ref?: string;
  additionalProperties?: unknown;
  const?: unknown;
  contentEncoding?: string;
  description?: string;
  enum?: readonly unknown[];
  format?: string;
  oneOf?: readonly Schema[];
  pattern?: string;
  properties?: Record<string, Schema>;
  required?: readonly string[];
};

type Response = {
  description: string;
  headers: Record<string, { schema: Schema }>;
  content: Record<string, { schema: Schema }>;
};

type Parameter = {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
};

type Operation = {
  description: string;
  parameters: Parameter[];
  responses: Record<string, Response>;
};

function operation(path: string, method: "get" | "post") {
  const value = openApiDocument.paths[path]?.[method] as
    | Operation
    | undefined;
  assert.ok(value, `Missing ${method.toUpperCase()} ${path}`);
  return value;
}

test("media upload intent distinguishes raw PUT headers from STRATO POST fields", () => {
  const create = operation("/media-assets", "post");
  const response = create.responses["201"]!;
  const dataSchema = response.content["application/json"]!.schema.properties!
    .data!;
  assert.equal(dataSchema.$ref, "#/components/schemas/MediaAssetCreated");
  assert.match(create.description, /does not provide a native write-once guarantee/i);
  assert.match(create.description, /unique staging key/i);
  assert.match(create.description, /ETag, and content digest/i);

  const authorization = openApiDocument.components.schemas
    .MediaAssetUploadAuthorization as Schema;
  const variants = authorization.oneOf!;
  assert.equal(variants.length, 2);
  const put = variants.find(
    (variant) => variant.properties!.method!.const === "PUT",
  );
  const post = variants.find(
    (variant) => variant.properties!.method!.const === "POST",
  );
  assert.ok(put);
  assert.ok(post);

  assert.equal(put.additionalProperties, false);
  assert.ok(put.required!.includes("headers"));
  assert.equal("fields" in put.properties!, false);
  assert.deepEqual(put.properties!.transport!.enum, ["s3", "application"]);
  assert.deepEqual(put.properties!.headers!.required, [
    "Content-Length",
    "Content-Type",
    "If-None-Match",
  ]);

  assert.equal(post.additionalProperties, false);
  assert.equal(post.properties!.transport!.const, "s3");
  assert.ok(post.required!.includes("fields"));
  assert.equal("headers" in post.properties!, false);
  assert.match(
    post.properties!.fields!.description!,
    /file part named `file`/,
  );
  assert.match(
    post.properties!.fields!.description!,
    /do not convert them into HTTP headers/i,
  );
});

test("media download documents redirect and provider-dependent binary range responses", () => {
  const download = operation("/media-assets/{id}/download", "get");
  assert.match(download.description, /Strict versioned S3/);
  assert.match(download.description, /ETag-bound STRATO proxy/);

  const range = download.parameters.find(
    (parameter) => parameter.name === "Range" && parameter.in === "header",
  );
  assert.ok(range);
  assert.equal(range.required, false);
  assert.equal(range.schema!.pattern, "^bytes=.+$");
  assert.match(range.description!, /first satisfiable range/i);

  for (const status of ["200", "206"] as const) {
    const response = download.responses[status]!;
    assert.equal(
      response.content["application/octet-stream"]!.schema.contentEncoding,
      "binary",
    );
    assert.equal(
      response.headers["Accept-Ranges"]!.schema.const,
      "bytes",
    );
  }
  assert.equal(
    download.responses["206"]!.headers["Content-Range"]!.schema.pattern,
    "^bytes [0-9]+-[0-9]+/[0-9]+$",
  );

  const redirect = download.responses["307"]!;
  assert.match(redirect.description, /versioned-S3/i);
  assert.equal(redirect.headers.Location!.schema.format, "uri");

  const unsatisfiable = download.responses["416"]!;
  assert.equal(
    unsatisfiable.headers["Accept-Ranges"]!.schema.const,
    "bytes",
  );
  assert.equal(
    unsatisfiable.headers["Content-Range"]!.schema.pattern,
    "^bytes \\*/[0-9]+$",
  );
});
