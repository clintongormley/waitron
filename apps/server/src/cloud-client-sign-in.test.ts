import { AppError } from "@waitron/shared";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { cloudFixture as fixture } from "../test/cloud-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

async function installedSignInFixture(setup = false, provisional = false) {
  const callback = "https://box.waitron.test/cloud/pairing/callback";
  const code = randomBytes(32).toString("base64url");
  const key = generateKeyPairSync("ed25519");
  let attemptState = "awaiting_cloud";
  let challenge = "";
  let registered = false;
  let loseComplete = false;
  let loseRedeem = false;
  let expiredRequest: unknown;
  let wrongLogin = false;
  const validProfile: Extract<
    import("@waitron/contract").PairingV4Claims,
    { action: "complete" }
  >["args"] = [
    "ES",
    "Bar Pepe",
    ["First", "", "28001", "Madrid", "Madrid"],
    "B-12345678",
    "Pepe SL",
  ];
  let profile = validProfile;
  const publicKey = key.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const nodeId = randomUUID();
  let published = false;
  const f = await fixture(undefined, "test", async (values, _saved, _req, res) => {
    const [, origin, action, requestId, presentedKey, , , args] = values;
    if (
      action === "status" &&
      ((requestId === expiredRequest && !registered) || presentedKey !== publicKey)
    ) {
      res.writeHead(400);
      res.end('{"error":"pairing_unavailable"}');
      return;
    }
    const answer: Record<string, unknown> = {
      requestId,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    if (action === "start") {
      attemptState = "awaiting_cloud";
      const [redirectUri, state, codeChallenge] = args as string[];
      expect(redirectUri).toBe(callback);
      challenge = codeChallenge!;
      const url = new URL("/login", origin as string);
      url.search = new URLSearchParams({
        request_id: requestId as string,
        state: state!,
        code_challenge: wrongLogin ? code : challenge,
        code_challenge_method: "S256",
      }).toString();
      answer.authorizationUrl = url.href;
    } else if (action === "redeem") {
      const [submitted, verifier] = args as string[];
      expect(submitted).toBe(code);
      expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(challenge);
      attemptState = "account_bound";
      if (loseRedeem) {
        res.destroy();
        return;
      }
    } else if (action === "complete") {
      registered = true;
      attemptState = "complete";
      if (loseComplete) {
        res.destroy();
        return;
      }
    }
    answer.state = attemptState;
    if (registered || (provisional && attemptState === "account_bound"))
      answer[registered ? "registration" : "provisionalRegistration"] = {
        venueId: f.venueId,
        installationId: f.installationId,
        organisationId: f.organisationId,
        legalBusinessId: f.legalBusinessId,
      };
    res.end(JSON.stringify(answer));
  });
  await f.options.forgetVenueId();
  await mkdir(join(f.stateDir, "cloud"), { mode: 0o700 });
  const privateKey = key.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
  await writeFile(
    join(f.stateDir, "cloud/connection.json"),
    JSON.stringify({ version: 4, origin: f.options.origin, publicKey, privateKey }),
    { mode: 0o600 },
  );
  const options = {
    ...f.options,
    readVenueId: async () => {
      if (setup && !published) throw new AppError("venue.not_found", {});
      return f.options.readVenueId();
    },
    signIn: {
      callback,
      setup,
      readProfile: async () => profile,
      currentNodeId: () => (published ? nodeId : undefined),
    },
  };
  return {
    ...f,
    client: (configured = true) => createCloudConnection(configured ? options : f.options),
    binding: { tab: randomUUID(), session: randomUUID() },
    nodeId,
    restartAsPublished: () => {
      published = true;
      return createCloudConnection({ ...options, signIn: { ...options.signIn, setup: false } });
    },
    authorize: async () => {},
    code,
    loseRedeem: () => {
      loseRedeem = true;
    },
    loseComplete: () => {
      loseComplete = true;
    },
    wrongLogin: () => {
      wrongLogin = true;
    },
    expire: () => {
      expiredRequest = f.requests.at(-1)?.[3];
    },
    invalidProfile: (name = "Bar\uD800") => {
      profile = ["ES", name, validProfile[2], validProfile[3], validProfile[4]];
    },
    correctProfile: () => {
      profile = validProfile;
    },
  };
}

async function rememberSetupStaffEmail(stateDir: string) {
  const path = join(stateDir, "cloud/connection.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.attempt.emailRelayEnabled = true;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
}

it.each([false, true])(
  "files early setup only after local publication (provisional IDs: %s)",
  async (provisional) => {
    const f = await installedSignInFixture(true, provisional);
    try {
      const client = f.client();
      const binding = { ...f.binding, kind: "setup" as const };
      const { authorizationUrl } = await client.startSignIn(binding, f.authorize);
      expect(f.requests[0]?.[0]).toBe("waitron-cloud-pair-v5");
      const query = new URL(authorizationUrl!).searchParams;
      const reply = {
        requestId: query.get("request_id")!,
        state: query.get("state")!,
        code: f.code,
      };
      await expect(client.returnSignIn(f.binding, reply, f.authorize)).rejects.toMatchObject({
        code: "cloud.binding_conflict",
      });
      await client.returnSignIn(binding, reply, f.authorize);
      expect(f.requests.map((request) => request[2])).toEqual(["start", "redeem"]);
      expect(await f.options.readVenueId()).toBeNull();

      const restarted = f.restartAsPublished();
      await client.publishSetupSignIn({ ...binding, tab: randomUUID() }, f.nodeId);
      await restarted.refresh();
      expect(f.requests.map((request) => request[2])).toEqual(["start", "redeem"]);

      await client.publishSetupSignIn(binding, f.nodeId);
      if (provisional) await rememberSetupStaffEmail(f.stateDir);
      f.loseComplete();
      await expect(restarted.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(await f.options.readVenueId()).toBeNull();
      await restarted.refresh();
      expect(f.requests.map((request) => request[2])).toEqual([
        "start",
        "redeem",
        "status",
        "complete",
        "status",
      ]);
      expect(await f.options.readVenueId()).toBe(f.venueId);
      expect(await restarted.emailRelayEnabled()).toBe(provisional);
    } finally {
      await f.close();
    }
  },
);

it.each(["restart sign-in", "retry callback"])(
  "recovers a lost setup redemption reply on %s",
  async (retry) => {
    const f = await installedSignInFixture(true, true);
    try {
      const binding = { ...f.binding, kind: "setup" as const };
      const { authorizationUrl } = await f.client().startSignIn(binding, f.authorize);
      const query = new URL(authorizationUrl!).searchParams;
      const proof = {
        requestId: query.get("request_id")!,
        state: query.get("state")!,
        code: f.code,
      };
      f.loseRedeem();
      await expect(f.client().returnSignIn(binding, proof, f.authorize)).rejects.toMatchObject({
        code: "cloud.unavailable",
      });

      const restarted = f.client();
      const recover = (authorize: () => Promise<void>, from = binding) =>
        retry === "restart sign-in"
          ? restarted.startSignIn(from, authorize)
          : restarted.returnSignIn(from, proof, authorize);
      await expect(recover(f.authorize, { ...binding, tab: randomUUID() })).rejects.toMatchObject({
        code: "cloud.binding_conflict",
      });
      await expect(
        recover(async () => {
          if (f.requests.at(-1)?.[2] === "status") throw new AppError("setup.owner_required", {});
        }),
      ).rejects.toMatchObject({ code: "setup.owner_required" });
      await expect(recover(f.authorize)).resolves.toEqual(
        retry === "restart sign-in" ? {} : undefined,
      );
      expect(f.requests.map((request) => request[2])).toEqual([
        "start",
        "redeem",
        "status",
        "status",
      ]);
      await expect(
        restarted.setupAddressLookup(binding, undefined, f.authorize, new AbortController().signal),
      ).resolves.toEqual({ available: true });
      await expect(f.options.readVenueId()).resolves.toBeNull();
    } finally {
      await f.close();
    }
  },
);

it("lets the dashboard start its own sign-in if the installer left Cloud before returning", async () => {
  const f = await installedSignInFixture(true);
  try {
    await f.client().startSignIn({ ...f.binding, kind: "setup" }, f.authorize);
    const dashboard = f.restartAsPublished();
    const result = await dashboard.startSignIn(
      { tab: randomUUID(), session: randomUUID() },
      f.authorize,
    );
    expect(result.authorizationUrl).toContain("/login");
    expect(f.requests.map((request) => request[0])).toEqual([
      "waitron-cloud-pair-v5",
      "waitron-cloud-pair-v4",
    ]);
  } finally {
    await f.close();
  }
});

it.each([
  { failure: "expired before save", provisional: false, beforeSave: true },
  { failure: "expired after save", provisional: false, beforeSave: false },
  { failure: "signed out", provisional: true, beforeSave: false },
])("uses a fresh dashboard sign-in after setup $failure", async ({ provisional, beforeSave }) => {
  const f = await installedSignInFixture(true, provisional);
  try {
    const setup = f.client();
    const setupBinding = { ...f.binding, kind: "setup" as const };
    const original = new URL((await setup.startSignIn(setupBinding, f.authorize)).authorizationUrl!)
      .searchParams;
    await setup.returnSignIn(
      setupBinding,
      { requestId: original.get("request_id")!, state: original.get("state")!, code: f.code },
      f.authorize,
    );
    const invalidateCloudSignIn = () => {
      f.expire();
      if (!provisional) vi.setSystemTime(Date.now() + 600_001);
    };
    if (beforeSave) invalidateCloudSignIn();
    await setup.publishSetupSignIn(setupBinding, f.nodeId);
    if (provisional) await rememberSetupStaffEmail(f.stateDir);
    if (!beforeSave) invalidateCloudSignIn();
    const dashboard = f.restartAsPublished();
    if (provisional)
      await expect(dashboard.refresh()).rejects.toMatchObject({
        code: "cloud.request_unavailable",
      });

    const manager = { tab: randomUUID(), session: randomUUID() };
    const getReturn = async () => {
      const { authorizationUrl } = await dashboard.startSignIn(manager, f.authorize);
      const query = new URL(authorizationUrl!).searchParams;
      return { requestId: query.get("request_id")!, state: query.get("state")! };
    };
    const cancelled = await getReturn();
    await expect(
      dashboard.returnSignIn(manager, { ...cancelled, error: "access_denied" }, f.authorize),
    ).rejects.toMatchObject({ code: "cloud.request_unavailable" });
    const beforeLateReturn = f.requests.length;
    await expect(
      dashboard.returnSignIn(manager, { ...cancelled, code: f.code }, f.authorize),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    expect(f.requests).toHaveLength(beforeLateReturn);
    const resumed = await getReturn();
    expect(resumed.requestId).not.toBe(cancelled.requestId);
    expect(resumed.requestId).not.toBe(original.get("request_id"));
    await expect(
      dashboard.returnSignIn(
        { ...manager, session: randomUUID() },
        { ...resumed, code: f.code },
        f.authorize,
      ),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    expect(await f.options.readVenueId()).toBeNull();
    await f.restartAsPublished().returnSignIn(manager, { ...resumed, code: f.code }, f.authorize);

    const originalKey = f.requests[0]![4];
    const recovery = f.requests.filter((request) => request[3] === resumed.requestId);
    expect(recovery.map(([version, , action, , key]) => [version, action, key])).toEqual([
      ["waitron-cloud-pair-v5", "start", originalKey],
      ["waitron-cloud-pair-v5", "redeem", originalKey],
      ["waitron-cloud-pair-v5", "complete", originalKey],
    ]);
    expect((await dashboard.status()).registration?.installationId).toBe(f.installationId);
    expect(await f.options.readVenueId()).toBe(f.venueId);
    expect(await dashboard.emailRelayEnabled()).toBe(provisional);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

it("finishes a still-current published setup sign-in when the dashboard connects", async () => {
  const f = await installedSignInFixture(true, true);
  try {
    const setup = f.client();
    const binding = { ...f.binding, kind: "setup" as const };
    const { authorizationUrl } = await setup.startSignIn(binding, f.authorize);
    const query = new URL(authorizationUrl!).searchParams;
    await setup.returnSignIn(
      binding,
      { requestId: query.get("request_id")!, state: query.get("state")!, code: f.code },
      f.authorize,
    );
    await setup.publishSetupSignIn(binding, f.nodeId);
    const dashboard = f.restartAsPublished();

    const manager = { tab: randomUUID(), session: randomUUID() };
    await expect(dashboard.startSignIn(manager, f.authorize)).resolves.toEqual({});
    expect(f.requests.map((request) => request[2])).toEqual([
      "start",
      "redeem",
      "status",
      "complete",
    ]);
    expect(await f.options.readVenueId()).toBe(f.venueId);
  } finally {
    await f.close();
  }
});

it("reads the filed registration after a lost setup completion reply followed by expiry", async () => {
  const f = await installedSignInFixture(true, true);
  try {
    const setup = f.client();
    const binding = { ...f.binding, kind: "setup" as const };
    const { authorizationUrl } = await setup.startSignIn(binding, f.authorize);
    const query = new URL(authorizationUrl!).searchParams;
    await setup.returnSignIn(
      binding,
      { requestId: query.get("request_id")!, state: query.get("state")!, code: f.code },
      f.authorize,
    );
    await setup.publishSetupSignIn(binding, f.nodeId);
    const dashboard = f.restartAsPublished();
    f.loseComplete();
    await expect(dashboard.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.expire();
    vi.setSystemTime(Date.now() + 600_001);

    await expect(dashboard.startSignIn(f.binding, f.authorize)).resolves.toEqual({});
    expect(f.requests.map((request) => request[2])).toEqual([
      "start",
      "redeem",
      "status",
      "complete",
      "status",
    ]);
    expect((await dashboard.status()).registration?.installationId).toBe(f.installationId);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

it("shows a prepared Cloud sign-in key with no callback as unconfigured", async () => {
  const f = await installedSignInFixture();
  try {
    expect(await f.client(false).status()).toMatchObject({ configured: false });
    expect(await f.client().status()).toMatchObject({ sameTabSignIn: true });
  } finally {
    await f.close();
  }
});

it.each(["original tab", "new sign-in", "different box key"])(
  "checks the binding on return and handles lost completion from a %s",
  async (source) => {
    const f = await installedSignInFixture();
    try {
      const client = f.client();
      const { authorizationUrl } = await client.startSignIn(f.binding, f.authorize);
      const query = new URL(authorizationUrl!).searchParams;
      const proof = {
        requestId: query.get("request_id")!,
        state: query.get("state")!,
        code: f.code,
      };
      await expect(
        client.returnSignIn({ ...f.binding, tab: randomUUID() }, proof, f.authorize),
      ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
      await expect(
        client.returnSignIn({ ...f.binding, session: randomUUID() }, proof, f.authorize),
      ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
      expect(f.requests.map((values) => values[2])).toEqual(["start"]);
      f.loseComplete();
      await expect(client.returnSignIn(f.binding, proof, f.authorize)).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
      expect(await f.options.readVenueId()).toBeNull();
      const resumed = f.client();
      const other = { tab: randomUUID(), session: randomUUID() };
      if (source === "different box key") {
        const path = join(f.stateDir, "cloud/connection.json");
        const saved = JSON.parse(await readFile(path, "utf8"));
        const key = generateKeyPairSync("ed25519");
        const publicKey = key.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64url");
        const privateKey = key.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64url");
        await writeFile(path, JSON.stringify({ ...saved, publicKey, privateKey }));
        await expect(resumed.startSignIn(other, f.authorize)).rejects.toMatchObject({
          code: "cloud.binding_conflict",
        });
        expect(await f.options.readVenueId()).toBeNull();
        expect(f.requests.map((values) => values[2])).toEqual([
          "start",
          "redeem",
          "complete",
          "status",
        ]);
        return;
      }
      if (source === "original tab") await resumed.returnSignIn(f.binding, proof, f.authorize);
      else await expect(resumed.startSignIn(other, f.authorize)).resolves.toEqual({});
      expect((await resumed.status()).registration?.installationId).toBe(f.installationId);
      expect(await f.options.readVenueId()).toBe(f.venueId);
      expect(f.requests.map((values) => values[2])).toEqual([
        "start",
        "redeem",
        "complete",
        "status",
      ]);
      expect(f.requests[2]![7]).toEqual([
        "ES",
        "Bar Pepe",
        ["First", "", "28001", "Madrid", "Madrid"],
        "B-12345678",
        "Pepe SL",
      ]);
    } finally {
      await f.close();
    }
  },
);

it("allows a fresh local session to start again after Cloud says the old attempt expired", async () => {
  const f = await installedSignInFixture();
  try {
    const client = f.client();
    const { authorizationUrl } = await client.startSignIn(f.binding, f.authorize);
    const query = new URL(authorizationUrl!).searchParams;
    f.invalidProfile();
    await expect(
      client.returnSignIn(
        f.binding,
        {
          requestId: query.get("request_id")!,
          state: query.get("state")!,
          code: f.code,
        },
        f.authorize,
      ),
    ).rejects.toMatchObject({ code: "cloud.request_invalid" });
    const other = { tab: randomUUID(), session: randomUUID() };
    await expect(client.startSignIn(other, f.authorize)).rejects.toMatchObject({
      code: "cloud.binding_conflict",
    });
    expect(f.requests.map((values) => values[2])).toEqual(["start", "redeem"]);
    f.expire();
    vi.setSystemTime(Date.now() + 600_001);
    const retry = await client.startSignIn(other, f.authorize);
    expect(new URL(retry.authorizationUrl!).searchParams.get("request_id")).not.toBe(
      query.get("request_id"),
    );
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

it("refuses a Cloud login URL with a different challenge", async () => {
  const f = await installedSignInFixture();
  try {
    f.wrongLogin();
    await expect(f.client().startSignIn(f.binding, f.authorize)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await f.close();
  }
});

it.each(["Bar\uD800", "x".repeat(121)])(
  "refuses invalid venue text before sending completion",
  async (name) => {
    const f = await installedSignInFixture();
    try {
      const client = f.client();
      const { authorizationUrl } = await client.startSignIn(f.binding, f.authorize);
      const query = new URL(authorizationUrl!).searchParams;
      f.invalidProfile(name);
      await expect(
        client.returnSignIn(
          f.binding,
          {
            requestId: query.get("request_id")!,
            state: query.get("state")!,
            code: f.code,
          },
          f.authorize,
        ),
      ).rejects.toMatchObject({ code: "cloud.request_invalid" });
      expect(await f.options.readVenueId()).toBeNull();
      expect(f.requests.map((values) => values[2])).toEqual(["start", "redeem"]);
      f.correctProfile();
      await expect(f.client().startSignIn(f.binding, f.authorize)).resolves.toEqual({});
      expect(await f.options.readVenueId()).toBe(f.venueId);
      expect(f.requests[3]![7]).toEqual([
        "ES",
        "Bar Pepe",
        ["First", "", "28001", "Madrid", "Madrid"],
        "B-12345678",
        "Pepe SL",
      ]);
    } finally {
      await f.close();
    }
  },
);
