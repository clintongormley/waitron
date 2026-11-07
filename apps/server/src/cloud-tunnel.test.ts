import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

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

it("writes only the assigned peer fields from the authenticated configuration, with a public file mode", async () => {
  const f = await fixture();
  try {
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
});

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
])("removes the old tunnel configuration when the placement is unusable: %j", async (patch) => {
  const f = await fixture();
  try {
    await f.client.refresh();
    f.configure(patch);
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
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
    await writeFile(join(f.stateDir, "other-key"), f.placement.peerPublicKey);
    await symlink(join(f.stateDir, "other-key"), join(f.tunnelDir, "public-key"));
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await expect(readFile(f.peer)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.close();
  }
});

it("clears a stale peer when no Cloud registration remains, without creating an absent control directory", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await rm(join(f.stateDir, "cloud-connection.json"));
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
