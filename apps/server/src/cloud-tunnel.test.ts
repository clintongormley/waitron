import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as files from "node:fs/promises";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
import { runCloudWorker } from "./cloud-worker.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

async function fixture() {
  const f = await installationFixture();
  const venueId = (await f.client.status()).registration!.venueId;
  const tunnelDir = join(f.stateDir, "tunnel"),
    peerPublicKey = randomBytes(32).toString("base64"),
    gatewayPublicKey = randomBytes(32).toString("base64");
  await mkdir(tunnelDir);
  await writeFile(join(tunnelDir, "public-key"), peerPublicKey + "\n");
  const placement = {
    version: 1,
    installationId: f.installationId,
    venueId,
    cellId: randomUUID(),
    address: "10.77.17.2",
    port: 443,
    peerPublicKey,
    gatewayPublicKey,
    endpoint: "gateway.test.waitron.io:51820",
    staffHostname: `staff-v-${venueId}.test.waitron.io`,
    publicHostname: `v-${venueId}.test.waitron.io`,
  };
  const configure = (patch = {}, state = "ready") =>
    f.patch({
      services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
        service,
        state: service === "remote_access" ? state : "unconfigured",
        configuration: service === "remote_access" ? { ...placement, ...patch } : {},
        health: "unknown",
        failure: null,
        observedAt: null,
      })),
    });
  configure();
  return {
    ...f,
    tunnelDir,
    placement,
    configure,
    peer: join(tunnelDir, "peer.json"),
    client: createCloudConnection({ ...f.options, tunnelDir }),
  };
}

it.each(["ready", "provisioning"])(
  "writes only the assigned peer fields for a %s service, with a public file mode",
  async (serviceState) => {
    const f = await fixture();
    try {
      f.configure({}, serviceState);
      await f.client.refresh();
      expect(JSON.parse(await readFile(f.peer, "utf8"))).toEqual({
        address: "10.77.17.2",
        gatewayPublicKey: f.placement.gatewayPublicKey,
        endpoint: "gateway.test.waitron.io:51820",
      });
      expect((await stat(f.peer)).mode & 0o777).toBe(0o644);
      expect(f.requests.map((v) => [v[2], v[7]])).toEqual([["renew", "{}"]]);
    } finally {
      await f.close();
    }
  },
);

it.each([
  { installationId: randomUUID() },
  { venueId: randomUUID() },
  { version: 2 },
  { peerPublicKey: randomBytes(32).toString("base64") },
  { gatewayPublicKey: "invalid" },
  { address: "192.168.1.2" },
  { address: "10.77.17.1" },
  { address: "10.77.256.2" },
  { address: "10.77.17.255" },
  { address: "10.77.017.2" },
  { port: 8443 },
  { endpoint: "gateway.test.waitron.io:22" },
  { endpoint: "gateway.test;echo:51820" },
  { endpoint: "https://gateway.test:51820" },
  { endpoint: ".bad:51820" },
  { endpoint: Array(4).fill("a".repeat(63)).join(".") + ":51820" },
  { gatewayPublicKey: "A".repeat(42) + "B=" },
])("removes the old tunnel configuration when the placement is unusable: %j", async (patch) => {
  const f = await fixture();
  try {
    await f.client.refresh();
    f.configure(patch);
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_unavailable" });
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("retains a valid tunnel on a Cloud outage, then replaces its complete configuration after recovery", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    const original = await readFile(f.peer, "utf8");
    f.offline();
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readFile(f.peer, "utf8")).toBe(original);
    f.online();
    f.configure({ address: "10.77.18.2", endpoint: "next.test.waitron.io:51820" });
    await f.client.refresh();
    expect(JSON.parse(await readFile(f.peer, "utf8"))).toEqual({
      address: "10.77.18.2",
      gatewayPublicKey: f.placement.gatewayPublicKey,
      endpoint: "next.test.waitron.io:51820",
    });
  } finally {
    await f.close();
  }
});

it.each(["unconfigured", "failed"])(
  "disconnects when Cloud sets the remote service to %s",
  async (state) => {
    const f = await fixture();
    try {
      await f.client.refresh();
      f.configure({}, state);
      expect((await stat(f.peer)).isFile()).toBe(true);
      await f.client.refresh();
      await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.close();
    }
  },
);

it("disconnects on Cloud revocation and remains off after restarting the client", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    f.revoke();
    expect((await stat(f.peer)).isFile()).toBe(true);
    await f.client.refresh();
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    await createCloudConnection({ ...f.options, tunnelDir: f.tunnelDir }).refresh();
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("requires local authority to disconnect, then removes the peer before sending a revoke even if the reply is lost", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    const before = await readFile(f.peer, "utf8");
    await expect(
      f.client.revoke(async () => {
        throw new Error("expired");
      }),
    ).rejects.toThrow("expired");
    expect(await readFile(f.peer, "utf8")).toBe(before);
    let existedAtSend = true;
    f.delay(async () => {
      existedAtSend = await stat(f.peer).then(
        () => true,
        () => false,
      );
    });
    f.lose();
    await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(existedAtSend).toBe(false);
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("does not publish a placement until the optional container supplies its matching public key", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    expect((await stat(f.peer)).isFile()).toBe(true);
    await rm(join(f.tunnelDir, "public-key"));
    await f.client.refresh();
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(f.tunnelDir, "public-key"), f.placement.peerPublicKey + "\n");
    await f.client.refresh();
    expect(JSON.parse(await readFile(f.peer, "utf8")).address).toBe("10.77.17.2");
  } finally {
    await f.close();
  }
});

it("refuses a substituted public-key symlink and removes the old peer", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await rm(join(f.tunnelDir, "public-key"));
    await writeFile(join(f.tunnelDir, "pub"), f.placement.peerPublicKey);
    await symlink("pub", join(f.tunnelDir, "public-key"));
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_unavailable" });
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("saves and sends Cloud revocation even when local cleanup fails, then retries cleanup on an already-revoked installation", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await rm(f.peer);
    await mkdir(f.peer);
    await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.tunnel_unavailable",
    });
    expect(f.isRevoked()).toBe(true);
    expect((await f.client.status()).installation?.state).toBe("revoked");
    await rm(f.peer, { recursive: true });
    await writeFile(f.peer, "stale");
    await f.client.revoke(async () => {});
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("retains the pending stop while Cloud is offline and never republishes the peer after restart", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    f.offline();
    await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const restarted = createCloudConnection({ ...f.options, tunnelDir: f.tunnelDir });
    await expect(restarted.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    f.online();
    await restarted.refresh();
    expect(f.isRevoked()).toBe(true);
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("clears a revocation learned by another call even when this box is not primary", async () => {
  const f = await fixture(),
    controller = new AbortController();
  try {
    await f.client.refresh();
    f.revoke();
    await f.client.report([]);
    expect((await stat(f.peer)).isFile()).toBe(true);
    const requests = f.requests.length;
    await runCloudWorker({
      connection: f.client,
      signal: controller.signal,
      isPrimary: () => false,
      sleep: async () => {
        controller.abort();
      },
    });
    expect(f.requests).toHaveLength(requests);
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    controller.abort();
    await f.close();
  }
});

it("keeps the previous complete file if replacement fails, and exposes a complete temporary file before rename", async () => {
  const f = await fixture();
  let oldAtRename: string | undefined, temporaryAtRename: string | undefined;
  try {
    await f.client.refresh();
    const before = await readFile(f.peer, "utf8"),
      { rename } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    f.configure({ address: "10.77.18.2" });
    const intercept = vi.mocked(files.rename).mockImplementation(async (from, to) => {
      if (to === f.peer) {
        oldAtRename = await readFile(f.peer, "utf8");
        temporaryAtRename = await readFile(from, "utf8");
        throw Object.assign(new Error("disk write failed"), { code: "ENOSPC" });
      }
      return rename(from, to);
    });
    try {
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_unavailable" });
    } finally {
      intercept.mockImplementation(rename);
    }
    expect(oldAtRename).toBe(before);
    expect(JSON.parse(temporaryAtRename!).address).toBe("10.77.18.2");
    expect(await readFile(f.peer, "utf8")).toBe(before);
    expect((await files.readdir(f.tunnelDir)).sort()).toEqual(["peer.json", "public-key"]);
    await f.client.refresh();
    expect(JSON.parse(await readFile(f.peer, "utf8")).address).toBe("10.77.18.2");
  } finally {
    await f.close();
  }
});

it("makes the peer readable by the container even under a private process umask", async () => {
  const f = await fixture(),
    previous = process.umask(0o077);
  try {
    await f.client.refresh();
    expect((await stat(f.peer)).mode & 0o777).toBe(0o644);
  } finally {
    process.umask(previous);
    await f.close();
  }
});

it.each(["oversized", "noncanonical"])(
  "refuses a %s local public key even if the placement matches it",
  async (kind) => {
    const f = await fixture();
    try {
      await f.client.refresh();
      const publicKey =
        kind === "oversized" ? f.placement.peerPublicKey + "\n\n" : "A".repeat(42) + "B=";
      f.configure({ peerPublicKey: publicKey.trim() });
      await writeFile(join(f.tunnelDir, "public-key"), publicKey);
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_unavailable" });
      await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.close();
    }
  },
);

it("refuses a pipe key without blocking the Cloud connection", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    const state = JSON.parse(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"));
    await rm(join(f.tunnelDir, "public-key"));
    execFileSync("mkfifo", [join(f.tunnelDir, "public-key")], { timeout: 1000 });
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
      import { readFileSync } from 'node:fs';
      import { writeTunnelConfiguration } from './src/cloud-tunnel.ts';
      const { directory, state } = JSON.parse(readFileSync(0, 'utf8'));
      try { await writeTunnelConfiguration(directory, state); process.exitCode = 2; }
      catch (error) { process.stdout.write(JSON.stringify({code: error.code})); }
    `,
      ],
      { input: JSON.stringify({ directory: f.tunnelDir, state }), encoding: "utf8", timeout: 3000 },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ code: "cloud.tunnel_unavailable" });
  } finally {
    await f.close();
  }
});

it("removes abandoned writer temporaries when stopping, preserving other files", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await writeFile(join(f.tunnelDir, `peer.${randomUUID()}.tmp`), "incomplete");
    await writeFile(join(f.tunnelDir, "peer.notes.tmp"), "keep");
    await f.client.revoke(async () => {});
    expect((await files.readdir(f.tunnelDir)).sort()).toEqual(["peer.notes.tmp", "public-key"]);
  } finally {
    await f.close();
  }
});

it("clears a stale peer when no Cloud registration remains, without creating an absent control directory", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await rm(join(f.stateDir, "cloud/connection.json"));
    expect((await stat(f.peer)).isFile()).toBe(true);
    await f.client.refresh();
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(f.tunnelDir, { recursive: true });
    await f.client.refresh();
    await expect(stat(f.tunnelDir)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});
