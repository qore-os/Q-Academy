export type ClamAvScanResult =
  | Readonly<{ clean: true; signature: null }>
  | Readonly<{ clean: false; signature: string }>;

export class ClamAvProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClamAvProtocolError";
  }
}

export function createClamAvChunkFrame(chunk: Uint8Array) {
  if (!chunk.byteLength || chunk.byteLength > 0xffff_ffff) {
    throw new ClamAvProtocolError("The ClamAV stream chunk size is invalid.");
  }
  const frame = Buffer.allocUnsafe(4 + chunk.byteLength);
  frame.writeUInt32BE(chunk.byteLength, 0);
  Buffer.from(chunk).copy(frame, 4);
  return frame;
}

export function createClamAvEndFrame() {
  return Buffer.alloc(4);
}

export function parseClamAvResponse(input: string): ClamAvScanResult {
  const response = input.replace(/[\0\r\n]+$/g, "").trim();
  if (/^stream: OK$/i.test(response)) {
    return { clean: true, signature: null };
  }
  const infected = /^stream: (.{1,200}) FOUND$/i.exec(response);
  if (infected?.[1]) {
    const signature = infected[1]
      .replace(/[^a-z0-9_.:+() -]/gi, "?")
      .trim()
      .slice(0, 200);
    if (signature) return { clean: false, signature };
  }
  throw new ClamAvProtocolError("The ClamAV daemon returned an invalid response.");
}
