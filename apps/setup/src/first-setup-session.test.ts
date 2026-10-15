import { afterEach, describe, expect, it } from "vitest";
import { SetupApi, type ProvisionBody } from "./api/client.js";
import type { FirstSetupState } from "./api/first-setup-types.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";

const venue: ProvisionBody["venue"] = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Olivo SL",
  taxpayerDomicile: "Madrid",
  location: {
    name: "Olivo",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
    addressLine1: "Mayor 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    firstNames: "Elena",
    lastNames: "García",
    displayName: "Elena",
    email: "elena@example.test",
    pin: "1357",
    password: "administrator password",
  },
};
const { password: _, pin: __, ...publicAdmin } = venue.admin;
void _;
void __;
const initial: FirstSetupState = {
  attemptId: "bd185bdc-b7dd-4abb-991a-a9c3d613d38e",
  nodeId: "75544019-26d4-4448-91b0-e803a12f7610",
  administratorId: "c67ebebf-632b-4481-9b83-f78cb7ece82f",
  revision: 1,
  ownerGeneration: 1,
  status: "claimed",
  consumptionIntent: false,
  environment: "production",
  venue: { ...venue, admin: publicAdmin },
  modules: [{ module: "example-module", version: "1" }],
};
const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
function json(value: unknown) {
  return Response.json(value);
}
function create(
  handler: (path: string, body: unknown, headers: Headers) => Promise<Response> | Response,
) {
  const requests: { path: string; body: unknown; headers: Headers }[] = [];
  const api = new SetupApi("", async (input, init) => {
    const request = {
      path: String(input),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      headers: new Headers(init?.headers),
    };
    requests.push(request);
    return handler(request.path, request.body, request.headers);
  });
  const session = new FirstSetupSession(api);
  sessions.push(session);
  return { session, requests };
}
const claim = () => json({ state: initial, capability: "A".repeat(43), ownerGeneration: 1 });
const ends = (path: string, suffix: string) => path.endsWith(`/${suffix}`);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("first setup tab ownership", () => {
  it("sends no competing claim after a public read discovers an already claimed venue", async () => {
    const { session, requests } = create(() => json({ claimed: true }));
    await session.open();
    await session.refresh();
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).claimPending).toBe(true);
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(requests.map((r) => r.path)).toEqual(["/setup-api/first-setup/status"]);
  });

  it("allows correction of a refused claim only after a public read confirms that no attempt was created", async () => {
    let claims = 0;
    const { session, requests } = create((path) => {
      if (ends(path, "status")) return json({ claimed: false });
      if (++claims === 1)
        return Response.json(
          { error: { code: "setup.request_invalid", params: { field: "venue.legalName" } } },
          { status: 400 },
        );
      return claim();
    });
    await session.open();
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.request_invalid" });
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.owner_required" });
    await session.refresh();
    expect(session.recoveryRequired).toBe(false);
    await session.claim(venue);
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/claim",
      "/setup-api/first-setup/status",
      "/setup-api/first-setup/claim",
    ]);
    expect(requests[2]!.body).toEqual(requests[0]!.body);
    expect(session.state?.attemptId).toBe(initial.attemptId);
  });

  it("keeps a claim with a lost answer reserved when the public read finds an existing attempt", async () => {
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) throw new TypeError("lost claim answer");
      return json({ claimed: true });
    });
    await session.open();
    await expect(session.claim(venue)).rejects.toThrow("lost claim answer");
    await session.refresh();
    expect(session.recoveryRequired).toBe(true);
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(requests).toHaveLength(2);
  });

  it("drops a public-import answer after its screen is disposed without replacing retained state", async () => {
    const answer = deferred<Response>();
    const started = deferred<void>();
    const { session } = create((path) => {
      if (ends(path, "claim")) return claim();
      started.resolve();
      return answer.promise;
    });
    await session.open();
    await session.claim(venue);
    const pending = session.importInput("example-module", { allocation: "public" });
    await started.promise;
    await session.dispose();
    answer.resolve(json({ state: { ...initial, revision: 2 } }));
    await expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(session.state).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.revision).toBe(1);
  });

  it("also locks the frozen attempt when a second tab presents a different local nonce", async () => {
    const { session } = create(claim);
    await session.open();
    await session.claim(venue);
    let retained = JSON.stringify({
      ...JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!),
      clientClaimNonce: "D".repeat(43),
    });
    const storage = {
      getItem: () => retained,
      setItem: (_key: string, value: string) => {
        retained = value;
      },
    };
    let sent = false;
    const second = new FirstSetupSession(
      new SetupApi("", async () => {
        sent = true;
        return claim();
      }),
      { storage },
    );
    sessions.push(second);
    await expect(second.open()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(sent).toBe(false);
    await session.dispose();
    await second.open();
    expect(second.recoveryRequired).toBe(true);
  });

  it("keeps the newest valid revision when an older status answer arrives", async () => {
    const { session } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "input"))
        return json({ state: { ...initial, revision: 3, status: "consumption-intent" } });
      return json({
        claimed: true,
        state: { ...initial, revision: 2, status: "consumption-intent" },
      });
    });
    await session.open();
    await session.claim(venue);
    await session.importInput("example-module", {});
    await expect(session.refresh()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(session.state?.revision).toBe(3);
  });

  it.each([
    { nodeId: undefined },
    { administratorId: undefined },
    { attemptId: undefined },
    { status: "unknown" },
    { environment: "dev" },
    { modules: null },
  ])("leaves a resumable nonce when the first claim reply is malformed: %j", async (change) => {
    const { session } = create(() =>
      json({ state: { ...initial, ...change }, capability: "A".repeat(43), ownerGeneration: 1 }),
    );
    await session.open();
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    const saved = JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!);
    expect(saved.claimPending).toBe(true);
    expect(saved.owner).toBeUndefined();
    expect(session.state).toBeUndefined();
  });

  it("requires credential resume again after a lost resume answer rather than continuing with the old capability", async () => {
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "resume")) throw new TypeError("lost rotation");
      return json({ state: initial });
    });
    await session.open();
    await session.claim(venue);
    await expect(session.resume("administrator password")).rejects.toThrow("lost rotation");
    expect(session.recoveryRequired).toBe(true);
    await expect(session.importInput("example-module", {})).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/claim",
      "/setup-api/first-setup/resume",
    ]);
  });

  it.each([
    { revision: 2, ownerGeneration: 1 },
    { revision: 1, ownerGeneration: 2 },
  ])(
    "refuses a resume response that did not advance both owner generation and revision: %j",
    async (change) => {
      const { session } = create((path) =>
        ends(path, "claim")
          ? claim()
          : json({
              state: { ...initial, ...change },
              capability: "C".repeat(43),
              ownerGeneration: change.ownerGeneration,
            }),
      );
      await session.open();
      await session.claim(venue);
      await expect(session.resume("administrator password")).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
      expect(session.recoveryRequired).toBe(true);
    },
  );

  it("keeps public download, independent enrolment and publication settings on distinct owner-bound routes", async () => {
    const request = {
      attemptId: initial.attemptId,
      modules: [{ module: "example-module", request: { public: "request" } }],
    };
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "request")) return json(request);
      if (ends(path, "fiscal-test")) return json({ status: "accepted" });
      if (ends(path, "provision")) return json({ provisioned: true, restarting: true });
      return json({ state: initial });
    });
    await session.open();
    await session.claim(venue);
    await expect(session.request()).resolves.toEqual(request);
    await session.enrol(
      "example-module",
      { publicKey: "independent-key" },
      "compared-full-fingerprint",
    );
    const settings = {
      mode: "live" as const,
      aeatCert: {
        pfxBase64: "certificate",
        passphrase: "certificate password",
        certKind: "sello" as const,
      },
      email: {
        server: "smtp.test",
        port: 465,
        encryption: "tls" as const,
        user: "user",
        password: "smtp password",
        from: "mail@example.test",
      },
    };
    await expect(session.runFiscalTest(settings)).resolves.toEqual({ status: "accepted" });
    await expect(session.provision(settings, "es")).resolves.toEqual({
      provisioned: true,
      restarting: true,
    });
    expect(requests[2]!.body).toEqual({
      module: "example-module",
      publicKey: { publicKey: "independent-key" },
      comparison: "compared-full-fingerprint",
    });
    expect(requests.slice(3).map((item) => item.body)).toEqual([
      { ...settings, firstSetup: { attemptId: initial.attemptId, revision: 1 } },
      { ...settings, firstSetup: { attemptId: initial.attemptId, revision: 1 } },
    ]);
    expect(requests[4]!.headers.get("accept-language")).toBe("es");
    const persisted = sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!;
    expect(persisted).not.toContain("certificate password");
    expect(persisted).not.toContain("smtp password");
    await expect(session.provision(settings)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(requests.filter((item) => ends(item.path, "provision"))).toHaveLength(1);
  });

  it("allows explicit retirement of an uncertain assignment while preserving its consumed identity", async () => {
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "status"))
        return json({ claimed: true, state: { ...initial, status: "uncertain", revision: 2 } });
      return json({ state: { ...initial, status: "abandoned", revision: 3 } });
    });
    await session.open();
    await session.claim(venue);
    await session.refresh();
    await session.abandon();
    expect(session.state?.status).toBe("abandoned");
    expect(requests[2]!.body).toEqual({});
    expect(requests[2]!.headers.get("x-waitron-setup-revision")).toBe("2");
  });

  it("projects an owned readiness request to publication settings even if its caller hands it a full wizard draft", async () => {
    const { session, requests } = create((path) =>
      ends(path, "claim") ? claim() : json({ status: "accepted" }),
    );
    await session.open();
    await session.claim(venue);
    await session.runFiscalTest({
      mode: "live",
      venue,
      initialOperations: { trust: "must stay outside" },
    } as Parameters<FirstSetupSession["runFiscalTest"]>[0]);
    expect(requests[1]!.body).toEqual({
      mode: "live",
      firstSetup: { attemptId: initial.attemptId, revision: 1 },
    });
  });

  it("persists the random client nonce before sending a claim, with only owner credentials retained afterwards", async () => {
    let sent: Record<string, unknown> | undefined;
    const { session, requests } = create((_path, body) => {
      sent = body as Record<string, unknown>;
      expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!)).toEqual({
        version: 1,
        clientClaimNonce: sent.clientClaimNonce,
        claimPending: true,
      });
      return claim();
    });
    await session.open();
    await session.claim(venue, "es");
    expect(sent).toEqual({ clientClaimNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), venue });
    expect(requests[0]!.headers.get("accept-language")).toBe("es");
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!)).toEqual({
      version: 1,
      clientClaimNonce: sent!.clientClaimNonce,
      claimPending: false,
      owner: {
        attemptId: initial.attemptId,
        revision: 1,
        ownerGeneration: 1,
        capability: "A".repeat(43),
      },
    });
    expect(session.state).toEqual(initial);
  });

  it("does not claim again after a lost answer; reload requires the saved nonce and credential-proven resume", async () => {
    const first = create(() => {
      throw new TypeError("network unavailable");
    });
    await first.session.open();
    await expect(first.session.claim(venue)).rejects.toThrow("network unavailable");
    const stored = sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!;
    await expect(first.session.claim(venue)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(first.requests).toHaveLength(1);
    await first.session.dispose();
    const next = create((path, body) => {
      expect(path).toBe("/setup-api/first-setup/resume");
      expect(body).toEqual({
        clientClaimNonce: JSON.parse(stored).clientClaimNonce,
        password: "administrator password",
      });
      return json({
        state: { ...initial, ownerGeneration: 2, revision: 2 },
        capability: "B".repeat(43),
        ownerGeneration: 2,
      });
    });
    await next.session.open();
    expect(next.session.recoveryRequired).toBe(true);
    expect(next.requests).toEqual([]);
    await next.session.resume("administrator password");
    expect(next.session.state).toEqual({ ...initial, ownerGeneration: 2, revision: 2 });
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.capability).toBe(
      "B".repeat(43),
    );
  });

  it("refuses a duplicate tab's real Web Lock before any HTTP, and releases only its own hold", async () => {
    const first = create(claim);
    await first.session.open();
    const second = create(claim);
    await expect(second.session.open()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(second.requests).toEqual([]);
    await second.session.dispose();
    const locks = await navigator.locks.query();
    expect(locks.held?.some((lock) => lock.name?.startsWith("waitron:first-setup:"))).toBe(true);
    await first.session.dispose();
    const third = create(claim);
    await third.session.open();
    expect(third.requests).toEqual([]);
  });

  it("rejects corrupt retained session data instead of silently starting a new event", async () => {
    sessionStorage.setItem(FIRST_SETUP_SESSION_KEY, '{"version":2,"clientClaimNonce":"bad"}');
    const { session, requests } = create(claim);
    await expect(session.open()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(requests).toEqual([]);
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).toBe(
      '{"version":2,"clientClaimNonce":"bad"}',
    );
  });

  it("never calls the server if durable tab storage is unavailable", async () => {
    const { session, requests } = create(claim);
    const storage = Object.create(sessionStorage) as Storage;
    Object.defineProperty(storage, "getItem", { value: () => null });
    Object.defineProperty(storage, "setItem", {
      value: () => {
        throw new DOMException("unavailable", "QuotaExceededError");
      },
    });
    const blocked = new FirstSetupSession(
      new SetupApi("", async () => {
        throw new Error("must not send");
      }),
      { storage },
    );
    sessions.push(blocked);
    await expect(blocked.open()).rejects.toThrow("unavailable");
    expect(requests).toEqual([]);
    expect(session.state).toBeUndefined();
  });

  it("ignores a claim answer delivered after the owner screen was disposed", async () => {
    const answer = deferred<Response>();
    const started = deferred<void>();
    const { session } = create(() => {
      started.resolve();
      return answer.promise;
    });
    await session.open();
    const pending = session.claim(venue);
    await started.promise;
    await session.dispose();
    answer.resolve(claim());
    await expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(session.state).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).claimPending).toBe(true);
  });

  it("serializes owner writes and advances all later calls to the server's exact revision", async () => {
    const answer = deferred<Response>();
    const started = deferred<void>();
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "reconfirm")) return json({ reconfirmation: "fresh-proof" });
      if (ends(path, "candidates")) {
        started.resolve();
        return answer.promise;
      }
      return json({ state: { ...initial, revision: 3, status: "consumption-intent" } });
    });
    await session.open();
    await session.claim(venue);
    const pending = session.candidates(
      "example-module",
      { serials: [9] },
      "administrator password",
    );
    await started.promise;
    await expect(session.importInput("example-module", {})).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    answer.resolve(json({ state: { ...initial, revision: 3, status: "consumption-intent" } }));
    await pending;
    await session.importInput("example-module", { allocation: "public" });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/claim",
      "/setup-api/first-setup/reconfirm",
      "/setup-api/first-setup/candidates",
      "/setup-api/first-setup/input",
    ]);
    expect(requests[2]!.body).toEqual({
      module: "example-module",
      proposal: { serials: [9] },
      reconfirmation: "fresh-proof",
    });
    expect(requests[3]!.headers.get("x-waitron-setup-revision")).toBe("3");
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.revision).toBe(3);
  });

  it("blocks blind resubmission after an unanswered write and permits a read of its newest outcome", async () => {
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "input")) throw new TypeError("lost response");
      return json({ claimed: true, state: { ...initial, revision: 4, status: "publication" } });
    });
    await session.open();
    await session.claim(venue);
    await expect(session.importInput("example-module", {})).rejects.toThrow("lost response");
    await expect(session.importInput("example-module", {})).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    await session.refresh();
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/claim",
      "/setup-api/first-setup/input",
      "/setup-api/first-setup/status",
    ]);
    expect(session.state?.revision).toBe(4);
    expect(session.state?.status).toBe("publication");
  });

  it.each([
    { attemptId: "other-attempt" },
    { nodeId: "other-node" },
    { administratorId: "other-administrator" },
    { revision: 0 },
    { ownerGeneration: 2 },
  ])("refuses a response crossing the frozen binding or going backwards: %j", async (change) => {
    const { session } = create((path) =>
      ends(path, "claim") ? claim() : json({ state: { ...initial, ...change } }),
    );
    await session.open();
    await session.claim(venue);
    await expect(session.importInput("example-module", {})).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(session.state).toEqual(initial);
  });

  it("reconfirms activation separately and sends no replacement venue, administrator credentials or public trust", async () => {
    const { session, requests } = create((path) => {
      if (ends(path, "claim")) return claim();
      if (ends(path, "reconfirm")) return json({ reconfirmation: "activation-proof" });
      if (ends(path, "provision")) return json({ provisioned: true, restarting: true });
      return json({ state: initial });
    });
    await session.open();
    await session.claim(venue);
    await session.confirm("example-module", { priorActivation: "none" }, "administrator password");
    await session.provision({ mode: "live" });
    expect(requests[1]!.body).toEqual({
      password: "administrator password",
      purpose: "activation",
    });
    expect(requests[2]!.body).toEqual({
      module: "example-module",
      statement: { priorActivation: "none" },
      reconfirmation: "activation-proof",
    });
    expect(requests[3]!.body).toEqual({
      mode: "live",
      firstSetup: { attemptId: initial.attemptId, revision: 1 },
    });
    expect(JSON.stringify(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY))).not.toContain(
      "administrator password",
    );
  });

  it("reads a lost activation result without a second activation, even after a reload", async () => {
    const first = create((path) =>
      ends(path, "claim") ? claim() : Promise.reject(new TypeError("lost response")),
    );
    await first.session.open();
    await first.session.claim(venue);
    await expect(first.session.provision({ mode: "live" })).rejects.toThrow("lost response");
    await expect(first.session.provision({ mode: "live" })).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    await first.session.dispose();
    const next = create(() =>
      json({ claimed: true, state: { ...initial, revision: 8, status: "complete" } }),
    );
    await next.session.open();
    await next.session.refresh();
    expect(next.session.state?.status).toBe("complete");
    expect(next.requests.map((r) => r.path)).toEqual(["/setup-api/first-setup/status"]);
    await expect(next.session.provision({ mode: "live" })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(first.requests.filter((r) => ends(r.path, "provision"))).toHaveLength(1);
  });

  it("rejects public request downloads for another event and unselected modules before sending input", async () => {
    const { session, requests } = create((path) =>
      ends(path, "claim") ? claim() : json({ attemptId: "another-event", modules: [] }),
    );
    await session.open();
    await session.claim(venue);
    await expect(session.request()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    await expect(session.importInput("unselected", {})).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(requests).toHaveLength(2);
  });

  it("retains abandonment and consumed history rather than clearing the saved identity", async () => {
    const { session, requests } = create((path) =>
      ends(path, "claim")
        ? claim()
        : json({ state: { ...initial, revision: 2, status: "abandoned" } }),
    );
    await session.open();
    await session.claim(venue);
    await session.abandon();
    expect(session.state?.status).toBe("abandoned");
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.attemptId).toBe(
      initial.attemptId,
    );
    await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(requests).toHaveLength(2);
  });
});

describe("explicit replacement after abandonment", () => {
  it("starts a new event only after the server reports unconsumed abandonment, keeping the same nonce", async () => {
    let claims = 0;
    const next = {
      ...initial,
      attemptId: "46e8d046-783d-450b-a355-a6343d33f551",
      nodeId: "8319e8c4-f671-45bf-bdd2-df3d99118c28",
    };
    const { session, requests } = create((path) => {
      if (ends(path, "claim"))
        return ++claims === 1
          ? claim()
          : json({ state: next, capability: "B".repeat(43), ownerGeneration: 1 });
      if (ends(path, "abandon"))
        return json({
          state: { ...initial, revision: 2, status: "abandoned", consumptionIntent: false },
        });
      throw new Error("unexpected action");
    });
    await session.open();
    await session.claim(venue);
    await session.abandon();
    await session.replaceAbandoned(venue);
    expect(session.state?.attemptId).toBe(next.attemptId);
    expect(session.state?.nodeId).toBe(next.nodeId);
    const bodies = requests
      .filter((r) => ends(r.path, "claim"))
      .map((r) => r.body as { clientClaimNonce: string });
    expect(bodies[0]!.clientClaimNonce).toBe(bodies[1]!.clientClaimNonce);
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.attemptId).toBe(
      next.attemptId,
    );
  });
  it.each(["claimed", "uncertain", "abandoned"] as const)(
    "refuses replacement of a consumed %s event before any new claim",
    async (status) => {
      const { session, requests } = create(() =>
        json({
          state: { ...initial, status, consumptionIntent: true },
          capability: "A".repeat(43),
          ownerGeneration: 1,
        }),
      );
      await session.open();
      await session.claim(venue);
      await expect(session.replaceAbandoned(venue)).rejects.toMatchObject({
        code: "setup.attempt_uncertain",
      });
      expect(requests).toHaveLength(1);
      expect(session.state?.attemptId).toBe(initial.attemptId);
    },
  );
  it("does not replace an active unconsumed event", async () => {
    const { session, requests } = create(claim);
    await session.open();
    await session.claim(venue);
    await expect(session.replaceAbandoned(venue)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(requests).toHaveLength(1);
  });
});

it("passes import intent only in the owner claim without persisting the wizard draft", async () => {
  const { session, requests } = create(() => claim());
  await session.open();
  await session.claim(venue, "es", { configurationImport: true, newTaxpayer: true });
  expect(requests[0]!.body).toMatchObject({ venue, configurationImport: true, newTaxpayer: true });
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain("configurationImport");
});
