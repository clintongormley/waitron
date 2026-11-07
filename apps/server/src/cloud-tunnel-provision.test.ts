import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

async function fixture() {
  let mode = "ok";
  const f = await installationFixture(undefined, {
    tunnel: async (_values, saved, req, res) => {
      if (mode === "lost") {
        mode = "ok";
        req.socket.destroy();
        return;
      }
      if (mode === "conflict" || mode === "invalid_proof" || mode === "revoked") {
        res.writeHead(mode === "conflict" ? 409 : mode === "revoked" ? 403 : 401);
        res.end(JSON.stringify({ error: mode === "conflict" ? "placement_conflict" : mode }));
        return;
      }
      const state = saved as unknown as { lifecycle: { view: Record<string, unknown> } };
      const view = state.lifecycle.view;
      const services = (view.services as Record<string, unknown>[])
        .filter((s) => s.service !== "content_translation")
        .map((s) =>
          s.service === "remote_access"
            ? {
                ...s,
                state: mode === "unconfigured" ? "unconfigured" : "provisioning",
                configuration:
                  mode === "unconfigured" ? {} : { version: 1, peerPublicKey: publicKey },
              }
            : s,
        );
      if (mode !== "wrong")
        f.patch({
          services: [
            ...services,
            ...(view.services as Record<string, unknown>[]).filter(
              (s) => s.service === "content_translation",
            ),
          ],
        });
      res.end(
        JSON.stringify({
          ...view,
          services,
          ...(mode === "wrong" ? { installationId: randomUUID() } : {}),
        }),
      );
    },
  });
  const directory = join(f.stateDir, "tunnel");
  await mkdir(directory);
  const publicKey = randomBytes(32).toString("base64");
  await writeFile(join(directory, "public-key"), publicKey + "\n");
  const options = { ...f.options, tunnelDir: directory };
  return {
    ...f,
    options,
    directory,
    publicKey,
    client: createCloudConnection(options),
    mode: (value: string) => {
      mode = value;
    },
    submissions: () => f.requests.filter((v) => v[2] === "tunnel-provision"),
    saved: async () =>
      JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")),
  };
}

it("submits only the persisted public key with the live lease and retains the fourth service", async () => {
  const f = await fixture();
  try {
    const withoutTunnel = createCloudConnection({ ...f.options, tunnelDir: undefined });
    await withoutTunnel.refresh();
    await withoutTunnel.refresh();
    const status = await f.client.refresh();
    expect(f.submissions()).toHaveLength(1);
    const request = f.submissions()[0]!;
    expect(request.slice(0, 4)).toEqual([
      "waitron-cloud-machine-v1",
      f.options.origin,
      "tunnel-provision",
      f.installationId,
    ]);
    expect(request[4]).toMatch(/^[0-9a-f-]{36}$/);
    expect(request[6]).toBe(JSON.stringify((await f.saved()).lifecycle.lease));
    expect(request[7]).toBe(JSON.stringify({ peerPublicKey: f.publicKey }));
    expect(status.installation?.services.find((s) => s.service === "remote_access")?.state).toBe(
      "provisioning",
    );
    await f.client.refresh();
    expect(f.submissions()).toHaveLength(1);
    expect(
      (await f.client.status()).installation?.services.some(
        (s) => s.service === "content_translation",
      ),
    ).toBe(true);
    expect(JSON.stringify(status)).not.toContain(f.publicKey);
  } finally {
    await f.close();
  }
});

it("retries a lost reply after restart with the same key and a fresh operation", async () => {
  const f = await fixture();
  try {
    f.mode("lost");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await createCloudConnection(f.options).refresh();
    const requests = f.submissions();
    expect(requests).toHaveLength(2);
    expect(requests[0]![7]).toBe(requests[1]![7]);
    expect(requests[0]![4]).not.toBe(requests[1]![4]);
    expect(await readFile(join(f.directory, "public-key"), "utf8")).toBe(f.publicKey + "\n");
  } finally {
    await f.close();
  }
});

it("stops retrying a placement conflict across refreshes and restarts", async () => {
  const f = await fixture();
  try {
    f.mode("conflict");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    await expect(createCloudConnection(f.options).refresh()).rejects.toMatchObject({
      code: "cloud.binding_conflict",
    });
    expect(f.submissions()).toHaveLength(1);
    expect((await f.client.status()).installation?.state).toBe("active");
    f.offline();
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.client.status()).installation?.state).toBe("unavailable");
    f.online();
    expect((await f.client.revoke(async () => {})).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});

it("rejects another installation's reply without replacing the last configuration", async () => {
  const f = await fixture();
  try {
    f.mode("wrong");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.saved()).lifecycle.view.installationId).toBe(f.installationId);
    expect(
      (await f.client.status()).installation?.services.find((s) => s.service === "remote_access")
        ?.state,
    ).toBe("unconfigured");
  } finally {
    await f.close();
  }
});

it("renews a refused proof on the next refresh and never retries a revoked installation", async () => {
  const f = await fixture();
  try {
    f.mode("invalid_proof");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.saved()).lifecycle.lease).toBeUndefined();
    f.mode("revoked");
    expect((await f.client.refresh()).installation?.state).toBe("revoked");
    const count = f.requests.length;
    await createCloudConnection(f.options).refresh();
    expect(f.requests).toHaveLength(count);
  } finally {
    await f.close();
  }
});

it("keeps an unconfigured 200 reply unconfigured", async () => {
  const f = await fixture();
  try {
    f.mode("unconfigured");
    const status = await f.client.refresh();
    expect(f.submissions()).toHaveLength(1);
    expect(status.installation?.services.find((s) => s.service === "remote_access")?.state).toBe(
      "unconfigured",
    );
    expect(
      (await f.saved()).lifecycle.view.services.find(
        (s: { service: string }) => s.service === "remote_access",
      ).configuration,
    ).toEqual({});
  } finally {
    await f.close();
  }
});

it("does not submit without the optional directory or key, or after revocation", async () => {
  const f = await fixture();
  try {
    await createCloudConnection({ ...f.options, tunnelDir: undefined }).refresh();
    await rm(join(f.directory, "public-key"));
    await f.client.refresh();
    await f.client.revoke(async () => {});
    await writeFile(join(f.directory, "public-key"), f.publicKey);
    await f.client.refresh();
    expect(f.submissions()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("does not submit for a production or unpaired installation", async () => {
  const f = await fixture();
  try {
    const state = await f.saved();
    state.environment = "production";
    state.view.environment = "production";
    await writeFile(join(f.stateDir, "cloud-connection.json"), JSON.stringify(state));
    await createCloudConnection({ ...f.options, environment: "production" }).refresh();
    expect(f.submissions()).toHaveLength(0);
    expect(
      (
        await createCloudConnection({
          ...f.options,
          stateDir: join(f.stateDir, "unpaired"),
        }).refresh()
      ).state,
    ).toBe("not_connected");
  } finally {
    await f.close();
  }
});

it.each([false, "true", {}])("refuses a malformed terminal-conflict marker %j", async (value) => {
  const f = await fixture();
  try {
    await createCloudConnection({ ...f.options, tunnelDir: undefined }).refresh();
    const state = await f.saved();
    state.lifecycle.tunnelConflict = value;
    await writeFile(join(f.stateDir, "cloud-connection.json"), JSON.stringify(state));
    await expect(f.client.status()).rejects.toMatchObject({ code: "cloud.state_invalid" });
  } finally {
    await f.close();
  }
});

it.each(["bad", "oversized", "link"])(
  "refuses a %s public-key file without submitting it",
  async (kind) => {
    const f = await fixture();
    try {
      const path = join(f.directory, "public-key");
      if (kind === "link") {
        await rm(path);
        await writeFile(join(f.directory, "other"), f.publicKey);
        await symlink(join(f.directory, "other"), path);
      } else await writeFile(path, kind === "bad" ? "invalid" : "x".repeat(46));
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.state_invalid" });
      expect(f.submissions()).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);
