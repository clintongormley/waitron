import type {
  PaperAllocation,
  PaperBlock,
  PaperConsumption,
  SignedPaperValue,
} from "./paper-protocol.js";

export interface RegisterScope {
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "production" | "preproduction";
}
export interface RegisterHead {
  readonly registerId: string;
  readonly revision: string;
  readonly digest: string;
}
export interface RegisterPosition {
  readonly sHighWater: number;
  readonly pHighWater: number;
}
export type RegisterOriginal = SignedPaperValue<PaperBlock> | SignedPaperValue<PaperConsumption>;
export type RegisterEvent =
  | { readonly kind: "reserve"; readonly block: SignedPaperValue<PaperBlock> }
  | { readonly kind: "consume"; readonly consumption: SignedPaperValue<PaperConsumption> }
  | {
      readonly kind: "retire" | "uncertain";
      readonly allocationId: string;
      readonly eventId: string;
    };
export interface RegisterRevision extends RegisterPosition {
  readonly version: 1;
  readonly registerId: string;
  readonly scope: RegisterScope;
  readonly revision: string;
  readonly previousDigest: string;
  readonly createdAt: string;
  readonly events: readonly RegisterEvent[];
}
export interface PaperBurnCheckpoint extends RegisterPosition {
  readonly version: 1;
  readonly kind: "paper-burn-checkpoint";
  readonly checkpointId: string;
  readonly scope: RegisterScope;
  readonly custodianId: string;
  readonly fingerprint: string;
  readonly sourceHeadTag: string;
  readonly currentOriginalConfirmed: true;
  readonly noParallelPaperAllocation: true;
  readonly completeHistoryUnavailable: true;
  readonly burnAllPrior: true;
  readonly createdAt: string;
}
interface HistoryIdentity {
  readonly version: 1;
  readonly scope: RegisterScope;
  readonly registerId: string;
  readonly custodianId: string;
  readonly fingerprint: string;
  readonly revisions: readonly SignedPaperValue<RegisterRevision>[];
}
export type RegisterHistory =
  | (HistoryIdentity & { readonly mode: "complete"; readonly custodyVersion: number })
  | (HistoryIdentity & {
      readonly mode: "checkpoint";
      readonly custodyVersion: number | null;
      readonly checkpoint: SignedPaperValue<PaperBurnCheckpoint>;
      readonly retainedOriginals: readonly RegisterOriginal[];
    });
export interface KnownRegisterEvidence extends RegisterPosition {
  readonly custodyVersion?: number;
  readonly currentHead: RegisterHead | null;
  readonly retainedHeads: readonly RegisterHead[];
  readonly retainedOriginals: readonly RegisterOriginal[];
}
export interface RegisterOccupied {
  readonly allocation: PaperAllocation;
  readonly recipientVenueId: string;
  readonly state: "reserved" | "consumed" | "retired" | "uncertain";
}
export interface RegisterProjection extends RegisterPosition {
  readonly mode: RegisterHistory["mode"];
  readonly custodyVersion: number | null;
  readonly head: RegisterHead;
  readonly occupied: readonly RegisterOccupied[];
  readonly originals: readonly RegisterOriginal[];
  readonly nextS: number | null;
  readonly nextP: number | null;
  readonly completeHistory: boolean;
  readonly currentnessRequired: true;
}
export function canonicalRegisterBytes(value: unknown): Uint8Array<ArrayBuffer> {
  function canonical(item: unknown): string {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (
      typeof item === "object" &&
      item !== null &&
      Object.getPrototypeOf(item) === Object.prototype
    )
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`)
        .join(",")}}`;
    throw new Error("Register value refused");
  }
  return new TextEncoder().encode(canonical(value));
}
export function registerRevisionBytes(value: RegisterRevision): Uint8Array<ArrayBuffer> {
  return canonicalRegisterBytes(["waitron.paper-register-revision", 1, value]);
}
export function paperBurnCheckpointBytes(value: PaperBurnCheckpoint): Uint8Array<ArrayBuffer> {
  return canonicalRegisterBytes(["waitron.paper-burn-checkpoint", 1, value]);
}
export async function registerCheckCode(value: unknown, bytes: 5 | 10): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", canonicalRegisterBytes(value)),
  ).slice(0, bytes);
  let bits = 0n,
    result = "";
  for (const byte of hash) bits = (bits << 8n) | BigInt(byte);
  for (let n = 0; n < (bytes * 8) / 5; n++) {
    result = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Number(bits & 31n)]! + result;
    bits >>= 5n;
  }
  return result;
}
export function registerHeadTag(head: RegisterHead): Promise<string> {
  return registerCheckCode(["waitron.paper-head-reference", 1, head], 10);
}
