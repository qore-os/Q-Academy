import assert from "node:assert/strict";
import test from "node:test";

import {
  ClamAvProtocolError,
  createClamAvChunkFrame,
  createClamAvEndFrame,
  parseClamAvResponse,
} from "../src/lib/media/clamav-protocol";

test("ClamAV protocol frames stream chunks with network byte order", () => {
  const frame = createClamAvChunkFrame(Uint8Array.from([1, 2, 3]));
  assert.equal(frame.readUInt32BE(0), 3);
  assert.deepEqual([...frame.subarray(4)], [1, 2, 3]);
  assert.deepEqual([...createClamAvEndFrame()], [0, 0, 0, 0]);
});

test("ClamAV protocol accepts clean and infected terminal responses", () => {
  assert.deepEqual(parseClamAvResponse("stream: OK\0"), {
    clean: true,
    signature: null,
  });
  assert.deepEqual(parseClamAvResponse("stream: Eicar-Test-Signature FOUND\n"), {
    clean: false,
    signature: "Eicar-Test-Signature",
  });
});

test("ClamAV protocol rejects malformed and error responses", () => {
  for (const response of ["", "stream: size limit exceeded ERROR\0", "PONG\0"]) {
    assert.throws(
      () => parseClamAvResponse(response),
      (error: unknown) => error instanceof ClamAvProtocolError,
    );
  }
  assert.throws(
    () => createClamAvChunkFrame(new Uint8Array()),
    (error: unknown) => error instanceof ClamAvProtocolError,
  );
});
