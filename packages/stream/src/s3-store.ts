import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  DeleteObjectsCommandOutput,
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
  PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import type { AnswerRefusal } from "./bucket-error-names.js";
import "./errors.js";
import type { BucketOperation } from "./errors.js";
import { normalisePrefix, strayListedKey } from "./names.js";
import type { ListedObject, ObjectStore, PutCondition } from "./object-store.js";
import {
  answerRefused,
  createBucketClient,
  nameOf,
  requestFailed,
  statusOf,
  type BucketConfig,
  type S3ObjectStoreOptions,
} from "./s3-client.js";
import {
  abortableSleep,
  callCancelled,
  eachUntilFailure,
  sendUnlessCancelled,
  throwIfCancelled,
} from "./store-call.js";

export type { BucketConfig, S3ObjectStoreOptions } from "./s3-client.js";

/** S3's own limit: "The request can contain a list of up to 1,000 keys" (API_DeleteObjects). */
const DELETE_BATCH_KEYS = 1000;
/** How many single deletes are in flight at once where the store has no multi-object delete. */
export const DELETE_CONCURRENCY = 8;

/** How many times a write answered "conflict" is sent in all before it is reported as failed. */
export const CONFLICT_ATTEMPTS = 5;
const CONFLICT_BACKOFF_MS = 200;

function conditionHeaders(condition: PutCondition | undefined): {
  IfMatch?: string;
  IfNoneMatch?: string;
} {
  if (condition === undefined) return {};
  return "ifMatch" in condition
    ? { IfMatch: condition.ifMatch }
    : { IfNoneMatch: condition.ifNoneMatch };
}

/** Once the signal is cancelled, any failure is reported as the cancellation. */
function failure(
  signal: AbortSignal | undefined,
  operation: BucketOperation,
  key: string,
  error: unknown,
): AppError {
  if (signal?.aborted) return callCancelled(operation, key);
  return requestFailed(operation, key, statusOf(error), nameOf(error));
}

function bodyOf(out: GetObjectCommandOutput) {
  return out.Body as (NonNullable<typeof out.Body> & { destroy(error?: Error): void }) | undefined;
}

export function createS3ObjectStore(
  config: BucketConfig,
  options: S3ObjectStoreOptions = {},
): ObjectStore {
  const client = createBucketClient(config, options);
  const wait = options.sleep ?? abortableSleep;
  const bucket = config.bucket;
  const root = normalisePrefix(config.prefix);
  const at = (key: string) => root + key;

  async function deleteOne(key: string, signal: AbortSignal | undefined): Promise<void> {
    try {
      await sendUnlessCancelled(
        (abortSignal) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: at(key) }), { abortSignal }),
        signal,
        "delete",
        key,
      );
    } catch (error) {
      throw failure(signal, "delete", key, error);
    }
  }

  return {
    async get(key, call) {
      const signal = call?.signal;
      let out: GetObjectCommandOutput;
      try {
        out = await sendUnlessCancelled(
          (abortSignal) =>
            client.send(new GetObjectCommand({ Bucket: bucket, Key: at(key) }), { abortSignal }),
          signal,
          "get",
          key,
          (late) => bodyOf(late)?.destroy(),
        );
      } catch (error) {
        if (signal?.aborted) throw callCancelled("get", key);
        // By name: a missing bucket also answers 404, and must never read as "nothing written yet".
        if (nameOf(error) === "NoSuchKey") return null;
        throw requestFailed("get", key, statusOf(error), nameOf(error));
      }
      // A body left unread holds its connection open, so every failure from here destroys it.
      const body = bodyOf(out);
      if (body === undefined || out.ETag === undefined) {
        body?.destroy();
        throw answerRefused("get", key, out.$metadata.httpStatusCode ?? null, "IncompleteResponse");
      }
      const stop = () => body.destroy(callCancelled("get", key));
      signal?.addEventListener("abort", stop, { once: true });
      try {
        throwIfCancelled(signal, "get", key);
        return { body: await body.transformToByteArray(), etag: out.ETag };
      } catch (error) {
        body.destroy();
        if (signal?.aborted) throw callCancelled("get", key);
        // Reported with no status, so callers treat a body that broke off as no answer, not a refusal.
        throw requestFailed("get", key, null, nameOf(error));
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },

    async put(key, body, condition, call) {
      const signal = call?.signal;
      for (let attempt = 1; ; attempt += 1) {
        let out: PutObjectCommandOutput;
        try {
          out = await sendUnlessCancelled(
            (abortSignal) =>
              client.send(
                new PutObjectCommand({
                  Bucket: bucket,
                  Key: at(key),
                  Body: body,
                  ...conditionHeaders(condition),
                }),
                { abortSignal },
              ),
            signal,
            "put",
            key,
          );
        } catch (error) {
          if (signal?.aborted) throw callCancelled("put", key);
          const status = statusOf(error);
          if (status === 412) throw new AppError("backup.stream_precondition_failed", { key });
          // A conflict is a concurrent request on the same object, not a verdict, and is sent again
          // with the caller's condition unchanged. Re-reading the version first would turn
          // "only if unchanged since I read it" into "whatever is there now".
          if (status === 409 && attempt < CONFLICT_ATTEMPTS) {
            await wait(CONFLICT_BACKOFF_MS * attempt, signal);
            continue;
          }
          throw requestFailed("put", key, status, nameOf(error));
        }
        if (out.ETag === undefined)
          throw answerRefused("put", key, out.$metadata.httpStatusCode ?? null, "MissingETag");
        return { etag: out.ETag };
      }
    },

    // Pruning deletes what this answers, so an answer that cannot be complete, or names a key outside
    // the prefix asked for, is refused whole rather than trimmed.
    async list(prefix, call) {
      const signal = call?.signal;
      const wanted = at(prefix);
      const found: ListedObject[] = [];
      const followed = new Set<string>();
      let token: string | undefined;
      do {
        let page: ListObjectsV2CommandOutput;
        try {
          page = await sendUnlessCancelled(
            (abortSignal) =>
              client.send(
                new ListObjectsV2Command({
                  Bucket: bucket,
                  Prefix: wanted,
                  ContinuationToken: token,
                }),
                { abortSignal },
              ),
            signal,
            "list",
            prefix,
          );
        } catch (error) {
          throw failure(signal, "list", prefix, error);
        }
        const refuse = (name: AnswerRefusal) =>
          answerRefused("list", prefix, page.$metadata.httpStatusCode ?? null, name);
        for (const object of page.Contents ?? []) {
          if (object.Key === undefined || object.LastModified === undefined)
            throw refuse("IncompleteListing");
          if (!object.Key.startsWith(wanted)) throw strayListedKey();
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

    delete: (key, call) => deleteOne(key, call?.signal),

    // Batches go one at a time, so a failed one stops the rest with nothing else in flight.
    async deleteMany(keys, call) {
      const signal = call?.signal;
      for (let start = 0; start < keys.length; start += DELETE_BATCH_KEYS) {
        const batch = keys.slice(start, start + DELETE_BATCH_KEYS);
        let out: DeleteObjectsCommandOutput;
        try {
          out = await sendUnlessCancelled(
            (abortSignal) =>
              client.send(
                new DeleteObjectsCommand({
                  Bucket: bucket,
                  Delete: { Objects: batch.map((key) => ({ Key: at(key) })), Quiet: true },
                }),
                { abortSignal },
              ),
            signal,
            "delete",
            batch[0]!,
          );
        } catch (error) {
          // 501 is HTTP's "does not support the functionality required" (RFC 9110 §15.6.2). Any other
          // refusal of the batch fails the delete; which providers answer what is not established here.
          if (!signal?.aborted && statusOf(error) === 501) {
            await eachUntilFailure(
              batch,
              DELETE_CONCURRENCY,
              (key) => deleteOne(key, signal),
              signal,
            );
            throwIfCancelled(signal, "delete", batch[0]!);
            continue;
          }
          throw failure(signal, "delete", batch[0]!, error);
        }
        // A quiet answer lists only the keys it did not delete, inside a request that succeeded.
        const refused = out.Errors?.[0];
        if (refused !== undefined) {
          const status = out.$metadata.httpStatusCode ?? null;
          const key = batch.find((candidate) => at(candidate) === refused.Key);
          if (key === undefined || !refused.Code) {
            throw answerRefused("delete", key ?? batch[0]!, status, "IncompleteDeleteResult");
          }
          throw requestFailed("delete", key, status, refused.Code);
        }
      }
    },
  };
}
