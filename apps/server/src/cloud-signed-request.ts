import { createPrivateKey, sign } from "node:crypto";

export function signCloudPayload(bytes: Uint8Array, privateKey: string): string {
  return sign(
    null,
    bytes,
    createPrivateKey({ key: Buffer.from(privateKey, "base64url"), format: "der", type: "pkcs8" }),
  ).toString("base64url");
}

export async function readCloudResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) throw new Error("Missing Cloud response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Cloud response exceeds byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
