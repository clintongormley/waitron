import { Agent } from "node:https";
import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import type { CloudCaptureGrant } from "./cloud-backup.js";
import "./errors.js";
export async function uploadCloudCapture(
  grant: CloudCaptureGrant,
  bytes: Uint8Array,
  options: { ca?: string; signal?: AbortSignal } = {},
): Promise<{ digest: string; size: number }> {
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
      bytes.length === 0 ||
      bytes.length > 512 * 1024 * 1024
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
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: grant.location.bucket,
          Key: grant.incomingKey,
          Body: bytes,
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
    return { digest: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } catch {
    throw new AppError("cloud.unavailable", {});
  } finally {
    client?.destroy();
  }
}
