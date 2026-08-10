import assert from "node:assert/strict";
import test from "node:test";

import { uploadS3MultipartPartLikeBrowser } from "../src/lib/media/s3-browser-upload-part-preflight";

const INPUT = {
  url: "https://objects.example.test/bucket/key?X-Amz-Signature=test",
  expectedOrigin: "https://academy.example.test",
  body: Uint8Array.from([1, 2, 3, 4]),
  checksumSha256: "n2SnR-G5fxMHO6CWPFVjo7UmTM6PuYSWqL9hA30lE6A=",
  contentType: "video/mp4",
} as const;

test("browser multipart preflight sends OPTIONS and the signed PUT headers", async (context) => {
  const methods: string[] = [];
  context.mock.method(globalThis, "fetch", async (
    _target: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("origin"), INPUT.expectedOrigin);
    if (method === "OPTIONS") {
      assert.equal(headers.get("access-control-request-method"), "PUT");
      assert.equal(
        headers.get("access-control-request-headers"),
        "content-type,x-amz-checksum-sha256",
      );
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": INPUT.expectedOrigin,
          "Access-Control-Allow-Methods": "PUT",
          "Access-Control-Allow-Headers":
            "Content-Type,X-Amz-Checksum-Sha256",
        },
      });
    }
    assert.equal(method, "PUT");
    assert.equal(headers.get("content-length"), null);
    assert.equal(headers.get("content-type"), INPUT.contentType);
    assert.equal(
      headers.get("x-amz-checksum-sha256"),
      INPUT.checksumSha256,
    );
    assert.deepEqual(init?.body, Buffer.from(INPUT.body));
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": INPUT.expectedOrigin,
        "Access-Control-Expose-Headers": "ETag",
        ETag: '"multipart-etag"',
      },
    });
  });

  assert.deepEqual(await uploadS3MultipartPartLikeBrowser(INPUT), {
    ETag: '"multipart-etag"',
    ChecksumSHA256: INPUT.checksumSha256,
  });
  assert.deepEqual(methods, ["OPTIONS", "PUT"]);
});

test("browser multipart preflight fails closed before PUT on invalid CORS", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "PUT",
        "Access-Control-Allow-Headers": "*",
      },
    });
  });

  await assert.rejects(
    uploadS3MultipartPartLikeBrowser(INPUT),
    /CORS preflight/,
  );
  assert.equal(calls, 1);
});

test("browser multipart PUT requires an exposed ETag and exact origin", async (context) => {
  context.mock.method(globalThis, "fetch", async (
    _target: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    if (init?.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": INPUT.expectedOrigin,
          "Access-Control-Allow-Methods": "PUT",
          "Access-Control-Allow-Headers":
            "Content-Type,X-Amz-Checksum-Sha256",
        },
      });
    }
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": INPUT.expectedOrigin,
        ETag: '"hidden-etag"',
      },
    });
  });

  await assert.rejects(
    uploadS3MultipartPartLikeBrowser(INPUT),
    /multipart PUT/,
  );
});
