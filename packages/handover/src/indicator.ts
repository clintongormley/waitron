import type { CanonicalValue } from "@waitron/membership";
import type { HandoverBinding } from "./binding.js";
import { signEnvelope } from "./envelope.js";
import type { SignedHandoverEnvelope } from "./envelope.js";
import type { NodeLocalItem } from "./manifest.js";

export interface SchemaEntry {
  readonly set: string;
  readonly version: number;
  /** SHA-256 of the set's migration hashes, in the order they were applied. */
  readonly journalSha256: string;
}

export interface ModuleEntry {
  readonly name: string;
  readonly version: string;
}

/** What a stepped-down box (M1) signs about the copy it took and the state it keeps. */
export interface FinalStateIndicator {
  readonly binding: HandoverBinding;
  readonly snapshot: {
    readonly sha256: string;
    readonly bytes: number;
    readonly schema: readonly SchemaEntry[];
    readonly modules: readonly ModuleEntry[];
  };
  readonly nodeLocal: readonly NodeLocalItem[];
  readonly modulesSummary: Readonly<Record<string, CanonicalValue>>;
  /** M1's clock; informational. */
  readonly capturedAtMs: number;
}

/** The same facts in any order. */
export type FinalStateFacts = FinalStateIndicator;

function byKey<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const sorted = [...rows].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    // A fault in Waitron: each list is read from a source that names each entry once.
    if (keyOf(sorted[i]) === keyOf(sorted[i - 1])) {
      throw new Error(`the final-state indicator names ${keyOf(sorted[i])} twice`);
    }
  }
  return sorted;
}

// A fault in Waitron: a module's summary seat answers JSON values, and anything else would sign
// bytes a peer cannot rebuild from what it receives.
function assertCanonical(value: unknown, field: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertCanonical(value[index], `${field}.${index}`);
    }
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) assertCanonical(child, `${field}.${key}`);
    return;
  }
  throw new Error(`a final-state module summary holds a value JSON cannot carry at ${field}`);
}

function nodeLocalItem(row: NodeLocalItem): NodeLocalItem {
  const { item, where, class: itemClass, treatment, sha256, ringVersions } = row;
  return {
    item,
    where,
    class: itemClass,
    treatment,
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(ringVersions === undefined
      ? {}
      : { ringVersions: [...ringVersions].sort((a, b) => a - b) }),
  };
}

export function assembleIndicator(facts: FinalStateFacts): FinalStateIndicator {
  const modulesSummary: Record<string, CanonicalValue> = {};
  for (const name of Object.keys(facts.modulesSummary).sort()) {
    const summary = facts.modulesSummary[name];
    assertCanonical(summary, `modulesSummary.${name}`);
    modulesSummary[name] = summary;
  }
  return {
    binding: facts.binding,
    snapshot: {
      sha256: facts.snapshot.sha256,
      bytes: facts.snapshot.bytes,
      schema: byKey(facts.snapshot.schema, (entry) => entry.set).map(
        ({ set, version, journalSha256 }) => ({ set, version, journalSha256 }),
      ),
      modules: byKey(facts.snapshot.modules, (entry) => entry.name).map(({ name, version }) => ({
        name,
        version,
      })),
    },
    nodeLocal: byKey(facts.nodeLocal, (row) => `${row.where}/${row.item}`).map(nodeLocalItem),
    modulesSummary,
    capturedAtMs: facts.capturedAtMs,
  };
}

/** Assembles before signing, so only the canonical body is ever signed. */
export function signIndicator(
  facts: FinalStateFacts,
  signer: { nodeId: string; privateKey: string },
): SignedHandoverEnvelope<FinalStateIndicator> {
  const body = assembleIndicator(facts) as unknown as CanonicalValue;
  const envelope = signEnvelope("final-state", body, signer);
  return envelope as unknown as SignedHandoverEnvelope<FinalStateIndicator>;
}
