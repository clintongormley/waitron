import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as fs from "node:fs/promises";
import { syncsAndRenames, writtenDurably } from "./testing/durable-writes.js";
import { expect, it, vi } from "vitest";
import { cloudFixture as fixture } from "../test/cloud-fixture.js";
import { createCloudConnection, loadCloudOrigin } from "./cloud-client.js";
import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
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

it("flushes the Cloud parent when an unpaired snapshot tick precedes pairing", async () => {
  const f = await fixture();
  try {
    f.reject();
    const client = createCloudConnection(f.options);
    const never = async (): Promise<never> => {
      throw new Error("unpaired worker must not capture");
    };
    const worker = createCloudSnapshotWorker({
      stateDir: f.stateDir,
      connection: client,
      sourceNodeId: randomUUID(),
      isPrimary: () => true,
      readClock: never,
      createArchive: never,
      upload: never,
    });
    const events = await syncsAndRenames(
      { mkdir: vi.mocked(fs.mkdir), open: vi.mocked(fs.open), rename: vi.mocked(fs.rename) },
      async () => {
        await worker.tick(new AbortController().signal);
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
    expect((await stat(join(f.stateDir, "cloud/connection.json"))).mode & 0o777).toBe(0o600);
    f.accept();
    const resumed = createCloudConnection(f.options);
    const status = await resumed.start();
    expect(f.requests[0]!.slice(3, 10)).toEqual(f.requests[1]!.slice(3, 10));
    expect(status.state).toBe("awaiting_cloud");
    expect(status.venueId).toBe(f.venueId);
    expect(status.environment).toBe("test");
    expect(JSON.stringify(status)).not.toContain(JSON.parse(before).privateKey);
    expect(status.openCloudUrl).toContain("/connect#request=");
    expect(status.openCloudUrl).not.toContain(status.code);
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

it("emits the fixed version-two wire vector shared with Cloud", async () => {
  const f = await fixture();
  const v = JSON.parse(
    await readFile(new URL("../test/cloud-pairing-vector.json", import.meta.url), "utf8"),
  );
  expect(createHash("sha256").update(Buffer.from(v.payload, "base64url")).digest("hex")).toBe(
    v.sha256,
  );
  const options = { ...f.options, origin: v.claims.origin, readVenueId: async () => null };
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
    expect(f.requests[0]![0]).toBe("waitron-cloud-pair-v2");
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

it("refuses a completed pairing file when the database no longer holds its Cloud id", async () => {
  const f = await fixture();
  try {
    const client = createCloudConnection(f.options);
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
    const before = await readFile(path, "utf8");
    let stored: string | null = null;
    const restarted = createCloudConnection({
      ...f.options,
      readVenueId: async () => stored,
      recordVenueId: async (id) => {
        stored = id;
      },
    });
    await expect(restarted.check()).rejects.toMatchObject({ code: "cloud.state_invalid" });
    expect(stored).toBeNull();
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await f.close();
  }
});
