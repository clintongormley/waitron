import { generateKeyPairSync, verify } from "node:crypto";
import { expect, it } from "vitest";
import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";

it("signs exactly the supplied bytes with the held installation key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from('["signed", 1]\n');
  const signature = Buffer.from(
    signCloudPayload(
      bytes,
      privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    ),
    "base64url",
  );
  expect(verify(null, bytes, publicKey, signature)).toBe(true);
  expect(verify(null, Buffer.from('["signed",1]'), publicKey, signature)).toBe(false);
});

it("collects exactly the byte limit across streamed chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xc3));
      controller.enqueue(Uint8Array.of(0xa9, 0x21));
      controller.close();
    },
  });
  expect(await readCloudResponseBytes(new Response(stream), 3)).toEqual(Buffer.from("\u00e9!"));
});

it("refuses one byte over the limit and cancels unread stream data", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2));
      controller.enqueue(Uint8Array.of(3, 4));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readCloudResponseBytes(new Response(stream), 3)).rejects.toThrow();
  expect(cancelled).toBe(true);
});

it("refuses a response without a body", async () => {
  await expect(readCloudResponseBytes(new Response(null), 3)).rejects.toThrow();
});

it("keeps a stream's failure for the caller to classify", async () => {
  const failure = new Error("stream interrupted");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });
  await expect(readCloudResponseBytes(new Response(stream), 3)).rejects.toBe(failure);
});
