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
  maximum?: number;
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
  requestBody?: {
    content: Record<string, { schema: Schema }>;
  };
  responses: Record<string, Response>;
  "x-required-scopes"?: readonly string[];
};

function operation(path: string, method: "get" | "post" | "delete") {
  const value = openApiDocument.paths[path]?.[method] as Operation | undefined;
  assert.ok(value, `Missing ${method.toUpperCase()} ${path}`);
  return value;
}

test("media upload intent distinguishes raw PUT headers from STRATO POST fields", () => {
  const create = operation("/media-assets", "post");
  const response = create.responses["201"]!;
  const dataSchema =
    response.content["application/json"]!.schema.properties!.data!;
  assert.equal(dataSchema.$ref, "#/components/schemas/MediaAssetCreated");
  assert.match(
    create.description,
    /does not provide a native write-once guarantee/i,
  );
  assert.match(create.description, /unique staging key/i);
  assert.match(create.description, /ETag, and content digest/i);

  const authorization = openApiDocument.components.schemas
    .MediaAssetUploadAuthorization as Schema;
  const variants = authorization.oneOf!;
  assert.equal(variants.length, 3);
  const put = variants.find(
    (variant) => variant.properties!.method!.const === "PUT",
  );
  const post = variants.find(
    (variant) => variant.properties!.method!.const === "POST",
  );
  assert.ok(put);
  assert.ok(post);
  const nativeMultipart = variants.find(
    (variant) => variant.properties!.transport!.const === "s3-multipart",
  );
  assert.ok(nativeMultipart);

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
  assert.match(post.properties!.fields!.description!, /file part named `file`/);
  assert.match(
    post.properties!.fields!.description!,
    /do not convert them into HTTP headers/i,
  );
  assert.deepEqual(nativeMultipart.required, [
    "transport",
    "statusUrl",
    "partsUrl",
    "completeUrl",
    "abortUrl",
    "partSizeBytes",
    "partCount",
    "concurrency",
    "expiresAt",
  ]);
  assert.equal(nativeMultipart.properties!.partCount!.maximum, 10_000);
  assert.match(create.description, /2,000,000,000-byte scanner boundary/i);
});

test("media multipart control plane is explicit, scoped, and resumable", () => {
  const status = operation("/media-assets/{id}/multipart", "get");
  const recover = operation("/media-assets/{id}/multipart", "post");
  const abort = operation("/media-assets/{id}/multipart", "delete");
  const part = operation("/media-assets/{id}/multipart/parts", "post");
  const complete = operation("/media-assets/{id}/complete", "post");

  for (const value of [status, recover, abort, part, complete]) {
    assert.deepEqual(value["x-required-scopes"], []);
    assert.ok(
      value.parameters.some(
        (parameter) => parameter.name === "id" && parameter.in === "path",
      ),
    );
    assert.equal(
      (value.responses["503"] as { $ref?: string }).$ref,
      "#/components/responses/ServiceUnavailable",
    );
  }
  assert.match(status.description, /without creating a replacement/i);
  assert.match(recover.description, /first verifies/i);
  assert.match(recover.description, /original upload deadline/i);
  assert.match(complete.description, /ambiguous completion/i);
  assert.match(abort.description, /releases its reserved quota/i);

  const partRequest = part.requestBody!.content["application/json"]!.schema;
  assert.equal(
    partRequest.$ref,
    "#/components/schemas/MediaMultipartPartAuthorizeRequest",
  );
  const partRequestSchema = openApiDocument.components.schemas
    .MediaMultipartPartAuthorizeRequest as Schema;
  assert.deepEqual(partRequestSchema.required, [
    "partNumber",
    "checksumSha256",
  ]);
  assert.equal(partRequestSchema.properties!.partNumber!.maximum, 10_000);

  const statusSchema = openApiDocument.components.schemas
    .MediaMultipartStatus as Schema;
  assert.deepEqual(statusSchema.properties!.state!.enum, [
    "uploading",
    "completing",
    "completion_pending",
    "completed",
  ]);
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
    assert.equal(response.headers["Accept-Ranges"]!.schema.const, "bytes");
  }
  assert.equal(
    download.responses["206"]!.headers["Content-Range"]!.schema.pattern,
    "^bytes [0-9]+-[0-9]+/[0-9]+$",
  );

  const redirect = download.responses["307"]!;
  assert.match(redirect.description, /versioned-S3/i);
  assert.equal(redirect.headers.Location!.schema.format, "uri");

  const unsatisfiable = download.responses["416"]!;
  assert.equal(unsatisfiable.headers["Accept-Ranges"]!.schema.const, "bytes");
  assert.equal(
    unsatisfiable.headers["Content-Range"]!.schema.pattern,
    "^bytes \\*/[0-9]+$",
  );
});
