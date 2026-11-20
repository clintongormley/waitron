import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as fs from "node:fs/promises";
import { syncsAndRenames, writtenDurably } from "./testing/durable-writes.js";
import { expect, it, vi } from "vitest";
import { cloudFixture as fixture } from "../test/cloud-fixture.js";
import { createCloudConnection, loadCloudOrigin } from "./cloud-client.js";
import { createCloudArchiveTarget } from "./cloud-archive-target.js";
vi.mock("node:fs/promises", { spy: true });

it("saves the connection under cloud with private permissions and both flushes", async () => {
  const f = await fixture();
  try {
    f.reject();
    const events = await syncsAndRenames(
      { mkdir: vi.mocked(fs.mkdir), open: vi.mocked(fs.open), rename: vi.mocked(fs.rename) },
      () =>
        createCloudConnection(f.options)
          .start()
          .catch(() => undefined),
    );
    const folder = join(f.stateDir, "cloud");
    const path = join(folder, "connection.json");
    expect(JSON.parse(await readFile(path, "utf8")).venueId).toBe(f.venueId);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect(writtenDurably(events, path, folder)).toBe(true);
    const created = events.indexOf(`mkdir ${folder}`);
    expect(created).not.toBe(-1);
    expect(events.indexOf(`sync ${f.stateDir}`, created)).toBeGreaterThan(created);
  } finally {
    await f.close();
  }
});

it("flushes the Cloud parent when an unpaired Cloud backup attempt precedes pairing", async () => {
  const f = await fixture();
  try {
    f.reject();
    const client = createCloudConnection(f.options);
    const never = async (): Promise<never> => {
      throw new Error("unpaired target must not capture");
    };
    const target = createCloudArchiveTarget({
      stateDir: f.stateDir,
      connection: client,
      sourceNodeId: randomUUID(),
      isPrimary: () => true,
      upload: never,
    });
    const events = await syncsAndRenames(
      { mkdir: vi.mocked(fs.mkdir), open: vi.mocked(fs.open), rename: vi.mocked(fs.rename) },
      async () => {
        await expect(
          target.store({
            entries: async function* () {
              yield await never();
            },
            plaintextBytes: 1,
            modules: {},
            at: new Date(),
            clock: { timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] },
            signal: new AbortController().signal,
          }),
        ).resolves.toEqual({ stored: false, errorCode: "cloud.unavailable" });
        await expect(client.start()).rejects.toMatchObject({ code: "cloud.unavailable" });
      },
    );
    expect(events, "the state folder must persist its new cloud entry").toContain(
      "sync " + f.stateDir,
    );
  } finally {
    await f.close();
  }
});

it("requires a pinned secure Cloud origin except explicit loopback development", () => {
  expect(loadCloudOrigin({})).toBeUndefined();
  expect(loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: "" })).toBeUndefined();
  expect(loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: "https://cloud.waitron.test" })).toBe(
    "https://cloud.waitron.test",
  );
  expect(
    loadCloudOrigin({ WAITRON_ENV: "dev", WAITRON_CLOUD_ORIGIN: "http://127.0.0.1:8000" }),
  ).toBe("http://127.0.0.1:8000");
  for (const origin of [
    "http://cloud.example",
    "https://cloud.example/path",
    "https://user:secret@cloud.example",
    "https://cloud.example/",
    "https://cloud.example#fragment",
  ])
    expect(() => loadCloudOrigin({ WAITRON_CLOUD_ORIGIN: origin })).toThrow();
  expect(() =>
    loadCloudOrigin({ WAITRON_ENV: "production", WAITRON_CLOUD_ORIGIN: "http://127.0.0.1:8000" }),
  ).toThrow();
});
it("persists before sending, resumes a failed start after restart and never exposes the private key", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    expect((await client.status()).state).toBe("not_connected");
    f.reject();
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.unavailable" });
    const before = await readFile(join(f.stateDir, "cloud/connection.json"), "utf8");
    const unsent = await client.status();
    expect(unsent.code).toMatch(/^\d{8}$/);
    expect(unsent.openCloudUrl).toBe(
      `${f.options.origin}/connect#request=${unsent.requestId}&code=${unsent.code}`,
    );
    expect((await stat(join(f.stateDir, "cloud/connection.json"))).mode & 0o777).toBe(0o600);
    f.accept();
    const resumed = createCloudConnection(f.options);
    const status = await resumed.start();
    expect(f.requests[0]!.slice(3, 10)).toEqual(f.requests[1]!.slice(3, 10));
    expect(status.state).toBe("awaiting_cloud");
    expect(status.venueId).toBe(f.venueId);
    expect(status.environment).toBe("test");
    expect(JSON.stringify(status)).not.toContain(JSON.parse(before).privateKey);
    expect(status.code).toMatch(/^\d{8}$/);
    expect(status.openCloudUrl).toBe(
      `${f.options.origin}/connect#request=${status.requestId}&code=${status.code}`,
    );
  } finally {
    await f.close();
  }
});
it("requires explicit bound local confirmation and checks authority again after the Cloud read", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    f.approve();
    const approved = await client.check();
    expect(approved.state).toBe("awaiting_local");
    expect(approved.openCloudUrl).toBe(`${f.options.origin}/connect#request=${approved.requestId}`);
    const approvedPath = join(f.stateDir, "cloud/connection.json");
    const approvedFile = await readFile(approvedPath, "utf8");
    for (const patch of [{ organisationId: randomUUID() }, { legalBusinessId: randomUUID() }]) {
      f.patchReply(patch);
      await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(await readFile(approvedPath, "utf8")).toBe(approvedFile);
    }
    f.patchReply({});
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    const choice = {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    };
    await expect(
      client.complete({ ...choice, legalBusinessId: randomUUID() }, async () => {}),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    await expect(
      client.complete(choice, async () => {
        throw new Error("authority lost");
      }),
    ).rejects.toThrow("authority lost");
    expect(f.requests.some((v) => v[2] === "complete")).toBe(false);
    const complete = await client.complete(choice, async () => {});
    expect(complete.state).toBe("complete");
    expect(complete.code).toBe("");
    expect(complete.openCloudUrl).toBe(`${f.options.origin}/connect#request=${complete.requestId}`);
    expect(complete.registration?.installationId).toBe(f.installationId);
    const restarted = createCloudConnection(f.options);
    expect((await restarted.check()).registration).toEqual(complete.registration);
    expect((await restarted.status()).code).toBe("");
    const path = join(f.stateDir, "cloud/connection.json");
    const before = await readFile(path, "utf8");
    for (const patch of [
      { registration: { ...complete.registration, installationId: randomUUID() } },
      { registration: { ...complete.registration, venueId: randomUUID() } },
    ]) {
      f.patchReply(patch);
      await expect(restarted.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(await readFile(path, "utf8")).toBe(before);
    }
    await chmod(path, 0o644);
    await expect(restarted.status()).rejects.toMatchObject({ code: "cloud.state_invalid" });
  } finally {
    await f.close();
  }
});
async function revokedConnection(
  f: Awaited<ReturnType<typeof fixture>>,
  saved: Record<string, unknown> = {},
) {
  const forgetVenueId = vi.fn(f.options.forgetVenueId);
  const options = { ...f.options, forgetVenueId };
  const client = createCloudConnection(options);
  await client.start();
  f.approve();
  const approved = await client.check();
  await client.complete(
    {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    },
    async () => {},
  );
  const path = join(f.stateDir, "cloud/connection.json");
  const old = JSON.parse(await readFile(path, "utf8"));
  await writeFile(
    path,
    JSON.stringify({ ...old, ...saved, lifecycle: { unavailable: false, revoked: true } }),
    { mode: 0o600 },
  );
  f.forgetPairings();
  return { client, options, forgetVenueId, path, old };
}
it("connects again with a new key and no Cloud venue only once the installation was revoked", async () => {
  const f = await fixture();
  try {
    const reconnect = vi.fn(async () => {});
    const { client, options, forgetVenueId, path, old } = await revokedConnection(f);
    await writeFile(path, JSON.stringify({ ...old, lifecycle: undefined }), { mode: 0o600 });
    const sent = f.requests.length;
    expect((await client.start(false, reconnect)).state).toBe("complete");
    expect(f.requests).toHaveLength(sent);
    expect(reconnect).not.toHaveBeenCalled();
    expect(forgetVenueId).not.toHaveBeenCalled();
    await writeFile(
      path,
      JSON.stringify({ ...old, lifecycle: { unavailable: false, revoked: true } }),
      { mode: 0o600 },
    );
    const again = await client.start(false, reconnect);
    expect(reconnect).toHaveBeenCalledOnce();
    expect(forgetVenueId).toHaveBeenCalledOnce();
    expect(reconnect.mock.invocationCallOrder[0]).toBeLessThan(
      forgetVenueId.mock.invocationCallOrder[0]!,
    );
    expect(await options.readVenueId()).toBeNull();
    expect(again.state).toBe("awaiting_cloud");
    expect(again.requestId).not.toBe(old.requestId);
    const request = f.requests.at(-1)!;
    expect(request[2]).toBe("start");
    expect(request[3]).not.toBe(old.requestId);
    expect(request[4]).not.toBe(old.publicKey);
    expect(request[5]).toBe("");
  } finally {
    await f.close();
  }
});
it("keeps a revoked installation when Start or Start again is pressed without Connect again", async () => {
  const f = await fixture();
  try {
    const { client, options, forgetVenueId, path, old } = await revokedConnection(f);
    const before = await readFile(path, "utf8");
    const sent = f.requests.length;
    for (const restart of [false, true]) {
      const status = await client.start(restart);
      expect(status.state).toBe("complete");
      expect(status.installation?.state).toBe("revoked");
    }
    expect(f.requests).toHaveLength(sent);
    expect(forgetVenueId).not.toHaveBeenCalled();
    expect(await options.readVenueId()).toBe(old.venueId);
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await f.close();
  }
});
it("Connect again from a stale page changes nothing once a new pairing has begun", async () => {
  const f = await fixture();
  try {
    const { client, options, forgetVenueId, path } = await revokedConnection(f);
    const begun = await client.start(false, async () => {});
    const before = await readFile(path, "utf8");
    const sent = f.requests.length;
    const reconnect = vi.fn(async () => {});
    expect(await client.start(false, reconnect)).toEqual(begun);
    expect(reconnect).not.toHaveBeenCalled();
    expect(forgetVenueId).toHaveBeenCalledOnce();
    expect(f.requests).toHaveLength(sent);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await options.readVenueId()).toBeNull();
  } finally {
    await f.close();
  }
});
it("checks authority again inside the lock before Connect again forgets the Cloud venue", async () => {
  const f = await fixture();
  try {
    const { client, options, forgetVenueId, path, old } = await revokedConnection(f);
    const before = await readFile(path, "utf8");
    const sent = f.requests.length;
    await expect(
      client.start(false, async () => {
        throw new Error("authority lost");
      }),
    ).rejects.toThrow("authority lost");
    expect(forgetVenueId).not.toHaveBeenCalled();
    expect(await options.readVenueId()).toBe(old.venueId);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(f.requests).toHaveLength(sent);
    expect((await client.status()).installation?.state).toBe("revoked");
  } finally {
    await f.close();
  }
});
it("a box that forgot its Cloud venue before saving the new pairing reads as not connected and pairs afresh", async () => {
  const f = await fixture();
  try {
    const { client, options, path, old } = await revokedConnection(f);
    await options.forgetVenueId();
    expect(JSON.parse(await readFile(path, "utf8")).requestId).toBe(old.requestId);
    expect((await client.status()).state).toBe("not_connected");
    const again = await client.start(false, async () => {});
    expect(again.state).toBe("awaiting_cloud");
    const request = f.requests.at(-1)!;
    expect(request[2]).toBe("start");
    expect(request[3]).not.toBe(old.requestId);
    expect(request[4]).not.toBe(old.publicKey);
    expect(request[5]).toBe("");
  } finally {
    await f.close();
  }
});
it("Connect again keeps remote access off through a lost reply and the new pairing", async () => {
  const f = await fixture();
  try {
    const { client, path } = await revokedConnection(f, { remoteAccessEnabled: false });
    f.reject();
    await expect(client.start(false, async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(JSON.parse(await readFile(path, "utf8")).remoteAccessEnabled).toBe(false);
    f.accept();
    await client.start();
    f.approve();
    const approved = await client.check();
    const complete = await client.complete(
      {
        requestId: approved.requestId!,
        organisationId: f.organisationId,
        legalBusinessId: f.legalBusinessId,
      },
      async () => {},
    );
    expect(complete.state).toBe("complete");
    expect(complete.remoteAccessEnabled).toBe(false);
    expect((await createCloudConnection(f.options).status()).remoteAccessEnabled).toBe(false);
  } finally {
    await f.close();
  }
});
it("rejects changed binding, malformed state, and mismatched replies without overwriting the recorded state", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    const before = await readFile(join(f.stateDir, "cloud/connection.json"), "utf8");
    await expect(
      createCloudConnection({ ...f.options, readVenueId: async () => randomUUID() }).status(),
    ).rejects.toMatchObject({ code: "cloud.state_invalid" });
    f.bad();
    await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8")).toBe(before);
    await mkdir(join(f.stateDir, "cloud"), { recursive: true });
    await writeFile(join(f.stateDir, "cloud/connection.json"), "broken");
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.state_invalid" });
  } finally {
    await f.close();
  }
});

it("recovers a committed completion with a lost reply and refuses overlapping local operations", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    f.approve();
    const approved = await client.check();
    f.loseCompletion();
    const choice = {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    };
    await expect(client.complete(choice, async () => {})).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    f.onStatus(() => {
      entered();
      return new Promise<void>((r) => {
        release = r;
      });
    });
    const restarted = createCloudConnection(f.options);
    const checking = restarted.check();
    await waiting;
    await expect(client.start()).rejects.toMatchObject({ code: "cloud.busy" });
    release();
    expect((await checking).registration?.installationId).toBe(f.installationId);
  } finally {
    await f.close();
  }
});

it.each(["view", "registration"] as const)(
  "refuses another venue's %s without changing the binding",
  async (field) => {
    const f = await fixture();
    try {
      const client = createCloudConnection(f.options);
      await client.start();
      f.approve();
      const approved = await client.check();
      const path = join(f.stateDir, "cloud/connection.json");
      const before = await readFile(path, "utf8");
      f.patchReply(
        field === "view"
          ? { venueId: "" }
          : {
              registration: {
                venueId: randomUUID(),
                installationId: f.installationId,
                organisationId: f.organisationId,
                legalBusinessId: f.legalBusinessId,
              },
            },
      );
      await expect(
        client.complete(
          {
            requestId: approved.requestId!,
            organisationId: f.organisationId,
            legalBusinessId: f.legalBusinessId,
          },
          async () => {},
        ),
      ).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(await f.options.readVenueId()).toBe(f.venueId);
      expect(await readFile(path, "utf8")).toBe(before);
    } finally {
      await f.close();
    }
  },
);
it("rejects oversized replies and redirects", async () => {
  for (const kind of ["oversized", "redirect"] as const) {
    const f = await fixture();
    try {
      const client = createCloudConnection(f.options);
      await client.start();
      f[kind]();
      await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(f.requests).toHaveLength(2);
    } finally {
      await f.close();
    }
  }
});
it("starts again only after Cloud refuses the old request, retaining the installation key", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    const first = await client.start();
    await expect(client.start(true)).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    f.unavailable();
    await expect(client.start(true)).rejects.toMatchObject({ code: "cloud.request_unavailable" });
    f.available();
    const next = await client.start();
    expect(next.requestId).not.toBe(first.requestId);
    expect(f.requests[0]![4]).toBe(f.requests.at(-1)![4]);
    expect(next.code).toMatch(/^\d{8}$/);
  } finally {
    await f.close();
  }
});

it("emits the fixed version-three wire vector shared with Cloud", async () => {
  const f = await fixture();
  const v = JSON.parse(
    await readFile(new URL("../test/cloud-pairing-vector.json", import.meta.url), "utf8"),
  );
  expect(createHash("sha256").update(Buffer.from(v.payload, "base64url")).digest("hex")).toBe(
    v.sha256,
  );
  const options = {
    ...f.options,
    origin: v.claims.origin,
    readVenueId: async () => null,
    readVenueName: async () => v.claims.venueName,
  };
  await mkdir(join(f.stateDir, "cloud"), { recursive: true });
  await writeFile(
    join(f.stateDir, "cloud/connection.json"),
    JSON.stringify({
      version: 2,
      origin: v.claims.origin,
      requestId: v.claims.requestId,
      venueId: v.claims.venueId,
      environment: "test",
      code: v.claims.code,
      privateKey: v.privateKey,
      publicKey: v.claims.publicKey,
    }),
    { mode: 0o600 },
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(v.claims.issuedAt);
  const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe(v.claims.origin + "/api/pairing/start");
    expect(JSON.parse(init!.body as string)).toEqual({
      payload: v.payload,
      signature: v.signature,
    });
    return Response.json({
      requestId: v.claims.requestId,
      venueId: v.claims.venueId,
      environment: "test",
      expiresAt: new Date(v.claims.issuedAt + 600000).toISOString(),
      state: "awaiting_cloud",
    });
  });
  try {
    await createCloudConnection(options).start();
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    send.mockRestore();
    clock.mockRestore();
    await f.close();
  }
});

it("signs the trimmed venue name into start only, as empty on status and complete", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection({
      ...f.options,
      readVenueName: async () => "  Bar Pepe  ",
    });
    await client.start();
    f.approve();
    const approved = await client.check();
    await client.complete(
      {
        requestId: approved.requestId!,
        organisationId: f.organisationId,
        legalBusinessId: f.legalBusinessId,
      },
      async () => {},
    );
    expect(f.requests.map((v) => [v[2], v[11]])).toEqual([
      ["start", "Bar Pepe"],
      ["status", ""],
      ["status", ""],
      ["complete", ""],
    ]);
  } finally {
    await f.close();
  }
});

it("sends a long venue name capped at 120 characters", async () => {
  const f = await fixture();
  try {
    await createCloudConnection({
      ...f.options,
      readVenueName: async () => "a".repeat(130),
    }).start();
    expect(f.requests[0]![11]).toBe("a".repeat(120));
  } finally {
    await f.close();
  }
});

it("stamps the start proof's time after the venue name read finishes", async () => {
  const f = await fixture();
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await createCloudConnection({
      ...f.options,
      readVenueName: async () => {
        now += 60001;
        return "Bar Pepe";
      },
    }).start();
    expect(f.requests[0]![10]).toBe(now);
  } finally {
    clock.mockRestore();
    await f.close();
  }
});

it("records Cloud's id before the pairing file and keeps the empty request binding on retries", async () => {
  const f = await fixture();
  let stored: string | null = null;
  const path = join(f.stateDir, "cloud/connection.json");
  let fileAtRecord: unknown;
  const options = {
    ...f.options,
    readVenueId: async () => stored,
    recordVenueId: async (id: string) => {
      fileAtRecord = JSON.parse(await readFile(path, "utf8"));
      stored = id;
    },
  };
  try {
    const client = createCloudConnection(options);
    await client.start();
    expect(f.requests[0]![0]).toBe("waitron-cloud-pair-v3");
    expect(f.requests[0]![5]).toBe("");
    f.approve();
    const approved = await client.check();
    const choice = {
      requestId: approved.requestId!,
      organisationId: f.organisationId,
      legalBusinessId: f.legalBusinessId,
    };
    const completed = await client.complete(choice, async () => {});
    expect(completed.venueId).toBe(f.venueId);
    expect(stored).toBe(f.venueId);
    expect(fileAtRecord).toMatchObject({ venueId: "", view: { state: "awaiting_local" } });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 2,
      venueId: f.venueId,
    });
    await createCloudConnection(options).check();
    expect(f.requests.every((v) => v[5] === "")).toBe(true);
    // A new request presents the id already saved in the venue database.
    await fs.unlink(path);
    await createCloudConnection(options).start();
    expect(f.requests.at(-1)![5]).toBe(f.venueId);
  } finally {
    await f.close();
  }
});

it("recovers the pairing file after the venue id was committed but its file save failed", async () => {
  const f = await fixture();
  let stored: string | null = null;
  const path = join(f.stateDir, "cloud/connection.json");
  const options = {
    ...f.options,
    readVenueId: async () => stored,
    recordVenueId: async (id: string): Promise<void> => {
      stored = id;
      throw new Error("power cut after database commit");
    },
  };
  try {
    const client = createCloudConnection(options);
    await client.start();
    f.approve();
    const approved = await client.check();
    await expect(
      client.complete(
        {
          requestId: approved.requestId!,
          organisationId: f.organisationId,
          legalBusinessId: f.legalBusinessId,
        },
        async () => {},
      ),
    ).rejects.toThrow("power cut after database commit");
    expect(stored).toBe(f.venueId);
    expect(JSON.parse(await readFile(path, "utf8")).venueId).toBe("");
    options.recordVenueId = async (id) => {
      stored = id;
    };
    const restarted = createCloudConnection(options);
    const before = await readFile(path, "utf8");
    f.patchReply({
      registration: {
        venueId: randomUUID(),
        installationId: f.installationId,
        organisationId: f.organisationId,
        legalBusinessId: f.legalBusinessId,
      },
    });
    await expect(restarted.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(stored).toBe(f.venueId);
    expect(await readFile(path, "utf8")).toBe(before);
    f.patchReply({});
    expect((await restarted.check()).state).toBe("complete");
    expect(JSON.parse(await readFile(path, "utf8")).venueId).toBe(f.venueId);
    expect(f.requests.at(-1)![5]).toBe("");
  } finally {
    await f.close();
  }
});

it("treats a version-one connection file as not connected for status, refresh, revoke and start", async () => {
  const f = await fixture();
  const path = join(f.stateDir, "cloud/connection.json");
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    const saved = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...saved, version: 1 }));
    expect((await client.status()).state).toBe("not_connected");
    expect((await client.refresh()).state).toBe("not_connected");
    await expect(client.revoke(async () => {})).rejects.toMatchObject({
      code: "cloud.binding_conflict",
    });
    expect((await client.start()).requestId).not.toBe(saved.requestId);
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
  } finally {
    await f.close();
  }
});

it("refuses a list-valued pairing state on reply and reload without replacing saved facts", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
    await client.start();
    f.approve();
    await client.check();
    const path = join(f.stateDir, "cloud/connection.json");
    const before = await readFile(path, "utf8");
    f.patchReply({ state: ["awaiting_local"] });
    await expect(client.check()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await readFile(path, "utf8")).toBe(before);
    const saved = JSON.parse(before);
    saved.view.state = ["awaiting_local"];
    await writeFile(path, JSON.stringify(saved));
    await expect(createCloudConnection(f.options).status()).rejects.toMatchObject({
      code: "cloud.state_invalid",
    });
  } finally {
    await f.close();
  }
});

it.each([
  { bytes: 16384, accepted: true },
  { bytes: 16385, accepted: false },
])("bounds valid pairing JSON at $bytes bytes", async ({ bytes, accepted }) => {
  const f = await fixture();
  try {
    f.padReply(bytes);
    const result = createCloudConnection(f.options).start();
    if (accepted) expect((await result).state).toBe("awaiting_cloud");
    else await expect(result).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    await f.close();
  }
});
