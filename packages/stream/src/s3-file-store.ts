import { randomUUID } from "node:crypto";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type {
  CompletedPart,
  CreateMultipartUploadCommandOutput,
  DeleteObjectsCommandOutput,
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import { loggableErrorName, type AnswerRefusal } from "./bucket-error-names.js";
import "./errors.js";
import type { DestinationCleanup, DestinationOperation } from "./errors.js";
import { normalisePrefix } from "./names.js";
import {
  createBucketClient,
  nameOf,
  statusOf,
  type BucketConfig,
  type S3ObjectStoreOptions,
} from "./s3-client.js";
import { DELETE_CONCURRENCY } from "./s3-store.js";
import { abortableSleep, eachUntilFailure, sendUnlessCancelled } from "./store-call.js";

/** The caller's way to stop one call; every call takes one. */
export interface FileCall {
  signal: AbortSignal;
}

export interface ListedFile {
  /** Relative to the configured prefix. */
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * Whole files to and from a bucket. An upload reads its file range by range as it sends it, rather
 * than holding it (`s3-file-store.disk.test.ts`). Keys are relative to the configured prefix and
 * checked before any file or request. A failure talking to the bucket is
 * `backup.destination_request_failed` (the other refusals are in `errors.ts`); a failure reading or
 * writing a local file is passed on as the file system's own error.
 */
export interface S3FileStore {
  /**
   * After a failure that may have left something in the bucket, abandons this call's own multipart
   * upload, and deletes `key` when the bucket may have stored it, so `key` must be one nothing else
   * holds.
   */
  putFile(key: string, path: string, call: FileCall): Promise<void>;
  /** Replaces `outPath` only once the whole object has arrived; a file system error is passed on. */
  getFile(key: string, outPath: string, call: FileCall): Promise<void>;
  /** The object's body, destroyed when the signal is cancelled. */
  readStream(key: string, call: FileCall): Promise<Readable>;
  /**
   * Every object under `prefix`, across every page. A listed key outside `prefix` refuses the whole
   * listing; a key inside it is returned whatever its shape, for the caller's own naming rules.
   */
  list(prefix: string, call: FileCall): Promise<ListedFile[]>;
  /** As `ObjectStore.deleteMany`. */
  deleteMany(keys: string[], call: FileCall): Promise<void>;
  close(): void;
}

export interface S3FileStoreOptions extends S3ObjectStoreOptions {
  /** Replaces {@link CLEANUP_MS}. Tests only. */
  cleanupMs?: number;
}

const MiB = 1024 * 1024;
/** A file up to this size goes up in one request. */
const SINGLE_PUT_MAX_BYTES = 8 * MiB;
const MIN_PART_BYTES = 8 * MiB;
const MAX_PART_BYTES = 64 * MiB;
/** S3's own limit: "Part numbers can be any number from 1 to 10,000, inclusive" (API_UploadPart). */
const MAX_PARTS = 10_000;
/** Attempts at sending a body read from the file, the first included. */
const ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 200;
/** How long cleanup after a failed upload may take, counted from the failure. */
const CLEANUP_MS = 10_000;
const DELETE_BATCH_KEYS = 1000;

// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function isSafeKey(key: string): boolean {
  if (key === "" || CONTROL.test(key)) return false;
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isSafePrefix(prefix: string): boolean {
  return prefix === "" || isSafeKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}

function keyInvalid(field: "key" | "prefix" | "listedKey"): AppError {
  return new AppError("backup.destination_key_invalid", { field });
}

function requestFailed(
  operation: DestinationOperation,
  key: string,
  status: number | null,
  name: string,
): AppError {
  return new AppError("backup.destination_request_failed", {
    operation,
    key,
    status,
    name: loggableErrorName(name),
  });
}

function cancelled(operation: DestinationOperation, key: string): AppError {
  return requestFailed(operation, key, null, "AbortError");
}

/** Once the signal is cancelled, any failure is reported as the cancellation. */
function failure(
  signal: AbortSignal,
  operation: DestinationOperation,
  key: string,
  error: unknown,
): AppError {
  if (signal.aborted) return cancelled(operation, key);
  return requestFailed(operation, key, statusOf(error), nameOf(error));
}

function answerRefused(
  operation: DestinationOperation,
  key: string,
  status: number | undefined,
  name: AnswerRefusal,
): AppError {
  return requestFailed(operation, key, status ?? null, name);
}

/** Part size and count for a multipart upload of `bytes`. */
export function planParts(bytes: number): { partBytes: number; parts: number } {
  const partBytes = Math.min(
    MAX_PART_BYTES,
    Math.max(MIN_PART_BYTES, Math.ceil(bytes / MAX_PARTS)),
  );
  const parts = Math.ceil(bytes / partBytes);
  if (parts > MAX_PARTS) {
    throw new AppError("backup.destination_too_large", {
      bytes,
      maxBytes: MAX_PARTS * MAX_PART_BYTES,
    });
  }
  return { partBytes, parts };
}

const READ_CHUNK_BYTES = 64 * 1024;

/** A fresh read of `length` bytes at `start`, leaving the handle open for the next range. */
function rangeOf(handle: FileHandle, start: number, length: number): Readable {
  const end = start + length;
  let position = start;
  return new Readable({
    highWaterMark: READ_CHUNK_BYTES,
    read() {
      const want = Math.min(READ_CHUNK_BYTES, end - position);
      if (want === 0) {
        this.push(null);
        return;
      }
      handle
        .read(Buffer.allocUnsafe(want), 0, want, position)
        .then(({ bytesRead, buffer }) => {
          // Sending fewer bytes than the stated length would leave the request waiting.
          if (bytesRead === 0) throw new Error("the file is shorter than when its upload began");
          position += bytesRead;
          this.push(buffer.subarray(0, bytesRead));
        })
        .catch((error: unknown) => this.destroy(error as Error));
    },
  });
}

export function createS3FileStore(
  config: BucketConfig,
  options: S3FileStoreOptions = {},
): S3FileStore {
  const root = normalisePrefix(config.prefix);
  if (!isSafePrefix(root)) throw keyInvalid("prefix");
  // On @aws-sdk/client-s3 3.1140.0 the default setting sent a file's stream `aws-chunked`, with a
  // checksum trailer and no stated length; this one sends the bytes as they are under their length
  // ("goes up in one request that states its length", `s3-file-store.upload.test.ts`).
  const client = createBucketClient(config, options, {
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const wait = options.sleep ?? abortableSleep;
  const cleanupMs = options.cleanupMs ?? CLEANUP_MS;
  const bucket = config.bucket;
  const at = (key: string) => root + key;

  /**
   * Sends a body read from the file, reading the range afresh for each attempt: the client does not
   * send a stream twice. Awaits the request itself, so the read has stopped when this returns.
   * `uncertain` is called for each attempt the bucket may have acted on.
   */
  async function sendRange<T>(
    operation: DestinationOperation,
    key: string,
    signal: AbortSignal,
    range: { handle: FileHandle; start: number; length: number },
    send: (body: Readable, abortSignal: AbortSignal) => Promise<T>,
    uncertain: () => void = () => {},
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw cancelled(operation, key);
      const body = rangeOf(range.handle, range.start, range.length);
      // Without this, a request whose body failed to read was still unsettled 8 s later in the
      // shrinking-file case of `s3-file-store.upload.test.ts`, so a read error stops the request.
      const readFailed = new AbortController();
      let readError: Error | undefined;
      body.once("error", (error) => {
        readError = error;
        readFailed.abort();
      });
      try {
        return await send(body, AbortSignal.any([signal, readFailed.signal]));
      } catch (error) {
        if (readError !== undefined && !signal.aborted) throw readError;
        const status = statusOf(error);
        if (signal.aborted || status === null || status >= 500) uncertain();
        if (signal.aborted) throw cancelled(operation, key);
        const retryable = status === null || status >= 500 || status === 429;
        if (!retryable || attempt === ATTEMPTS)
          throw requestFailed(operation, key, status, nameOf(error));
        await wait(RETRY_BACKOFF_MS * attempt, signal);
      } finally {
        body.destroy();
      }
    }
  }

  type CleanupSend = (abortSignal: AbortSignal | undefined) => Promise<unknown>;

  /**
   * Runs `steps` side by side on one signal of their own, cancelled `cleanupMs` after they start,
   * answering every step left unresolved, in the order given, or null.
   */
  async function cleanUp(
    key: string,
    steps: [DestinationCleanup, CleanupSend][],
  ): Promise<AppError | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cleanupMs);
    try {
      const outcomes = await Promise.all(
        steps.map(async ([cleanup, send]) => {
          try {
            await sendUnlessCancelled(send, controller.signal, "delete", key);
            return null;
          } catch (error) {
            const name = nameOf(error);
            const timedOut = controller.signal.aborted;
            // Already gone: completed or abandoned for an upload; never stored, or deleted, for a key.
            if (!timedOut && (name === "NoSuchUpload" || name === "NoSuchKey")) return null;
            return {
              cleanup,
              status: timedOut ? null : statusOf(error),
              name: loggableErrorName(timedOut ? "AbortError" : name),
            };
          }
        }),
      );
      const unresolved = outcomes.filter((outcome) => outcome !== null);
      if (unresolved.length === 0) return null;
      return new AppError("backup.destination_cleanup_failed", { key, unresolved });
    } finally {
      clearTimeout(timer);
    }
  }

  const deleteStep = (key: string): [DestinationCleanup, CleanupSend] => [
    "delete_object",
    (abortSignal) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: at(key) }), { abortSignal }),
  ];

  async function putWhole(key: string, handle: FileHandle, size: number, signal: AbortSignal) {
    let mayBeStored = false;
    try {
      await sendRange(
        "put",
        key,
        signal,
        { handle, start: 0, length: size },
        (body, abortSignal) =>
          client.send(
            new PutObjectCommand({ Bucket: bucket, Key: at(key), Body: body, ContentLength: size }),
            { abortSignal },
          ),
        () => (mayBeStored = true),
      );
    } catch (error) {
      if (mayBeStored) throw (await cleanUp(key, [deleteStep(key)])) ?? error;
      throw error;
    }
  }

  async function putInParts(key: string, handle: FileHandle, size: number, signal: AbortSignal) {
    const { partBytes, parts } = planParts(size);
    let created: CreateMultipartUploadCommandOutput;
    try {
      created = await sendUnlessCancelled(
        (abortSignal) =>
          client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: at(key) }), {
            abortSignal,
          }),
        signal,
        "put",
        key,
      );
    } catch (error) {
      throw failure(signal, "create_upload", key, error);
    }
    const UploadId = created.UploadId;
    if (UploadId === undefined)
      throw answerRefused(
        "create_upload",
        key,
        created.$metadata.httpStatusCode,
        "IncompleteResponse",
      );
    let completing = false;
    try {
      const done: CompletedPart[] = [];
      for (let PartNumber = 1; PartNumber <= parts; PartNumber += 1) {
        const start = (PartNumber - 1) * partBytes;
        const length = Math.min(partBytes, size - start);
        const out = await sendRange(
          "upload_part",
          key,
          signal,
          { handle, start, length },
          (body, abortSignal) =>
            client.send(
              new UploadPartCommand({
                Bucket: bucket,
                Key: at(key),
                UploadId,
                PartNumber,
                Body: body,
                ContentLength: length,
              }),
              { abortSignal },
            ),
        );
        if (out.ETag === undefined)
          throw answerRefused("upload_part", key, out.$metadata.httpStatusCode, "MissingETag");
        done.push({ PartNumber, ETag: out.ETag });
      }
      completing = true;
      try {
        await sendUnlessCancelled(
          (abortSignal) =>
            client.send(
              new CompleteMultipartUploadCommand({
                Bucket: bucket,
                Key: at(key),
                UploadId,
                MultipartUpload: { Parts: done },
              }),
              { abortSignal },
            ),
          signal,
          "put",
          key,
        );
      } catch (error) {
        throw failure(signal, "complete_upload", key, error);
      }
    } catch (error) {
      const abandon: [DestinationCleanup, CleanupSend] = [
        "abort_upload",
        (abortSignal) =>
          client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: at(key), UploadId }), {
            abortSignal,
          }),
      ];
      // A completion that failed may still have stored the object, as when its answer is lost.
      throw (await cleanUp(key, completing ? [abandon, deleteStep(key)] : [abandon])) ?? error;
    }
  }

  async function getBody(key: string, signal: AbortSignal): Promise<Readable> {
    try {
      const out = await sendUnlessCancelled(
        (abortSignal) =>
          client.send(new GetObjectCommand({ Bucket: bucket, Key: at(key) }), { abortSignal }),
        signal,
        "get",
        key,
        (late: GetObjectCommandOutput) => (late.Body as Readable).destroy(),
      );
      return out.Body as Readable;
    } catch (error) {
      throw failure(signal, "get", key, error);
    }
  }

  async function deleteOne(key: string, signal: AbortSignal): Promise<void> {
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
    async putFile(key, path, { signal }) {
      if (!isSafeKey(key)) throw keyInvalid("key");
      if (signal.aborted) throw cancelled("put", key);
      const handle = await open(path, "r");
      try {
        const { size } = await handle.stat();
        if (size <= SINGLE_PUT_MAX_BYTES) await putWhole(key, handle, size, signal);
        else await putInParts(key, handle, size, signal);
      } finally {
        await handle.close();
      }
    },

    async getFile(key, outPath, { signal }) {
      if (!isSafeKey(key)) throw keyInvalid("key");
      const body = await getBody(key, signal);
      const partial = join(dirname(outPath), `.${basename(outPath)}.${randomUUID()}.part`);
      const stop = () => body.destroy();
      signal.addEventListener("abort", stop, { once: true });
      // A cancellation after the answer and before this listener has no event left to fire.
      if (signal.aborted) stop();
      let handle: FileHandle | undefined;
      try {
        handle = await open(partial, "wx", 0o600);
        const chunks = body[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
        for (;;) {
          let next: IteratorResult<Buffer>;
          try {
            next = await chunks.next();
          } catch (error) {
            throw failure(signal, "get", key, error);
          }
          if (next.done) break;
          for (let offset = 0; offset < next.value.length;) {
            const { bytesWritten } = await handle.write(next.value, offset);
            offset += bytesWritten;
          }
        }
        await handle.sync();
        await handle.close();
        handle = undefined;
        if (signal.aborted) throw cancelled("get", key);
        await rename(partial, outPath);
      } catch (error) {
        body.destroy();
        await handle?.close();
        await rm(partial, { force: true });
        if (signal.aborted) throw cancelled("get", key);
        throw error;
      } finally {
        signal.removeEventListener("abort", stop);
      }
    },

    async readStream(key, { signal }) {
      if (!isSafeKey(key)) throw keyInvalid("key");
      const body = await getBody(key, signal);
      // Only the body's read is caught: the stream's own destroy throws its error in at the `yield`,
      // and a different error thrown back reaches the reader as an AggregateError of the two.
      async function* relay() {
        const chunks = body[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
        for (;;) {
          let next: IteratorResult<Buffer>;
          try {
            next = await chunks.next();
          } catch (error) {
            throw failure(signal, "get", key, error);
          }
          if (next.done) return;
          yield next.value;
        }
      }
      const stream = Readable.from(relay(), { objectMode: false });
      // A cancellation can destroy the stream before its caller listens for errors; without a
      // listener of its own, that error would be uncaught. The caller's listeners still get it.
      stream.on("error", () => {});
      const stop = () => {
        body.destroy();
        stream.destroy(cancelled("get", key));
      };
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      stream.once("close", () => {
        signal.removeEventListener("abort", stop);
        body.destroy();
      });
      return stream;
    },

    // Retention deletes what this answers, so a page that cannot be complete, or names a key
    // outside the prefix asked for, refuses the whole listing rather than trimming it.
    async list(prefix, { signal }) {
      if (!isSafePrefix(prefix)) throw keyInvalid("prefix");
      const wanted = at(prefix);
      const found: ListedFile[] = [];
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
          answerRefused("list", prefix, page.$metadata.httpStatusCode, name);
        for (const object of page.Contents ?? []) {
          if (
            object.Key === undefined ||
            object.LastModified === undefined ||
            object.Size === undefined
          )
            throw refuse("IncompleteListing");
          if (!object.Key.startsWith(wanted)) throw keyInvalid("listedKey");
          found.push({
            key: object.Key.slice(root.length),
            size: object.Size,
            lastModified: object.LastModified,
          });
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

    // Batches go one at a time, so a failed one stops the rest with nothing else in flight.
    async deleteMany(keys, { signal }) {
      if (!keys.every(isSafeKey)) throw keyInvalid("key");
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
          // As `s3-store.ts`: only 501, "does not support the functionality required", falls back.
          if (!signal.aborted && statusOf(error) === 501) {
            await eachUntilFailure(
              batch,
              DELETE_CONCURRENCY,
              (key) => deleteOne(key, signal),
              signal,
            );
            if (signal.aborted) throw cancelled("delete", batch[0]!);
            continue;
          }
          throw failure(signal, "delete", batch[0]!, error);
        }
        const refused = out.Errors?.[0];
        if (refused !== undefined) {
          const key = batch.find((candidate) => at(candidate) === refused.Key);
          if (key === undefined || !refused.Code)
            throw answerRefused(
              "delete",
              key ?? batch[0]!,
              out.$metadata.httpStatusCode,
              "IncompleteDeleteResult",
            );
          throw requestFailed("delete", key, out.$metadata.httpStatusCode ?? null, refused.Code);
        }
      }
    },

    close() {
      client.destroy();
    },
  };
}
