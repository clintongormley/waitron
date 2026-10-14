import {
  readBreakGlassKeyName,
  readBreakGlassVerifier,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";
import type { ProvisionedNode, WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface RecoveryPack {
  readonly version: 1;
  readonly kind: "node-recovery-pack";
  readonly createdAt: string;
  readonly nodeRecovery: {
    readonly nodeId: string;
    readonly name: string;
    readonly secret: string;
  };
  readonly modules: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createRecoveryPack(
  deps: {
    readonly db: Database;
    readonly node: ProvisionedNode;
    readonly venueId: string;
    readonly modules: readonly WaitronModule[];
    readonly now: Date;
    readonly authorize?: (tx: Transaction) => Promise<void>;
  },
  request: unknown,
): Promise<RecoveryPack> {
  const refuse = (reason: string): never => {
    throw new AppError("recovery.pack_invalid", { reason });
  };
  if (
    !record(request) ||
    Object.keys(request).length !== 2 ||
    !Object.hasOwn(request, "nodeRecoveryKey") ||
    !record(request.modules)
  )
    return refuse("shape");
  const secret = request.nodeRecoveryKey;
  const node = { ...deps.node, venueId: deps.venueId };
  const modules = [...deps.modules];
  const createdAt = deps.now.toISOString();
  const inputs = structuredClone(request.modules);
  const invalidKey = (): never => {
    throw new AppError("promotion.break_glass_invalid", {});
  };
  if (typeof secret !== "string" || secret.length === 0) return invalidKey();
  const verifier = await readBreakGlassVerifier(deps.db, node.nodeId);
  if (verifier === null || !(await verifySecretAsync(secret, verifier))) return invalidKey();
  for (const name of Object.keys(inputs)) {
    if (!modules.some((module) => module.name === name && module.backup?.recoveryPack))
      return refuse("module_unsupported");
  }
  return withTransaction(deps.db, async (tx) => {
    await deps.authorize?.(tx);
    if ((await readBreakGlassVerifier(tx, node.nodeId)) !== verifier) return invalidKey();
    const name = await readBreakGlassKeyName(tx, node.nodeId);
    if (name === null) return refuse("key_name_missing");
    const snapshots: Record<string, unknown> = {};
    for (const module of modules) {
      const contribution = module.backup?.recoveryPack;
      if (contribution === undefined) continue;
      if (!Object.hasOwn(inputs, module.name)) return refuse("module_input_missing");
      snapshots[module.name] = await contribution(tx, node, inputs[module.name]);
    }
    if ((await readBreakGlassVerifier(tx, node.nodeId)) !== verifier) return invalidKey();
    return {
      version: 1,
      kind: "node-recovery-pack",
      createdAt,
      nodeRecovery: { nodeId: node.nodeId, name, secret },
      modules: snapshots,
      warnings: [
        "contains-node-recovery-key",
        "register-snapshot-may-be-stale",
        "retain-older-node-keys-for-older-backups",
      ],
    };
  });
}
