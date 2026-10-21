import { createPrivateKey, createPublicKey } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateBackupVerificationTarget,
  parseBackupVerificationJson,
  type BackupVerificationTarget,
} from "./backup-verification-protocol.js";

export interface SnapshotRecoveryVerification {
  protocol: "backup-data-restore/v1";
  target: BackupVerificationTarget;
  policyDigest: string;
  requestDigest: string;
  archiveSha256: string;
  archiveBytes: number;
  pointId: string;
}
interface RecoveryIdentity {
  origin: string;
  environment: "preproduction";
  requestId: string;
  publicKey: string;
  privateKey: string;
  code: string;
  expiresAt?: string;
  pointId?: string;
  phase?: "staged" | "restored" | "reported";
}
export type SavedCloudRecoveryState = RecoveryIdentity &
  (
    | { version: 1 }
    | {
        version: 2;
        protocol: "backup-data-restore/v1";
        target: BackupVerificationTarget;
        snapshotVerification?: SnapshotRecoveryVerification;
      }
  );
export function cloudRecoveryUnavailable(): never {
  throw new Error("Cloud recovery is unavailable. Try again.");
}
export class SnapshotPlacementRefused extends Error {
  constructor() {
    super("Cloud recovery is unavailable. Try again.");
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    required.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k))
  )
    cloudRecoveryUnavailable();
}
export function snapshotRecoveryTarget(value: unknown): BackupVerificationTarget {
  try {
    const target = validateBackupVerificationTarget(value);
    // The saved approval contains both the requested and verified target.
    if (Buffer.byteLength(JSON.stringify(target)) > 30000) cloudRecoveryUnavailable();
    return target;
  } catch {
    return cloudRecoveryUnavailable();
  }
}
export function readSnapshotRecoveryVerification(value: unknown): SnapshotRecoveryVerification {
  if (!record(value)) cloudRecoveryUnavailable();
  keys(value, [
    "protocol",
    "target",
    "policyDigest",
    "requestDigest",
    "archiveSha256",
    "archiveBytes",
    "pointId",
  ]);
  const target = snapshotRecoveryTarget(value.target);
  if (
    value.protocol !== "backup-data-restore/v1" ||
    value.policyDigest !== target.policyDigest ||
    !hash(value.requestDigest) ||
    !hash(value.archiveSha256) ||
    !uuid(value.pointId) ||
    typeof value.archiveBytes !== "number" ||
    !Number.isSafeInteger(value.archiveBytes) ||
    value.archiveBytes < 1 ||
    value.archiveBytes > 512 * 1024 * 1024
  )
    cloudRecoveryUnavailable();
  return Object.freeze({
    protocol: "backup-data-restore/v1",
    target,
    policyDigest: target.policyDigest,
    requestDigest: value.requestDigest,
    archiveSha256: value.archiveSha256,
    archiveBytes: value.archiveBytes,
    pointId: value.pointId,
  });
}
export function assertSnapshotRecoveryTarget(
  verification: SnapshotRecoveryVerification,
  current: BackupVerificationTarget,
): void {
  const admitted = readSnapshotRecoveryVerification(verification);
  if (admitted.target.digest !== snapshotRecoveryTarget(current).digest) cloudRecoveryUnavailable();
}
export function sameSnapshotRecoveryVerification(
  a: SnapshotRecoveryVerification,
  b: SnapshotRecoveryVerification,
): boolean {
  return (
    a.protocol === b.protocol &&
    a.pointId === b.pointId &&
    a.archiveSha256 === b.archiveSha256 &&
    a.archiveBytes === b.archiveBytes &&
    a.requestDigest === b.requestDigest &&
    a.target.digest === b.target.digest &&
    a.policyDigest === b.policyDigest
  );
}
export async function readSnapshotRecoveryBinding(
  stateDir: string,
  input: {
    managedCloud?: { requestId: string; pointId: string };
    snapshotVerification?: SnapshotRecoveryVerification;
  },
): Promise<{ verification: SnapshotRecoveryVerification; publicKey: string } | undefined> {
  const state = await readCloudRecoveryState(stateDir);
  if (state?.version !== 2 && input.snapshotVerification === undefined) return undefined;
  if (state?.version !== 2 || !input.snapshotVerification || !input.managedCloud)
    cloudRecoveryUnavailable();
  if (!record(input.managedCloud)) cloudRecoveryUnavailable();
  keys(input.managedCloud, ["requestId", "pointId"]);
  const verification = readSnapshotRecoveryVerification(input.snapshotVerification);
  if (
    !state.snapshotVerification ||
    state.requestId !== input.managedCloud.requestId ||
    state.pointId !== input.managedCloud.pointId ||
    verification.pointId !== state.pointId ||
    !sameSnapshotRecoveryVerification(state.snapshotVerification, verification)
  )
    cloudRecoveryUnavailable();
  return { verification, publicKey: state.publicKey };
}
export function assertSnapshotRecoveryArchive(
  verification: SnapshotRecoveryVerification,
  sha256: string | undefined,
  bytes: number | undefined,
): void {
  if (verification.archiveSha256 !== sha256 || verification.archiveBytes !== bytes)
    cloudRecoveryUnavailable();
}
export async function readCloudRecoveryState(
  stateDir: string,
): Promise<SavedCloudRecoveryState | undefined> {
  try {
    const path = join(stateDir, "cloud-recovery.json");
    const info = await lstat(path);
    if (!info.isFile() || info.size > 65536 || info.mode & 0o077) cloudRecoveryUnavailable();
    const raw = await readFile(path, "utf8");
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      (value.version !== 1 && value.version !== 2) ||
      (value.version === 1 && Buffer.byteLength(raw) > 8192) ||
      typeof value.origin !== "string" ||
      value.environment !== "preproduction" ||
      !uuid(value.requestId) ||
      typeof value.code !== "string" ||
      !/^\d{8}$/.test(value.code) ||
      typeof value.publicKey !== "string" ||
      typeof value.privateKey !== "string"
    )
      cloudRecoveryUnavailable();
    const privateKey = createPrivateKey({
      key: Buffer.from(value.privateKey, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    if (
      privateKey.asymmetricKeyType !== "ed25519" ||
      createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64url") !==
        value.publicKey ||
      (value.expiresAt !== undefined && !date(value.expiresAt)) ||
      (value.pointId !== undefined && !uuid(value.pointId)) ||
      (value.phase !== undefined &&
        !["staged", "restored", "reported"].includes(String(value.phase)))
    )
      cloudRecoveryUnavailable();
    if (value.version === 1) {
      if (["target", "protocol", "snapshotVerification"].some((key) => Object.hasOwn(value, key)))
        cloudRecoveryUnavailable();
      return value as unknown as SavedCloudRecoveryState;
    }
    parseBackupVerificationJson(raw, 65536);
    keys(
      value,
      [
        "version",
        "origin",
        "environment",
        "requestId",
        "publicKey",
        "privateKey",
        "code",
        "protocol",
        "target",
      ],
      ["expiresAt", "pointId", "phase", "snapshotVerification"],
    );
    if (value.protocol !== "backup-data-restore/v1") cloudRecoveryUnavailable();
    const target = snapshotRecoveryTarget(value.target);
    const verification =
      value.snapshotVerification === undefined
        ? undefined
        : readSnapshotRecoveryVerification(value.snapshotVerification);
    if (
      (value.pointId !== undefined && verification === undefined) ||
      (value.phase !== undefined && value.pointId === undefined) ||
      (verification !== undefined &&
        (verification.pointId !== value.pointId || verification.target.digest !== target.digest))
    )
      cloudRecoveryUnavailable();
    return {
      ...value,
      target,
      ...(verification === undefined ? {} : { snapshotVerification: verification }),
    } as unknown as SavedCloudRecoveryState;
  } catch (error) {
    if (record(error) && error.code === "ENOENT") return undefined;
    return cloudRecoveryUnavailable();
  }
}
export async function readSavedSnapshotRecoveryTarget(stateDir: string): Promise<{
  requestId: string;
  pointId: string | undefined;
  target: BackupVerificationTarget;
} | null> {
  const state = await readCloudRecoveryState(stateDir);
  return state?.version === 2
    ? { requestId: state.requestId, pointId: state.pointId, target: state.target }
    : null;
}
