import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  DeleteObjectsCommandOutput,
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectCommandOutput,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import { setTimeout as sleep } from "node:timers/promises";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { BucketOperation } from "./errors.js";
import { normalisePrefix } from "./names.js";
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

/** S3's own limit: "The request can contain a list of up to 1,000 keys" (API_DeleteObjects). */
const DELETE_BATCH_KEYS = 1000;
/** How many single deletes are in flight at once where the store has no multi-object delete. */
export const DELETE_CONCURRENCY = 8;

/** How many times a write answered "conflict" is sent in all before it is reported as failed. */
export const CONFLICT_ATTEMPTS = 5;
const CONFLICT_BACKOFF_MS = 200;

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

/** Stops starting work at the first failure, and answers only once the work in flight has settled. */
async function eachUntilFailure<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next]!;
      next += 1;
      try {
        await work(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  const outcomes = await Promise.allSettled(workers);
  const refusal = outcomes.find((outcome) => outcome.status === "rejected");
  if (refusal !== undefined) throw refusal.reason;
}

export function createS3ObjectStore(
  config: BucketConfig,
  options: S3ObjectStoreOptions = {},
): ObjectStore {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    // Litestream's own rule, from its configuration reference: path style "is automatically enabled
    // if endpoint is set".
    forcePathStyle: config.endpoint !== undefined,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(options.requestHandler === undefined ? {} : { requestHandler: options.requestHandler }),
  });
  const wait = options.sleep ?? sleep;
  const bucket = config.bucket;
  const root = normalisePrefix(config.prefix);
  const at = (key: string) => root + key;

  async function deleteOne(key: string): Promise<void> {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: at(key) }));
    } catch (error) {
      throw requestFailed("delete", key, statusOf(error), nameOf(error));
    }
  }

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
          if (!object.Key.startsWith(wanted)) {
            throw new AppError("backup.stream_name_invalid", {
              field: "listedKey",
              value: object.Key,
            });
          }
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

    delete: deleteOne,

    // Batches go one at a time, so a failed one stops the rest with nothing else in flight.
    async deleteMany(keys) {
      for (let start = 0; start < keys.length; start += DELETE_BATCH_KEYS) {
        const batch = keys.slice(start, start + DELETE_BATCH_KEYS);
        let out: DeleteObjectsCommandOutput;
        try {
          out = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((key) => ({ Key: at(key) })), Quiet: true },
            }),
          );
        } catch (error) {
          // 501 is HTTP's "does not support the functionality required" (RFC 9110 §15.6.2). Any other
          // refusal of the batch fails the delete; which providers answer what is not established here.
          if (statusOf(error) === 501) {
            await eachUntilFailure(batch, DELETE_CONCURRENCY, deleteOne);
            continue;
          }
          throw requestFailed("delete", batch[0]!, statusOf(error), nameOf(error));
        }
        // A quiet answer lists only the keys it did not delete, inside a request that succeeded.
        const refused = out.Errors?.[0];
        if (refused !== undefined) {
          const status = out.$metadata.httpStatusCode ?? null;
          const key = batch.find((candidate) => at(candidate) === refused.Key);
          if (key === undefined || !refused.Code) {
            throw requestFailed("delete", key ?? batch[0]!, status, "IncompleteDeleteResult");
          }
          throw requestFailed("delete", key, status, refused.Code);
        }
      }
    },
  };
}
