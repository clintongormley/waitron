import { ne } from "drizzle-orm";
import { now, type DeploymentMode, type NodeTransaction, type SingletonRole } from "@waitron/db";
import type { MirrorConnection } from "./mirror-link.js";
import type { PinnedPrimaryKey } from "./primary-key.js";
import { box } from "./schema/box.js";

export type BoxRoleCause = "adopt" | "promote" | "fenced";

export async function writeBoxRecoveryKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  key: { verifier: string; keyName: string },
): Promise<void> {
  const group = {
    recoveryKeyVerifier: key.verifier,
    recoveryKeyName: key.keyName,
    recoveryKeyChangedAt: now(),
  };
  await tx
    .insert(box)
    .values({ nodeId, ...group })
    .onConflictDoUpdate({ target: box.nodeId, set: group });
}

export async function writeBoxSigningKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array; keyVersion: number },
): Promise<void> {
  const group = {
    signingKeyCiphertext: sealed.ciphertext,
    signingKeyIv: sealed.iv,
    signingKeyAuthTag: sealed.authTag,
    signingKeyVersion: sealed.keyVersion,
    signingKeyChangedAt: now(),
  };
  await tx
    .insert(box)
    .values({ nodeId, ...group })
    .onConflictDoUpdate({ target: box.nodeId, set: group });
}

export async function writeBoxRoleTx(
  tx: NodeTransaction,
  nodeId: string,
  role: { mode: DeploymentMode; singletonRole: SingletonRole },
): Promise<void> {
  const group = { ...role, roleChangedAt: now() };
  await tx
    .insert(box)
    .values({ nodeId, ...group })
    .onConflictDoUpdate({ target: box.nodeId, set: group });
}

export async function writeBoxMirrorLinkTx(
  tx: NodeTransaction,
  nodeId: string,
  link: MirrorConnection,
): Promise<void> {
  const group = {
    mirrorOriginUrl: link.originUrl,
    mirrorBoxHostname: link.boxHostname,
    mirrorBoxCaPem: link.boxCaPem,
    mirrorOriginNodeId: link.originNodeId,
    mirrorAdoptedAt: now(),
  };
  await tx
    .insert(box)
    .values({ nodeId, ...group })
    .onConflictDoUpdate({ target: box.nodeId, set: group });
}

export async function writeBoxPinnedKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  pinned: PinnedPrimaryKey,
): Promise<void> {
  const group = {
    primaryNodeId: pinned.primaryNodeId,
    primaryPublicKey: pinned.publicKey,
    primaryPinnedAt: now(),
  };
  await tx
    .insert(box)
    .values({ nodeId, ...group })
    .onConflictDoUpdate({ target: box.nodeId, set: group });
}

export async function deleteBoxRowsOtherThanTx(tx: NodeTransaction, nodeId: string): Promise<void> {
  await tx.delete(box).where(ne(box.nodeId, nodeId));
}
