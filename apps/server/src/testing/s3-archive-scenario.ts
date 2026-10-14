import { createCipheriv, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { hasCode, isAppError } from "@waitron/shared";
import { createS3FileStore, statusOf, type CommandObservation } from "@waitron/stream";
import { expect } from "vitest";
import {
  decodeArchiveRecoveryPack,
  encodeArchiveRecoveryPack,
  type ArchiveRecoveryPack,
} from "../archive-recovery-pack.js";
import { downloadArchive } from "../archive-download.js";
import { archiveNamespace } from "../archive-settings.js";
import { ARTIFACT_HEADER_BYTES } from "../artifact-cipher.js";
import { decryptArtifactFile, encryptArtifactFile } from "../artifact-cipher-file.js";
import { checkedRecoveryKey } from "../backup-config.js";
import { backupArchiveKey, parseBackupArchiveKey } from "../backup-keys.js";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { receiptErrorName } from "./aws-rehearsal-receipt.js";
import type { S3ScenarioFixture } from "./s3-scenario-fixture.js";
import { answered2xx, is2xx, scenarioSteps } from "./s3-scenario-steps.js";

const MiB = 1024 * 1024;
/** `planParts` in `packages/stream/src/s3-file-store.ts` uses its 8 MiB minimum up to 80,000 MiB. */
const PART_BYTES = 8 * MiB;
const ABORT_ARCHIVE_BYTES = 3 * PART_BYTES;
const RECOVERY_KEY = "rehearsal-synthetic-recovery-key-not-a-secret";
const WRONG_KEY = "rehearsal-synthetic-wrong-key-not-a-secret";

/** A Vitest time limit for each scenario; nothing inside it enforces this. */
export const ARCHIVE_SCENARIO_MS = 180_000;

export interface ArchiveAbortSummary {
  /** UploadPart requests answered 2xx before the AbortMultipartUpload was sent. */
  partsBeforeAbort: number;
  abortStatus: number;
}

/**
 * `bytes` of deterministic pseudo-random bytes, AES-CTR's keystream under a key derived from `seed`;
 * `digest()` answers their SHA-256 once every chunk has been read.
 */
function syntheticPlaintext(bytes: number, seed: string) {
  const key = createHash("sha256").update(seed).digest();
  const stream = createCipheriv("aes-256-ctr", key, Buffer.alloc(16));
  const hash = createHash("sha256");
  async function* chunks(): AsyncGenerator<Buffer> {
    const zeros = Buffer.alloc(MiB);
    for (let made = 0; made < bytes; made += MiB) {
      const chunk = stream.update(zeros.subarray(0, Math.min(MiB, bytes - made)));
      hash.update(chunk);
      yield chunk;
    }
  }
  return { chunks: chunks(), digest: () => hash.digest("hex") };
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
  const path = join(folder, "archive.backup.enc");
  const plain = syntheticPlaintext(encryptedBytes - ARTIFACT_HEADER_BYTES, seed);
  await encryptArtifactFile(plain.chunks, path, RECOVERY_KEY, signal);
  expect((await stat(path)).size).toBe(encryptedBytes);
  return { plainHash: plain.digest(), path };
}

/** Tracks the upload a CreateMultipartUpload answer names, by the bucket key it was sent for. */
function trackCreated(fixture: S3ScenarioFixture, observation: CommandObservation): void {
  if (observation.command !== "CreateMultipartUploadCommand") return;
  const uploadId = (observation.output as { UploadId?: unknown } | undefined)?.UploadId;
  const key = observation.input.Key;
  if (typeof key === "string" && typeof uploadId === "string") fixture.trackUpload(key, uploadId);
}

/**
 * Uploads a 32 MiB encrypted synthetic archive through the backend, then downloads it again using
 * only a recovery pack that has been encoded and decoded, and checks its decrypted bytes match.
 * A wrong key and a flipped byte must each be refused, leaving no output file.
 */
export async function runArchiveRoundTrip(fixture: S3ScenarioFixture): Promise<void> {
  const SCENARIO = "archive-roundtrip";
  const bytes = AWS_REHEARSAL_LIMITS.archiveBytes;
  fixture.reserveUpload(bytes, "archive");
  const { signal } = fixture;
  const { phase, step, observe, requestsTo, withBackend } = scenarioSteps(
    fixture,
    SCENARIO,
    (observation) => trackCreated(fixture, observation),
  );
  await withBackend(async (backend, work) => {
    const recoveryKey = checkedRecoveryKey(RECOVERY_KEY)!;
    const key = backupArchiveKey(new Date());
    const plainHash = await step("uploaded", async () => {
      const archive = await syntheticArchive(work, bytes, SCENARIO, signal);
      expect(parseBackupArchiveKey(key)).not.toBeNull();
      await backend.putFile(key, archive.path, { signal });
      await rm(archive.path);
      const parts = requestsTo("UploadPart");
      expect(requestsTo("CreateMultipartUpload").map(answered2xx)).toEqual([true]);
      expect(parts.map(answered2xx).every(Boolean)).toBe(true);
      expect(parts.map(({ bytes: sent }) => sent)).toEqual(
        Array(bytes / PART_BYTES).fill(PART_BYTES),
      );
      expect(requestsTo("CompleteMultipartUpload").map(answered2xx)).toEqual([true]);
      const sent = parts.reduce((sum, { bytes: part }) => sum + (part as number), 0);
      phase("uploaded", { count: parts.length, bytes: sent });
      return archive.plainHash;
    });

    await step("listed", async () => {
      const listed = await backend.list("waitron-", { signal });
      const found = listed.filter((object) => object.key === key);
      expect(found.map(({ size }) => size)).toEqual([bytes]);
      phase("listed", { count: found.length, bytes: found[0]!.size });
    });

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
      await step("downloaded", async () => {
        expect(requestsTo("GetObject").map(answered2xx)).toEqual([true]);
        const got = (await stat(downloaded.path)).size;
        expect(got).toBe(bytes);
        phase("downloaded", { bytes: got });
      });

      await step("decrypted-match", async () => {
        const out = join(work, "decrypted.bin");
        await decryptArtifactFile(downloaded.path, out, pack.recoveryKey);
        const decrypted = await sha256Of(out);
        await rm(out);
        expect(decrypted).toBe(plainHash);
        phase("decrypted-match");
      });

      await step("wrong-key-refused", async () => {
        await refusedDecrypt(join(work, "wrong-key.bin"), (out) =>
          decryptArtifactFile(downloaded.path, out, WRONG_KEY),
        );
        phase("wrong-key-refused");
      });

      await step("tamper-refused", async () => {
        // Nothing reads the staged download after this step, so the byte is flipped in it, not in a copy.
        const handle = await open(downloaded.path, "r+");
        try {
          const middle = Math.floor(bytes / 2);
          const { buffer } = await handle.read(Buffer.alloc(1), 0, 1, middle);
          await handle.write(Buffer.from([buffer[0]! ^ 0xff]), 0, 1, middle);
        } finally {
          await handle.close();
        }
        await refusedDecrypt(join(work, "tampered.bin"), (out) =>
          decryptArtifactFile(downloaded.path, out, pack.recoveryKey),
        );
        phase("tamper-refused");
      });
    } finally {
      await downloaded.dispose();
    }
  });
}

/** A decryption that must be refused as a wrong passphrase, leaving nothing at `out`. */
async function refusedDecrypt(out: string, decrypt: (out: string) => Promise<void>): Promise<void> {
  const error = await decrypt(out).then(
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
  const cancel = new AbortController();
  const signal = AbortSignal.any([fixture.signal, cancel.signal]);
  const { phase, step, observe, requests, requestsTo, withBackend } = scenarioSteps(
    fixture,
    SCENARIO,
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
  return withBackend(async (backend, work) => {
    const error = await step("aborted", async () => {
      const archive = await syntheticArchive(work, ABORT_ARCHIVE_BYTES, SCENARIO, fixture.signal);
      const key = backupArchiveKey(new Date());
      expect(parseBackupArchiveKey(key)).not.toBeNull();
      const thrown = await backend.putFile(key, archive.path, { signal }).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      await rm(archive.path);
      return thrown;
    });
    await step("abort-cleanup", () => {
      if (isAppError(error) && hasCode(error, "backup.destination_cleanup_failed")) throw error;
    });
    const summary = await step("aborted", () => {
      if (error === undefined) throw new Error("the cancelled upload completed");
      if (
        fixture.signal.aborted ||
        !cancel.signal.aborted ||
        !isAppError(error) ||
        !hasCode(error, "backup.destination_request_failed") ||
        error.params.name !== "AbortError"
      ) {
        throw error;
      }
      const sent = requests.filter(({ phase: name }) => name === "request");
      const abortAt = sent.findIndex(({ api }) => api === "AbortMultipartUpload");
      expect(abortAt).toBeGreaterThan(-1);
      const partsBeforeAbort = sent
        .slice(0, abortAt)
        .filter((event) => event.api === "UploadPart" && answered2xx(event)).length;
      expect(partsBeforeAbort).toBeGreaterThanOrEqual(1);
      const aborts = requestsTo("AbortMultipartUpload");
      expect(aborts.map(answered2xx)).toEqual([true]);
      expect(requestsTo("CompleteMultipartUpload")).toEqual([]);
      phase("aborted", { errorName: receiptErrorName(error.params.name) });
      return { partsBeforeAbort, abortStatus: aborts[0]!.httpStatus as number };
    });

    const folder = archiveNamespace(fixture.bucket.prefix, fixture.venueId);
    await step("uploads-after", async () => {
      const left = await fixture.ownedUploads(folder);
      expect(left).toEqual([]);
      phase("uploads-after", { count: left.length });
    });

    // The backend lists only names directly inside the folder; this store sees deeper keys too.
    const files = createS3FileStore({ ...fixture.bucket, prefix: folder }, { observe });
    await step("listed-after", async () => {
      const objects = await files.list("", { signal: fixture.signal }).finally(() => files.close());
      expect(objects).toEqual([]);
      phase("listed-after", { count: objects.length });
    });

    return summary;
  });
}
