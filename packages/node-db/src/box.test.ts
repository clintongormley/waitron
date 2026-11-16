import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, engineErrorMessage, withNodeTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { box } from "./schema/box.js";
import { readNodeMode, readNodeModeRow } from "./mode.js";
import { readRecoveryKey } from "./recovery-key.js";
import { readMirrorLink } from "./mirror-link.js";
import { readPinnedPrimaryKey } from "./primary-key.js";
import {
  deleteBoxRowsOtherThanTx,
  writeBoxMirrorLinkTx,
  writeBoxPinnedKeyTx,
  writeBoxRecoveryKeyTx,
  writeBoxRoleTx,
  writeBoxSigningKeyTx,
} from "./box.js";

const NODE = "box-a";
const STAMP = "2026-11-16T08:00:00.000Z";

describe("box column groups", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  it.each([
    {
      name: "recovery_key",
      columns: ["recovery_key_verifier", "recovery_key_name", "recovery_key_changed_at"],
      values: ["verifier", "key-name", STAMP],
    },
    {
      name: "signing_key",
      columns: [
        "signing_key_ciphertext",
        "signing_key_iv",
        "signing_key_auth_tag",
        "signing_key_version",
        "signing_key_changed_at",
      ],
      values: [new Uint8Array([1]), new Uint8Array(12), new Uint8Array(16), 1, STAMP],
    },
    {
      name: "role",
      columns: ["mode", "singleton_role", "role_changed_at"],
      values: ["mirror", "secondary", STAMP],
    },
    {
      name: "mirror",
      columns: [
        "mirror_origin_url",
        "mirror_box_hostname",
        "mirror_box_ca_pem",
        "mirror_origin_node_id",
        "mirror_adopted_at",
      ],
      values: ["https://main.example", "main.example", "ca", "main-box", STAMP],
    },
    {
      name: "primary_key",
      columns: ["primary_node_id", "primary_public_key", "primary_pinned_at"],
      values: ["main-box", "public-key", STAMP],
    },
  ])("$name is all empty or all set", async ({ name, columns, values }) => {
    const write = (input: (string | number | Uint8Array | null)[]) =>
      suite.node.run(
        sql`insert into box (node_id, ${sql.join(
          columns.map((column) => sql.identifier(column)),
          sql`, `,
        )}) values (${NODE}, ${sql.join(
          input.map((value) => sql`${value}`),
          sql`, `,
        )})`,
      );
    for (let missing = 0; missing < columns.length; missing++) {
      const partial = values.map((value, index) => (index === missing ? null : value));
      expect(engineErrorMessage(await captureError(async () => write(partial)))).toContain(
        `box_${name}_group_ck`,
      );
    }
    write(values);
    expect(suite.node.all(sql`select node_id from box`)).toEqual([{ node_id: NODE }]);
    suite.node.run(sql`insert into box (node_id) values ('empty-box')`);
    expect(suite.node.get(sql`select count(*) as n from box`)).toEqual({ n: 2 });
  });

  it.each([
    { version: 0, iv: 12, tag: 16, constraint: "version" },
    { version: 1, iv: 11, tag: 16, constraint: "iv_len" },
    { version: 1, iv: 12, tag: 15, constraint: "auth_tag_len" },
  ])("refuses signing key $constraint", async ({ version, iv, tag, constraint }) => {
    const write = (version: number, iv: number, tag: number) =>
      suite.node.run(
        sql`insert into box (node_id, signing_key_ciphertext, signing_key_iv, signing_key_auth_tag, signing_key_version, signing_key_changed_at) values (${NODE}, ${new Uint8Array([1])}, ${new Uint8Array(iv)}, ${new Uint8Array(tag)}, ${version}, ${STAMP})`,
      );
    expect(engineErrorMessage(await captureError(async () => write(version, iv, tag)))).toContain(
      `box_signing_key_${constraint}_ck`,
    );
    write(1, 12, 16);
    expect(suite.node.all(sql`select node_id from box`)).toEqual([{ node_id: NODE }]);
  });

  it.each([
    { mode: "invalid", role: "secondary", constraint: "mode" },
    { mode: "primary", role: "invalid", constraint: "singleton_role" },
    { mode: "mirror", role: "primary", constraint: "role_valid" },
  ])("refuses role $constraint", async ({ mode, role, constraint }) => {
    const write = (mode: string, role: string) =>
      suite.node.run(
        sql`insert into box (node_id, mode, singleton_role, role_changed_at) values (${NODE}, ${mode}, ${role}, ${STAMP})`,
      );
    expect(engineErrorMessage(await captureError(async () => write(mode, role)))).toContain(
      `box_${constraint}_ck`,
    );
    write("mirror", "secondary");
    expect(suite.node.all(sql`select mode, singleton_role from box`)).toEqual([
      { mode: "mirror", singleton_role: "secondary" },
    ]);
  });
});

describe("box group writers", () => {
  const suite = useVenueDb({ migrations: [NODE_MIGRATIONS] });

  it("reads stored groups and distinguishes an empty group from an absent box", async () => {
    const mirror = {
      originUrl: "https://main.example",
      boxHostname: "main.example",
      boxCaPem: "ca",
      originNodeId: "origin",
    };
    await withNodeTransaction(suite.node, async (tx) => {
      await writeBoxRecoveryKeyTx(tx, NODE, { verifier: "verifier", keyName: "key-name" });
      expect(await readNodeMode(tx, NODE)).toEqual({ mode: "primary", singletonRole: "primary" });
      expect(await readNodeModeRow(tx, NODE)).toBeNull();
      expect(await readMirrorLink(tx, NODE)).toBeNull();
      expect(await readPinnedPrimaryKey(tx, NODE)).toBeNull();
      await writeBoxRoleTx(tx, NODE, { mode: "mirror", singletonRole: "secondary" });
      await writeBoxMirrorLinkTx(tx, NODE, mirror);
      await writeBoxPinnedKeyTx(tx, NODE, { primaryNodeId: "origin", publicKey: "public-key" });
      await writeBoxSigningKeyTx(tx, "signing-only", {
        ciphertext: new Uint8Array([1]),
        iv: new Uint8Array(12),
        authTag: new Uint8Array(16),
        keyVersion: 1,
      });
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(await readNodeModeRow(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(await readRecoveryKey(suite.node, NODE)).toEqual({
      verifier: "verifier",
      keyName: "key-name",
    });
    expect(await readMirrorLink(suite.node, NODE)).toEqual(mirror);
    expect(await readPinnedPrimaryKey(suite.node, NODE)).toEqual({
      primaryNodeId: "origin",
      publicKey: "public-key",
    });
    expect(await readRecoveryKey(suite.node, "signing-only")).toBeNull();
    expect(await readNodeMode(suite.node, "absent")).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(await readNodeModeRow(suite.node, "absent")).toBeNull();
  });

  it("upserts only its own group, including when replacing each one", async () => {
    const recovery = { verifier: "verifier", keyName: "key-name" };
    const signing = {
      ciphertext: new Uint8Array([1]),
      iv: new Uint8Array(12),
      authTag: new Uint8Array(16),
      keyVersion: 1,
    };
    const role = { mode: "mirror", singletonRole: "secondary" } as const;
    const mirror = {
      originUrl: "https://main.example",
      boxHostname: "main.example",
      boxCaPem: "ca",
      originNodeId: "origin",
    };
    const pinned = { primaryNodeId: "origin", publicKey: "public-key" };
    await withNodeTransaction(suite.node, async (tx) => {
      await writeBoxRecoveryKeyTx(tx, NODE, recovery);
      await writeBoxSigningKeyTx(tx, NODE, signing);
      await writeBoxRoleTx(tx, NODE, role);
      await writeBoxMirrorLinkTx(tx, NODE, mirror);
      await writeBoxPinnedKeyTx(tx, NODE, pinned);
    });
    const [row] = await suite.node.select().from(box);
    expect(row).toMatchObject({
      nodeId: NODE,
      recoveryKeyVerifier: "verifier",
      recoveryKeyName: "key-name",
      signingKeyCiphertext: new Uint8Array([1]),
      signingKeyIv: new Uint8Array(12),
      signingKeyAuthTag: new Uint8Array(16),
      signingKeyVersion: 1,
      mode: "mirror",
      singletonRole: "secondary",
      mirrorOriginUrl: "https://main.example",
      mirrorBoxHostname: "main.example",
      mirrorBoxCaPem: "ca",
      mirrorOriginNodeId: "origin",
      primaryNodeId: "origin",
      primaryPublicKey: "public-key",
    });
    expect(row?.recoveryKeyChangedAt).toBeInstanceOf(Date);
    expect(row?.signingKeyChangedAt).toBeInstanceOf(Date);
    expect(row?.roleChangedAt).toBeInstanceOf(Date);
    expect(row?.mirrorAdoptedAt).toBeInstanceOf(Date);
    expect(row?.primaryPinnedAt).toBeInstanceOf(Date);
    await withNodeTransaction(suite.node, async (tx) => {
      await writeBoxRecoveryKeyTx(tx, NODE, { verifier: "next-verifier", keyName: "next-name" });
      const [after] = await tx.select().from(box);
      expect(after).toEqual({
        ...row,
        recoveryKeyVerifier: "next-verifier",
        recoveryKeyName: "next-name",
        recoveryKeyChangedAt: expect.any(Date),
      });
      await writeBoxSigningKeyTx(tx, NODE, {
        ...signing,
        ciphertext: new Uint8Array([2]),
        keyVersion: 2,
      });
      const [afterSigning] = await tx.select().from(box);
      expect(afterSigning).toEqual({
        ...after,
        signingKeyCiphertext: new Uint8Array([2]),
        signingKeyVersion: 2,
        signingKeyChangedAt: expect.any(Date),
      });
      await writeBoxRoleTx(tx, NODE, { mode: "primary", singletonRole: "primary" });
      const [afterRole] = await tx.select().from(box);
      expect(afterRole).toEqual({
        ...afterSigning,
        mode: "primary",
        singletonRole: "primary",
        roleChangedAt: expect.any(Date),
      });
      await writeBoxMirrorLinkTx(tx, NODE, { ...mirror, originUrl: "https://next.example" });
      const [afterMirror] = await tx.select().from(box);
      expect(afterMirror).toEqual({
        ...afterRole,
        mirrorOriginUrl: "https://next.example",
        mirrorAdoptedAt: expect.any(Date),
      });
      await writeBoxPinnedKeyTx(tx, NODE, { ...pinned, publicKey: "next-key" });
      expect(await tx.select().from(box)).toEqual([
        { ...afterMirror, primaryPublicKey: "next-key", primaryPinnedAt: expect.any(Date) },
      ]);
    });
  });

  it("sweeps other boxes without changing this box's groups", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      for (const nodeId of [NODE, "other-box"])
        await writeBoxRecoveryKeyTx(tx, nodeId, { verifier: nodeId, keyName: nodeId });
      await deleteBoxRowsOtherThanTx(tx, NODE);
    });
    expect(suite.node.all(sql`select node_id, recovery_key_verifier from box`)).toEqual([
      { node_id: NODE, recovery_key_verifier: NODE },
    ]);
  });
});
