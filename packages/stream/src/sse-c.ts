import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { bucketKey } from "./names.js";
import { generationPrefix } from "./generations.js";
import { PROBE_PREFIX, type ProbeResult } from "./probe.js";
import {
  createBucketClient,
  nameOf,
  requestFailed,
  statusOf,
  type BucketConfig,
} from "./s3-client.js";

export async function verifyStreamKey(
  bucket: BucketConfig,
  venueId: string,
  generation: string,
  streamKey: string,
): Promise<void> {
  const client = createBucketClient(bucket);
  const prefix = bucketKey(bucket, generationPrefix(venueId, generation));
  try {
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const object = page.Contents?.find(
        ({ Key }) =>
          Key?.startsWith(prefix) &&
          /^[0-9a-f]{4}\/[0-9a-f]{16}-[0-9a-f]{16}\.ltx$/.test(Key.slice(prefix.length)),
      );
      if (object?.Key !== undefined) {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket.bucket,
            Key: object.Key,
            Range: "bytes=0-0",
            SSECustomerAlgorithm: "AES256",
            SSECustomerKey: streamKey,
            SSECustomerKeyMD5: createHash("md5")
              .update(Buffer.from(streamKey, "base64"))
              .digest("base64"),
          }),
        );
        if (response.Body === undefined) throw new Error("IncompleteResponse");
        await response.Body.transformToByteArray();
        return;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    throw new Error("NoDatabaseObject");
  } catch (error) {
    throw requestFailed("get", prefix, statusOf(error), nameOf(error));
  } finally {
    client.destroy();
  }
}

/** A failed settings read must never be followed by replacing unknown bucket rules. */
export async function prepareBucketEncryption(bucket: BucketConfig): Promise<ProbeResult> {
  const client = createBucketClient(bucket);
  const key = bucketKey(bucket, `${PROBE_PREFIX}encryption-${randomUUID()}`);
  const bytes = randomBytes(32);
  const headers = (secret: Buffer) => ({
    SSECustomerAlgorithm: "AES256",
    SSECustomerKey: secret.toString("base64"),
    SSECustomerKeyMD5: createHash("md5").update(secret).digest("base64"),
  });
  const secret = randomBytes(32);
  let wrote = false;
  let operation: "get" | "put" = "get";
  let requestedKey = bucket.bucket;
  const unavailable = (): ProbeResult => ({
    ok: false,
    reason: "encryption_unavailable",
    detail: "customer-key storage could not be verified",
  });
  try {
    try {
      const { ServerSideEncryptionConfiguration: settings } = await client.send(
        new GetBucketEncryptionCommand({ Bucket: bucket.bucket }),
      );
      if (
        settings?.Rules?.some((rule) =>
          rule.BlockedEncryptionTypes?.EncryptionType?.includes("SSE-C"),
        )
      ) {
        operation = "put";
        await client.send(
          new PutBucketEncryptionCommand({
            Bucket: bucket.bucket,
            ServerSideEncryptionConfiguration: {
              ...settings,
              Rules: settings.Rules.map((rule) => ({
                ...rule,
                ...(rule.BlockedEncryptionTypes?.EncryptionType?.includes("SSE-C")
                  ? { BlockedEncryptionTypes: { EncryptionType: ["NONE"] } }
                  : {}),
              })),
            },
          }),
        );
      }
    } catch (error) {
      if (statusOf(error) === null) throw error;
      // A provider may already honour keys without offering this settings API or Put permission.
      // Only the object controls below decide whether these settings can be saved.
    }
    requestedKey = key;
    operation = "put";
    wrote = true;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket.bucket,
        Key: key,
        Body: bytes,
        IfNoneMatch: "*",
        ...headers(secret),
      }),
    );
    operation = "get";
    const correct = await client.send(
      new GetObjectCommand({ Bucket: bucket.bucket, Key: key, ...headers(secret) }),
    );
    if (
      !correct.Body ||
      Buffer.compare(Buffer.from(await correct.Body.transformToByteArray()), bytes) !== 0
    ) {
      return unavailable();
    }
    for (const control of [headers(randomBytes(32)), {}]) {
      try {
        const readable = await client.send(
          new GetObjectCommand({ Bucket: bucket.bucket, Key: key, ...control }),
        );
        await readable.Body?.transformToByteArray();
        return {
          ok: false,
          reason: "encryption_ignored",
          detail: "the object was readable without the matching key",
        };
      } catch (error) {
        const status = statusOf(error);
        if (status === null) throw error;
        if (status !== 400 && status !== 403) return unavailable();
      }
    }
    return { ok: true };
  } catch (error) {
    if (statusOf(error) === null) throw requestFailed(operation, requestedKey, null, nameOf(error));
    return unavailable();
  } finally {
    try {
      if (wrote) await client.send(new DeleteObjectCommand({ Bucket: bucket.bucket, Key: key }));
    } catch {
      // A unique probe name prevents a failed cleanup from replacing another check's object.
    }
    client.destroy();
  }
}
