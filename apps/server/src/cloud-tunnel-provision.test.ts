import { randomBytes, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

async function fixture() {
  let mode = "ok";
  const urls: string[] = [],
    envelopeFields: string[][] = [];
  const f = await installationFixture(undefined, {
    tunnel: async (_values, saved, req, res, sent) => {
      urls.push(req.url ?? "");
      envelopeFields.push(Object.keys(sent).sort());
      const refusals: Record<string, number> = { off: 503, absent: 404, denied: 403, limited: 429 };
      if (mode in refusals) {
        res.writeHead(refusals[mode]!);
        res.end(mode === "absent" ? "<h1>Not found</h1>" : JSON.stringify({ error: mode }));
        return;
      }
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
                configuration: mode === "unconfigured" ? {} : placement,
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
  const registration = JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"))
    .view.registration;
  const placement = {
    version: 1,
    installationId: registration.installationId,
    venueId: registration.venueId,
    cellId: randomUUID(),
    address: "10.77.17.2",
    port: 443,
    peerPublicKey: publicKey,
    gatewayPublicKey: randomBytes(32).toString("base64"),
    endpoint: "gateway.example.test:51820",
    staffHostname: `staff-v-${registration.venueId}.cell.example.test`,
    publicHostname: `v-${registration.venueId}.cell.example.test`,
  };
  await writeFile(join(directory, "public-key"), publicKey + "\n");
  const options = { ...f.options, tunnelDir: directory };
  return {
    ...f,
    options,
    directory,
    publicKey,
    placement,
    urls,
    envelopeFields,
    client: createCloudConnection(options),
    mode: (value: string) => {
      mode = value;
    },
    submissions: () => f.requests.filter((v) => v[2] === "tunnel-provision"),
    saved: async () =>
      JSON.parse(await readFile(join(f.stateDir, "cloud-connection.json"), "utf8")),
  };
}

it("turns remote access off locally while Cloud is offline, remembers it, and reconnects with the same key", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    expect(JSON.parse(await readFile(join(f.directory, "peer.json"), "utf8")).address).toBe(
      "10.77.17.2",
    );
    f.offline();
    expect(await f.client.setRemoteAccess(false, async () => {})).toMatchObject({
      remoteAccessEnabled: false,
    });
    await expect(readFile(join(f.directory, "peer.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const restarted = createCloudConnection(f.options);
    expect(await restarted.status()).toMatchObject({
      remoteAccessEnabled: false,
      state: "complete",
    });
    await expect(restarted.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.online();
    f.patch({
      services: (await f.saved()).lifecycle.view.services.map((s: { service: string }) =>
        s.service === "remote_access" ? { ...s, state: "unconfigured", configuration: {} } : s,
      ),
    });
    await restarted.refresh();
    await restarted.syncTunnel();
    await expect(readFile(join(f.directory, "peer.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(f.submissions()).toHaveLength(1);
    expect(await restarted.setRemoteAccess(true, async () => {})).toMatchObject({
      remoteAccessEnabled: true,
    });
    await restarted.refresh();
    expect(JSON.parse(await readFile(join(f.directory, "peer.json"), "utf8")).address).toBe(
      "10.77.17.2",
    );
    expect(await readFile(join(f.directory, "public-key"), "utf8")).toBe(f.publicKey + "\n");
    expect(f.submissions()).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it("leaves the local choice alone when the manager is no longer authorised", async () => {
  const f = await fixture();
  try {
    await expect(
      f.client.setRemoteAccess(false, async () => {
        throw new Error("signed out");
      }),
    ).rejects.toThrow("signed out");
    expect((await f.client.status()).remoteAccessEnabled).toBe(true);
    expect((await f.saved()).remoteAccessEnabled).toBeUndefined();
  } finally {
    await f.close();
  }
});

it.each([null, "false", 0])("refuses a malformed saved remote access choice %j", async (value) => {
  const f = await fixture();
  try {
    const saved = await f.saved();
    saved.remoteAccessEnabled = value;
    await writeFile(join(f.stateDir, "cloud-connection.json"), JSON.stringify(saved));
    await expect(f.client.status()).rejects.toMatchObject({ code: "cloud.state_invalid" });
    await expect(f.client.syncTunnel()).rejects.toMatchObject({ code: "cloud.state_invalid" });
    await expect(readFile(join(f.directory, "peer.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});

it("keeps a failed turn-on off and saves off before a failed peer removal", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await f.client.setRemoteAccess(false, async () => {});
    await writeFile(join(f.directory, "public-key"), randomBytes(32).toString("base64"));
    await expect(f.client.setRemoteAccess(true, async () => {})).rejects.toMatchObject({
      code: "cloud.tunnel_unavailable",
    });
    expect((await f.saved()).remoteAccessEnabled).toBe(false);
    await writeFile(join(f.directory, "public-key"), f.publicKey + "\n");
    await f.client.refresh();
    await expect(readFile(join(f.directory, "peer.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await f.client.setRemoteAccess(true, async () => {});
    await rm(join(f.directory, "peer.json"));
    await mkdir(join(f.directory, "peer.json"));
    await expect(f.client.setRemoteAccess(false, async () => {})).rejects.toMatchObject({
      code: "cloud.tunnel_unavailable",
    });
    expect((await f.saved()).remoteAccessEnabled).toBe(false);
  } finally {
    await f.close();
  }
});
it("refuses turn-on after a Cloud stop is pending or confirmed", async () => {
  const f = await fixture();
  try {
    await f.client.refresh();
    await f.client.setRemoteAccess(false, async () => {});
    f.offline();
    await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    await expect(f.client.setRemoteAccess(true, async () => {})).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect((await f.saved()).remoteAccessEnabled).toBe(false);
    f.online();
    await f.client.revoke(async () => {});
    await expect(f.client.setRemoteAccess(true, async () => {})).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect((await f.saved()).remoteAccessEnabled).toBe(false);
  } finally {
    await f.close();
  }
});

it("submits only the persisted public key with the live lease and retains the fourth service", async () => {
  const f = await fixture();
  try {
    const withoutTunnel = createCloudConnection({ ...f.options, tunnelDir: undefined });
    await withoutTunnel.refresh();
    await withoutTunnel.refresh();
    const status = await f.client.refresh();
    expect(f.submissions()).toHaveLength(1);
    expect(f.urls).toEqual(["/api/installations/tunnel-provision"]);
    expect(f.envelopeFields).toEqual([["payload", "signature"]]);
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
    expect(status.installation?.services.some((s) => s.service === "content_translation")).toBe(
      true,
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
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_conflict" });
    await expect(createCloudConnection(f.options).refresh()).rejects.toMatchObject({
      code: "cloud.tunnel_conflict",
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

it.each(["bad", "oversized", "link", "noncanonical", "directory"])(
  "refuses a %s public-key file without submitting it",
  async (kind) => {
    const f = await fixture();
    try {
      const path = join(f.directory, "public-key");
      if (kind === "link") {
        await rm(path);
        await writeFile(join(f.directory, "other"), f.publicKey);
        await symlink(join(f.directory, "other"), path);
      } else if (kind === "directory") {
        await rm(path);
        await mkdir(path);
      } else
        await writeFile(
          path,
          kind === "bad"
            ? "invalid"
            : kind === "noncanonical"
              ? "A".repeat(42) + "B="
              : f.publicKey + "\n\n",
        );
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_unavailable" });
      expect(f.submissions()).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);

async function configuredRemote(
  f: Awaited<ReturnType<typeof fixture>>,
  state: string,
  peerPublicKey = f.publicKey,
) {
  await createCloudConnection({ ...f.options, tunnelDir: undefined }).refresh();
  f.patch({
    services: (await f.saved()).lifecycle.view.services.map((s: { service: string }) =>
      s.service === "remote_access"
        ? { ...s, state, configuration: { ...f.placement, peerPublicKey } }
        : s,
    ),
  });
}

it.each(["off", "absent", "denied", "limited"])(
  "keeps control active when the tunnel receiver is %s",
  async (mode) => {
    const f = await fixture();
    try {
      f.mode(mode);
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect((await f.client.status()).installation?.state).toBe("active");
      expect((await f.saved()).lifecycle.tunnelConflict).toBeUndefined();
    } finally {
      await f.close();
    }
  },
);

it.each(["provisioning", "ready", "failed"])(
  "does not reprovision a %s placement with the saved key",
  async (state) => {
    const f = await fixture();
    try {
      await configuredRemote(f, state);
      await f.client.refresh();
      await f.client.refresh();
      expect(f.submissions()).toHaveLength(0);
      expect(
        (await f.client.status()).installation?.services.find((s) => s.service === "remote_access")
          ?.state,
      ).toBe(state);
    } finally {
      await f.close();
    }
  },
);

it("submits the persisted key when the existing placement holds a different key", async () => {
  const f = await fixture();
  try {
    await configuredRemote(f, "ready", randomBytes(32).toString("base64"));
    await f.client.refresh();
    expect(f.submissions().map((v) => v[7])).toEqual([
      JSON.stringify({ peerPublicKey: f.publicKey }),
    ]);
  } finally {
    await f.close();
  }
});

it("accepts a later matching placement without repeating the refused key submission", async () => {
  const f = await fixture();
  try {
    f.mode("conflict");
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.tunnel_conflict" });
    await configuredRemote(f, "ready");
    await expect(f.client.refresh()).resolves.toMatchObject({ installation: { state: "active" } });
    expect(f.submissions()).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it("does not turn a control request's placement-conflict response into a terminal tunnel refusal", async () => {
  const f = await fixture();
  try {
    f.fail("placement_conflict", 409);
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect((await f.saved()).lifecycle.tunnelConflict).toBeUndefined();
  } finally {
    await f.close();
  }
});

it("refuses a FIFO public-key file without waiting for a writer", async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, "public-key");
    await rm(path);
    execFileSync("mkfifo", [path]);
    const script = `import { createCloudConnection } from ${JSON.stringify(new URL("./cloud-client.ts", import.meta.url).href)};
      try { await createCloudConnection(${JSON.stringify(f.options)}).refresh(); console.log("resolved"); }
      catch(error) { console.log(error.code); }`;
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { timeout: 8000 },
    ).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    expect(
      result.error,
      "the key read must finish without a child-process timeout",
    ).toBeUndefined();
    expect(result.value?.stdout.trim()).toBe("cloud.tunnel_unavailable");
    expect(f.submissions()).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 15000);
