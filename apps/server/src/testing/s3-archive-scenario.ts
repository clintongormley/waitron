import { createCipheriv, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, mkdtemp, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { hasCode, isAppError } from "@waitron/shared";
import {
  createS3FileStore,
  nameOf,
  statusOf,
  type CommandObservation,
  type S3FileStoreOptions,
} from "@waitron/stream";
import { expect } from "vitest";
import {
  decodeArchiveRecoveryPack,
  encodeArchiveRecoveryPack,
  type ArchiveRecoveryPack,
} from "../archive-recovery-pack.js";
import { downloadArchive } from "../archive-download.js";
import { archiveNamespace } from "../archive-settings.js";
import { decryptArtifactFile, encryptArtifactFile } from "../artifact-cipher-file.js";
import { buildBackupBackend } from "../backup-backends.js";
import { checkedRecoveryKey } from "../backup-config.js";
import { backupArchiveKey, parseBackupArchiveKey } from "../backup-keys.js";
import type { StorageBackend } from "../storage-backend.js";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { receiptErrorName } from "./aws-rehearsal-receipt.js";
import { requestRecorder } from "./aws-request-recorder.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";

const MiB = 1024 * 1024;
/**
 * What `encryptArtifactFile` adds to the plaintext: a 33-byte header and a 16-byte tag
 * (`artifact-cipher-file.ts`); AES-GCM's ciphertext is as long as its plaintext.
 */
const CIPHER_OVERHEAD_BYTES = 49;
/** `planParts` in `packages/stream/src/s3-file-store.ts` uses its 8 MiB minimum up to 80,000 MiB. */
const PART_BYTES = 8 * MiB;
const ABORT_ARCHIVE_BYTES = 3 * PART_BYTES;
const RECOVERY_KEY = "rehearsal-synthetic-recovery-key-not-a-secret";
const WRONG_KEY = "rehearsal-synthetic-wrong-key-not-a-secret";

/** A Vitest time limit for each scenario; nothing inside it enforces this. */
export const ARCHIVE_SCENARIO_MS = 180_000;

export interface ArchiveRoundTripSummary {
  bytes: number;
  parts: number;
  partBytes: number;
}

export interface ArchiveAbortSummary {
  partsBeforeAbort: number;
  abortStatus: number | null;
  uploadsAfter: number;
}

type Recorded = {
  phase?: unknown;
  api?: unknown;
  bytes?: unknown;
  httpStatus?: unknown;
  outcome?: unknown;
};

const is2xx = (status: unknown): boolean =>
  typeof status === "number" && status >= 200 && status < 300;

/**
 * Writes `bytes` of deterministic pseudo-random bytes, AES-CTR's keystream under a key derived from
 * `seed`, and answers their SHA-256.
 */
async function writeSynthetic(path: string, bytes: number, seed: string): Promise<string> {
  const key = createHash("sha256").update(seed).digest();
  const stream = createCipheriv("aes-256-ctr", key, Buffer.alloc(16));
  const hash = createHash("sha256");
  const out = await open(path, "wx", 0o600);
  try {
    const zeros = Buffer.alloc(MiB);
    for (let written = 0; written < bytes; written += MiB) {
      const chunk = stream.update(zeros.subarray(0, Math.min(MiB, bytes - written)));
      hash.update(chunk);
      await out.write(chunk);
    }
  } finally {
    await out.close();
  }
  return hash.digest("hex");
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Writes a synthetic archive whose encrypted file is exactly `encryptedBytes` long. */
async function syntheticArchive(
  folder: string,
  encryptedBytes: number,
  seed: string,
  signal: AbortSignal,
): Promise<{ plainHash: string; path: string }> {
  const plain = join(folder, "plain.bin");
  const path = join(folder, "archive.backup.enc");
  const plainHash = await writeSynthetic(plain, encryptedBytes - CIPHER_OVERHEAD_BYTES, seed);
  await encryptArtifactFile(createReadStream(plain), path, RECOVERY_KEY, signal);
  await rm(plain);
  expect((await stat(path)).size).toBe(encryptedBytes);
  return { plainHash, path };
}

function scenarioSteps(fixture: S3ScenarioFixture, scenario: string) {
  const failed = (name: string, error: unknown): void => {
    fixture.record({
      scenario,
      phase: name,
      outcome: "failed",
      errorName: receiptErrorName(nameOf(error)),
    });
  };
  return {
    failed,
    phase(name: string, fields: object = {}): void {
      fixture.record({ scenario, phase: name, ...fields, outcome: "ok" });
    },
    async step<T>(name: string, run: () => Promise<T>): Promise<T> {
      try {
        return await run();
      } catch (error) {
        failed(name, error);
        throw error;
      }
    },
  };
}

/** Tracks the upload a CreateMultipartUpload answer names, by the bucket key it was sent for. */
function trackCreated(fixture: S3ScenarioFixture, observation: CommandObservation): void {
  if (observation.command !== "CreateMultipartUploadCommand") return;
  const uploadId = (observation.output as { UploadId?: unknown } | undefined)?.UploadId;
  const key = observation.input.Key;
  if (typeof key === "string" && typeof uploadId === "string") fixture.trackUpload(key, uploadId);
}

/** Runs `body` with a new work folder and a backend over the fixture's bucket; removes and closes both. */
async function withBackend<T>(
  fixture: S3ScenarioFixture,
  scenario: string,
  observe: S3FileStoreOptions["observe"],
  body: (backend: StorageBackend, work: string) => Promise<T>,
): Promise<T> {
  const work = await mkdtemp(join(fixture.scratch, `${scenario}-`));
  try {
    const backend = buildBackupBackend(
      { kind: "s3", id: "rehearsal", bucket: fixture.bucket, venueId: fixture.venueId },
      { observe },
    );
    try {
      return await body(backend, work);
    } finally {
      backend.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function requestsTo(requests: Recorded[], api: string): Recorded[] {
  return requests.filter((event) => event.phase === "request" && event.api === api);
}

/**
 * Uploads a 32 MiB encrypted synthetic archive through the backend, then downloads it again using
 * only a recovery pack that has been encoded and decoded, and checks its decrypted bytes match.
 * A wrong key and a flipped byte must each be refused, leaving no output file.
 */
export async function runArchiveRoundTrip(
  fixture: S3ScenarioFixture,
): Promise<ArchiveRoundTripSummary> {
  const SCENARIO = "archive-roundtrip";
  const bytes = AWS_REHEARSAL_LIMITS.archiveBytes;
  fixture.reserveUpload(bytes, "archive");
  const { signal } = fixture;
  const { phase, step, failed } = scenarioSteps(fixture, SCENARIO);
  const requests: Recorded[] = [];
  const observe = requestRecorder(
    SCENARIO,
    (event) => {
      requests.push(event as Recorded);
      fixture.record(event);
    },
    (observation) => trackCreated(fixture, observation),
  );
  return withBackend(fixture, SCENARIO, observe, async (backend, work) => {
    const recoveryKey = checkedRecoveryKey(RECOVERY_KEY)!;
    const archive = await syntheticArchive(work, bytes, SCENARIO, signal);
    const key = backupArchiveKey(new Date());
    expect(parseBackupArchiveKey(key)).not.toBeNull();

    await step("uploaded", () => backend.putFile(key, archive.path, { signal }));
    await rm(archive.path);
    const partBytes = PART_BYTES;
    const parts = bytes / PART_BYTES;
    const uploads = requestsTo(requests, "UploadPart");
    const uploadShape = [
      requestsTo(requests, "CreateMultipartUpload"),
      uploads,
      requestsTo(requests, "CompleteMultipartUpload"),
    ].map((events) =>
      events.map(({ outcome, httpStatus }) => outcome === "ok" && is2xx(httpStatus)),
    );
    expect(uploadShape).toEqual([[true], Array(parts).fill(true), [true]]);
    expect(uploads.map(({ bytes: sent }) => sent)).toEqual(Array(parts).fill(partBytes));
    phase("uploaded", { count: uploads.length, bytes });

    const listed = await step("listed", () => backend.list("waitron-", { signal }));
    const found = listed.filter((object) => object.key === key);
    expect(found.map(({ size }) => size)).toEqual([bytes]);
    phase("listed", { count: found.length, bytes: found[0]!.size });

    const saved = encodeArchiveRecoveryPack({
      version: 1,
      format: "WBK1",
      venueId: fixture.venueId,
      bucket: fixture.bucket,
      archivePrefix: archiveNamespace(fixture.bucket.prefix, fixture.venueId),
      recoveryKey,
    } satisfies ArchiveRecoveryPack);
    const pack = decodeArchiveRecoveryPack(saved);

    const downloaded = await step("downloaded", () =>
      downloadArchive({
        pack,
        key,
        stagingDir: join(work, "staging"),
        signal,
        openFiles: (bucket) => createS3FileStore(bucket, { observe }),
      }),
    );
    try {
      const gets = requestsTo(requests, "GetObject");
      expect(gets.map(({ outcome, httpStatus }) => outcome === "ok" && is2xx(httpStatus))).toEqual([
        true,
      ]);
      const got = (await stat(downloaded.path)).size;
      expect(got).toBe(bytes);
      phase("downloaded", { bytes: got });

      const out = join(work, "decrypted.bin");
      await step("decrypted-match", () =>
        decryptArtifactFile(downloaded.path, out, pack.recoveryKey),
      );
      const match = (await sha256Of(out)) === archive.plainHash;
      await rm(out);
      if (!match) failed("decrypted-match", new Error("mismatch"));
      expect(match).toBe(true);
      phase("decrypted-match");

      await refusedDecrypt(join(work, "wrong-key.bin"), () =>
        decryptArtifactFile(downloaded.path, join(work, "wrong-key.bin"), WRONG_KEY),
      );
      phase("wrong-key-refused");

      const tampered = join(work, "tampered.backup.enc");
      await copyFile(downloaded.path, tampered);
      const handle = await open(tampered, "r+");
      try {
        const middle = Math.floor(bytes / 2);
        const { buffer } = await handle.read(Buffer.alloc(1), 0, 1, middle);
        await handle.write(Buffer.from([buffer[0]! ^ 0xff]), 0, 1, middle);
      } finally {
        await handle.close();
      }
      await refusedDecrypt(join(work, "tampered.bin"), () =>
        decryptArtifactFile(tampered, join(work, "tampered.bin"), pack.recoveryKey),
      );
      await rm(tampered);
      phase("tamper-refused");
    } finally {
      await downloaded.dispose();
    }
    return { bytes, parts, partBytes };
  });
}

/** A decryption that must be refused as a wrong passphrase, leaving nothing at `out`. */
async function refusedDecrypt(out: string, decrypt: () => Promise<void>): Promise<void> {
  const error = await decrypt().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(isAppError(error) && hasCode(error, "recovery.passphrase_invalid")).toBe(true);
  expect(await exists(out)).toBe(false);
}

/**
 * Starts a 24 MiB multipart upload and cancels it once one part has been answered 2xx, then checks
 * that the store abandoned the upload: an AbortMultipartUpload was sent, no completion was, and
 * neither an unfinished upload nor an object, at any key, is left under the archive folder.
 */
export async function runArchiveAbort(fixture: S3ScenarioFixture): Promise<ArchiveAbortSummary> {
  const SCENARIO = "archive-abort";
  fixture.reserveUpload(ABORT_ARCHIVE_BYTES, "archive");
  const { phase, step, failed } = scenarioSteps(fixture, SCENARIO);
  const cancel = new AbortController();
  const signal = AbortSignal.any([fixture.signal, cancel.signal]);
  const requests: Recorded[] = [];
  const observe = requestRecorder(
    SCENARIO,
    (event) => {
      requests.push(event as Recorded);
      fixture.record(event);
    },
    (observation) => {
      trackCreated(fixture, observation);
      if (
        observation.command === "UploadPartCommand" &&
        observation.output !== undefined &&
        is2xx(statusOf(observation.output))
      ) {
        cancel.abort();
      }
    },
  );
  return withBackend(fixture, SCENARIO, observe, async (backend, work) => {
    const archive = await syntheticArchive(work, ABORT_ARCHIVE_BYTES, SCENARIO, fixture.signal);
    const key = backupArchiveKey(new Date());
    expect(parseBackupArchiveKey(key)).not.toBeNull();

    const error = await backend.putFile(key, archive.path, { signal }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    await rm(archive.path);
    if (error === undefined) {
      failed("aborted", new Error("upload completed"));
      throw new Error("the cancelled upload completed");
    }
    if (isAppError(error) && hasCode(error, "backup.destination_cleanup_failed")) {
      failed("abort-cleanup", error);
      throw error;
    }
    if (
      fixture.signal.aborted ||
      !cancel.signal.aborted ||
      !isAppError(error) ||
      !hasCode(error, "backup.destination_request_failed") ||
      error.params.name !== "AbortError"
    ) {
      failed("aborted", error);
      throw error;
    }
    fixture.record({
      scenario: SCENARIO,
      phase: "aborted",
      errorName: receiptErrorName(error.params.name),
      outcome: "ok",
    });

    const sent = requests.filter(({ phase: name }) => name === "request");
    const abortAt = sent.findIndex(({ api }) => api === "AbortMultipartUpload");
    const partsBeforeAbort = sent
      .slice(0, Math.max(abortAt, 0))
      .filter(
        ({ api, outcome, httpStatus }) =>
          api === "UploadPart" && outcome === "ok" && is2xx(httpStatus),
      ).length;
    const aborts = requestsTo(requests, "AbortMultipartUpload");
    expect(abortAt).toBeGreaterThan(-1);
    expect(partsBeforeAbort).toBeGreaterThanOrEqual(1);
    expect(aborts.map(({ outcome, httpStatus }) => outcome === "ok" && is2xx(httpStatus))).toEqual([
      true,
    ]);
    expect(requestsTo(requests, "CompleteMultipartUpload")).toEqual([]);

    const folder = archiveNamespace(fixture.bucket.prefix, fixture.venueId);
    const left = await step("uploads-after", () => fixture.ownedUploads(folder));
    phase("uploads-after", { count: left.length });
    expect(left).toEqual([]);

    // The backend lists only names directly inside the folder; this store sees deeper keys too.
    const files = createS3FileStore({ ...fixture.bucket, prefix: folder }, { observe });
    const objects = await step("listed-after", () =>
      files.list("", { signal: fixture.signal }).finally(() => files.close()),
    );
    phase("listed-after", { count: objects.length });
    expect(objects).toEqual([]);

    return {
      partsBeforeAbort,
      abortStatus: typeof aborts[0]!.httpStatus === "number" ? aborts[0]!.httpStatus : null,
      uploadsAfter: left.length,
    };
  });
}
