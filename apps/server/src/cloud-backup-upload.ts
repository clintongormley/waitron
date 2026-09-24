import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";
import { Agent } from "node:https";
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import type { CloudCaptureGrant } from "./cloud-backup.js";
import "./errors.js";
async function upload(
  grant: CloudCaptureGrant,
  body: Uint8Array | Readable,
  size: number,
  options: { ca?: string; signal?: AbortSignal },
  timeoutMs: number,
): Promise<void> {
  let client: S3Client | undefined;
  try {
    const url = new URL(grant.location.endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      grant.incomingKey !== "incoming/" + grant.id ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= Date.now() ||
      size === 0 ||
      size > 512 * 1024 * 1024
    )
      throw Error();
    client = new S3Client({
      endpoint: grant.location.endpoint,
      region: grant.location.region,
      credentials: grant.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      requestHandler: { httpsAgent: new Agent({ ca: options.ca }) },
    });
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: grant.location.bucket,
          Key: grant.incomingKey,
          Body: body,
          ContentLength: size,
          IfNoneMatch: "*",
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      // Upload authority cannot read. Cloud publication compares the existing object's digest and size.
      if (
        !error ||
        typeof error !== "object" ||
        !("$metadata" in error) ||
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 412
      )
        throw error;
    }
  } catch {
    throw new AppError("cloud.unavailable", {});
  } finally {
    client?.destroy();
  }
}

export async function uploadCloudCapture(
  grant: CloudCaptureGrant,
  bytes: Uint8Array,
  options: { ca?: string; signal?: AbortSignal } = {},
): Promise<{ digest: string; size: number }> {
  await upload(grant, bytes, bytes.length, options, 30000);
  return { digest: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}
export async function uploadCloudCaptureFile(
  grant: CloudCaptureGrant,
  path: string,
  receipt: { digest: string; size: number },
  options: { ca?: string; signal?: AbortSignal } = {},
): Promise<{ digest: string; size: number }> {
  try {
    options.signal?.throwIfAborted();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const hash = createHash("sha256");
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size !== receipt.size ||
        stat.size < 1 ||
        stat.size > 512 * 1024 * 1024
      )
        throw Error();
      const buffer = Buffer.alloc(65536);
      let offset = 0;
      while (offset < stat.size) {
        options.signal?.throwIfAborted();
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, stat.size - offset),
          offset,
        );
        if (!bytesRead) throw Error();
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      if (hash.digest("hex") !== receipt.digest) throw Error();
    } finally {
      await handle.close();
    }
    // A retry opens a fresh stream with renewed credentials. The SDK never replays a consumed stream.
    const timeout = Math.min(14 * 60000, Date.parse(grant.expiresAt) - Date.now() - 5000);
    if (!Number.isFinite(timeout) || timeout <= 0) throw Error();
    const source = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const body = source.createReadStream();
    try {
      await upload(grant, body, receipt.size, options, timeout);
    } finally {
      body.destroy();
      await source.close();
    }
    return receipt;
  } catch {
    throw new AppError("cloud.unavailable", {});
  }
}
