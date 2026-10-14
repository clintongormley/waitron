import { S3Client } from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { AppError } from "@waitron/shared";
import { loggableErrorName, type AnswerRefusal } from "./bucket-error-names.js";
import "./errors.js";
import type { BucketOperation } from "./errors.js";

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
  /** Replaces the network, and with it {@link BUCKET_IDLE_MS}. Tests only. */
  requestHandler?: S3ClientConfig["requestHandler"];
  /** Replaces the wait between conflict retries. Tests only. */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** Replaces {@link BUCKET_IDLE_MS}. Tests only. */
  idleMs?: number;
  /**
   * Told of each command that reaches the client's `initialize` step, once its attempts end.
   * Rehearsals only. An observer that throws fails the command with what it threw.
   */
  observe?: (observation: CommandObservation) => void;
}

export interface CommandObservation {
  /** The SDK's command name, such as "UploadPartCommand". */
  command: string;
  input: Readonly<Record<string, unknown>>;
  /** Exactly one of output and error is set. */
  output?: unknown;
  error?: unknown;
  elapsedMs: number;
}

/**
 * The handler's `socketTimeout`. A request that gets no reply is given up, and the client makes
 * three attempts in all. An answer whose headers arrive within the first three seconds and whose
 * body then stalls is not given up by this limit: at this size the handler sets the limit three
 * seconds into the request, so headers that arrive before then cancel it before it is set; once
 * set, it stays for the rest of the request. A caller's signal stops such a call and closes its
 * connection, on this handler too (`s3-store.cancel.test.ts`). `requestTimeout` is not used because
 * it stops counting at the headers and only warns unless `throwOnRequestTimeout` is set.
 * Thirty seconds keeps the three attempts inside the stream's five-minute read deadline
 * (`READ_DEADLINE_MS`, `./supervisor.ts`). Receipts: #676.
 */
const BUCKET_IDLE_MS = 30_000;

export function createBucketClient(
  config: BucketConfig,
  options: S3ObjectStoreOptions = {},
  checksums: Pick<S3ClientConfig, "requestChecksumCalculation"> = {},
): S3Client {
  const client = new S3Client({
    ...checksums,
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    // Litestream's own rule, from its configuration reference: path style "is automatically enabled
    // if endpoint is set".
    forcePathStyle: config.endpoint !== undefined,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestHandler: options.requestHandler ?? { socketTimeout: options.idleMs ?? BUCKET_IDLE_MS },
    maxAttempts: 3,
  });
  const observe = options.observe;
  if (observe !== undefined) {
    // At "initialize" it sees one answer after the retries ("reports a retried command once",
    // `s3-client.observe.test.ts`).
    client.middlewareStack.add(
      (next, context) => async (args) => {
        const command = String(context.commandName);
        const input = args.input as Record<string, unknown>;
        const started = performance.now();
        let result: Awaited<ReturnType<typeof next>>;
        try {
          result = await next(args);
        } catch (error) {
          observe({ command, input, error, elapsedMs: performance.now() - started });
          throw error;
        }
        observe({ command, input, output: result.output, elapsedMs: performance.now() - started });
        return result;
      },
      { step: "initialize", name: "observeCommand" },
    );
  }
  return client;
}

export function statusOf(error: unknown): number | null {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return typeof status === "number" ? status : null;
}

export function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "Unknown";
}

// Vetted here because callers log these params, and answer them over HTTP, as they are.
export function requestFailed(
  operation: BucketOperation,
  key: string,
  status: number | null,
  name: string,
): AppError {
  return new AppError("backup.stream_request_failed", {
    operation,
    key,
    status,
    name: loggableErrorName(name),
  });
}

export function answerRefused(
  operation: BucketOperation,
  key: string,
  status: number | null,
  name: AnswerRefusal,
): AppError {
  return requestFailed(operation, key, status, name);
}
