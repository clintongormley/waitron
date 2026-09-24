import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectCommandOutput,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import { setTimeout as sleep } from "node:timers/promises";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { BucketOperation } from "./errors.js";
import type { ListedObject, ObjectStore, PutCondition } from "./object-store.js";

export interface BucketConfig {
  /** Absent for Amazon S3 itself; the address of any other S3-compatible store. */
  endpoint?: string;
  region: string;
  bucket: string;
  /** A folder inside the bucket the venue's objects live under; "" for the bucket root. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3ObjectStoreOptions {
  /** Replaces the network. Tests only. */
  requestHandler?: S3ClientConfig["requestHandler"];
  /** Replaces the wait between conflict retries. Tests only. */
  sleep?: (ms: number) => Promise<void>;
}

/** How many times a write answered "conflict" is sent in all before it is reported as failed. */
export const CONFLICT_ATTEMPTS = 5;
const CONFLICT_BACKOFF_MS = 200;

export function normalisePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

/**
 * The key as the bucket holds it. Litestream's replica path must start with the same normalised
 * prefix, or Litestream and this package will look for a generation in different places.
 */
export function bucketKey(config: Pick<BucketConfig, "prefix">, key: string): string {
  return `${normalisePrefix(config.prefix)}${key}`;
}

function statusOf(error: unknown): number | null {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return typeof status === "number" ? status : null;
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "Unknown";
}

function requestFailed(
  operation: BucketOperation,
  key: string,
  status: number | null,
  name: string,
): AppError {
  return new AppError("backup.stream_request_failed", { operation, key, status, name });
}

function conditionHeaders(condition: PutCondition | undefined): {
  IfMatch?: string;
  IfNoneMatch?: string;
} {
  if (condition === undefined) return {};
  return "ifMatch" in condition
    ? { IfMatch: condition.ifMatch }
    : { IfNoneMatch: condition.ifNoneMatch };
}

export function createS3ObjectStore(
  config: BucketConfig,
  options: S3ObjectStoreOptions = {},
): ObjectStore {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    // Litestream's own rule, from its configuration reference: path style "is automatically enabled
    // if endpoint is set". MinIO refuses the other style (bench/sqlite-failover/src/store.ts).
    forcePathStyle: config.endpoint !== undefined,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(options.requestHandler === undefined ? {} : { requestHandler: options.requestHandler }),
  });
  const wait = options.sleep ?? sleep;
  const bucket = config.bucket;
  const root = normalisePrefix(config.prefix);
  const at = (key: string) => root + key;

  return {
    async get(key) {
      let out: GetObjectCommandOutput;
      try {
        out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: at(key) }));
      } catch (error) {
        // By name: a missing bucket also answers 404, and must never read as "nothing written yet".
        if (nameOf(error) === "NoSuchKey") return null;
        throw requestFailed("get", key, statusOf(error), nameOf(error));
      }
      if (out.Body === undefined || out.ETag === undefined) {
        throw requestFailed("get", key, out.$metadata.httpStatusCode ?? null, "IncompleteResponse");
      }
      try {
        return { body: await out.Body.transformToByteArray(), etag: out.ETag };
      } catch (error) {
        // Reported with no status, so callers treat a body that broke off as no answer, not a refusal.
        throw requestFailed("get", key, null, nameOf(error));
      }
    },

    async put(key, body, condition) {
      for (let attempt = 1; ; attempt += 1) {
        let out: PutObjectCommandOutput;
        try {
          out = await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: at(key),
              Body: body,
              ...conditionHeaders(condition),
            }),
          );
        } catch (error) {
          const status = statusOf(error);
          if (status === 412) throw new AppError("backup.stream_precondition_failed", { key });
          // A conflict is a concurrent request on the same object, not a verdict, and is sent again
          // with the caller's condition unchanged. Re-reading the version first would turn
          // "only if unchanged since I read it" into "whatever is there now".
          if (status === 409 && attempt < CONFLICT_ATTEMPTS) {
            await wait(CONFLICT_BACKOFF_MS * attempt);
            continue;
          }
          throw requestFailed("put", key, status, nameOf(error));
        }
        if (out.ETag === undefined)
          throw requestFailed("put", key, out.$metadata.httpStatusCode ?? null, "MissingETag");
        return { etag: out.ETag };
      }
    },

    // Pruning deletes what this answers, so an answer that cannot be complete, or names a key outside
    // the prefix asked for, is refused whole rather than trimmed.
    async list(prefix) {
      const wanted = at(prefix);
      const found: ListedObject[] = [];
      const followed = new Set<string>();
      let token: string | undefined;
      do {
        let page: ListObjectsV2CommandOutput;
        try {
          page = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: wanted,
              ContinuationToken: token,
            }),
          );
        } catch (error) {
          throw requestFailed("list", prefix, statusOf(error), nameOf(error));
        }
        const refuse = (name: string) =>
          requestFailed("list", prefix, page.$metadata.httpStatusCode ?? null, name);
        for (const object of page.Contents ?? []) {
          if (object.Key === undefined || object.LastModified === undefined)
            throw refuse("IncompleteListing");
          if (!object.Key.startsWith(wanted)) throw refuse("KeyOutsidePrefix");
          found.push({ key: object.Key.slice(root.length), lastModified: object.LastModified });
        }
        token = undefined;
        if (page.IsTruncated) {
          token = page.NextContinuationToken;
          if (token === undefined) throw refuse("MissingContinuationToken");
          if (followed.has(token)) throw refuse("RepeatedContinuationToken");
          followed.add(token);
        }
      } while (token !== undefined);
      return found;
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: at(key) }));
      } catch (error) {
        throw requestFailed("delete", key, statusOf(error), nameOf(error));
      }
    },
  };
}
