import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";
import { Agent, request } from "node:https";
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import {
  CLOUD_GRANT_MARGIN_MS,
  MAX_CLOUD_ARCHIVE_BYTES,
  MAX_CLOUD_TRANSFER_MS,
} from "./cloud-backup-limits.js";
import { signedUploadAddress, type CloudCaptureGrant } from "./cloud-backup.js";
import "./errors.js";

const MAX_BUFFERED_ARCHIVE_BYTES = 512 * 1024 ** 2;

function putSigned(
  url: URL,
  body: Uint8Array | Readable,
  size: number,
  ca: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const put = request(
      url,
      {
        method: "PUT",
        headers: { "Content-Length": size, "If-None-Match": "*" },
        ca,
        rejectUnauthorized: true,
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        // Cloud publication checks the digest and size of an existing object.
        if ((status >= 200 && status < 300) || status === 412) resolve();
        else reject(Error());
        // The status is the whole reply. A refusal can arrive while the file is still streaming.
        response.destroy();
        put.destroy();
      },
    );
    put.once("error", reject);
    if (body instanceof Uint8Array) put.end(body);
    else {
      body.once("error", (error) => put.destroy(error));
      body.pipe(put);
    }
  });
}

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
      size > (body instanceof Uint8Array ? MAX_BUFFERED_ARCHIVE_BYTES : MAX_CLOUD_ARCHIVE_BYTES)
    )
      throw Error();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    if (grant.uploadUrl !== undefined) {
      const address = signedUploadAddress(
        grant.uploadUrl,
        url,
        grant.location.bucket,
        grant.incomingKey,
      );
      await putSigned(address, body, size, options.ca, signal);
      return;
    }
    client = new S3Client({
      endpoint: grant.location.endpoint,
      region: grant.location.region,
      credentials: grant.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      // Explicit so NODE_TLS_REJECT_UNAUTHORIZED=0 cannot switch it off.
      requestHandler: { httpsAgent: new Agent({ ca: options.ca, rejectUnauthorized: true }) },
    });
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
        stat.size > MAX_CLOUD_ARCHIVE_BYTES
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
    // A fresh grant needs a fresh stream. A consumed stream cannot be replayed.
    const timeout = Math.min(
      MAX_CLOUD_TRANSFER_MS,
      Date.parse(grant.expiresAt) - Date.now() - CLOUD_GRANT_MARGIN_MS,
    );
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
