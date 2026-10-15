import * as filesystem from "node:fs/promises";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";

vi.mock("node:fs/promises", { spy: true });
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "first-route-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  const host = createFirstSetupModuleHost({
    environment: {},
    stateDir,
    venueDir,
    modules: ALL_MODULES,
  });
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "production",
      firstFiscal: host,
      firstSetup: {
        coordinator: host.coordinator,
        assertOtherAllowed: async () => {
          const { assertOtherSetupAllowed } = await import("@waitron/provisioning");
          assertOtherSetupAllowed(await host.store.read());
        },
      },
    },
    () => {},
  );
  const nonce = randomBytes(32).toString("base64url");
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const claimed = await post("/setup-api/first-setup/claim", {
    clientClaimNonce: nonce,
    venue: request,
  });
  const claim = claimed.status === 200 ? await claimed.json() : {};
  const headers = (state = claim.state, capability = claim.capability) => ({
    "X-Waitron-Setup-Owner": capability,
    "X-Waitron-Setup-Attempt": state.attemptId,
    "X-Waitron-Setup-Revision": String(state.revision),
    "X-Waitron-Setup-Generation": String(state.ownerGeneration),
  });
  return { root, host, app, post, claim, claimed, nonce, headers, stateDir };
}
it("claims only the validated wizard identity and conceals all owner state from a stranger", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  expect(f.claim.state.status).toBe("claimed");
  const status = await f.app.request("/setup-api/first-setup/status");
  expect(await status.json()).toEqual({ claimed: true });
  const owner = await f.app.request("/setup-api/first-setup/status", { headers: f.headers() });
  expect(await owner.json()).toEqual({ claimed: true, state: f.claim.state });
  const disk = await readFile(join(f.stateDir, "first-setup.json"), "utf8");
  expect(disk).not.toContain(PASSWORD);
  expect(disk).not.toContain(f.claim.capability);
  expect(disk).not.toContain(f.nonce);
});
it("rotates a lost-response owner without minting another assignment and rejects a stale tab", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const resumed = await f.post("/setup-api/first-setup/resume", {
    clientClaimNonce: f.nonce,
    password: PASSWORD,
  });
  expect(resumed.status).toBe(200);
  const next = await resumed.json();
  expect(next.state.nodeId).toBe(f.claim.state.nodeId);
  expect(next.state.administratorId).toBe(f.claim.state.administratorId);
  expect(next.state.ownerGeneration).toBe(2);
  const stale = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "block-use" },
    f.headers(),
  );
  expect(stale.status).toBe(403);
  expect((await stale.json()).error.code).toBe("setup.owner_required");
  const competing = await f.post("/setup-api/first-setup/claim", {
    clientClaimNonce: randomBytes(32).toString("base64url"),
    venue: request,
  });
  expect(competing.status).toBe(409);
});
it("validates and durably freezes candidates before export, preserving IDs after outside use becomes possible", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const reconfirm = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "block-use" },
    f.headers(),
  );
  expect(reconfirm.status).toBe(200);
  const { reconfirmation } = await reconfirm.json();
  const candidates = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [1, 2] }, reconfirmation },
    f.headers(),
  );
  expect(candidates.status).toBe(200);
  const { state } = await candidates.json();
  expect(state.status).toBe("consumption-intent");
  const exported = await f.app.request("/setup-api/first-setup/request", {
    headers: f.headers(state),
  });
  expect(exported.status).toBe(200);
  const value = await exported.json();
  expect(value.modules).toHaveLength(1);
  expect(value.modules[0].request.binding.targetNodeId).toBe(f.claim.state.nodeId);
  expect(value.modules[0].request.operatorId).toBe(f.claim.state.administratorId);
  expect(
    value.modules[0].request.candidates.map(
      (c: { installationIdentity: string }) => c.installationIdentity,
    ),
  ).toEqual(["S000001", "S000002"]);
  expect(JSON.stringify(value)).not.toContain("passwordHash");
  expect(JSON.stringify(value)).not.toContain("pinHash");
  const edited = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [3] }, reconfirmation },
    f.headers(state),
  );
  expect(edited.status).toBe(409);
  const abandoned = await f.post("/setup-api/first-setup/abandon", {}, f.headers(state));
  expect(abandoned.status).toBe(200);
  const later = await f.post("/setup-api/first-setup/claim", {
    clientClaimNonce: randomBytes(32).toString("base64url"),
    venue: request,
  });
  expect(later.status).toBe(409);
  expect((await later.json()).error.code).toBe("setup.attempt_uncertain");
});
it.each([
  null,
  [],
  { clientClaimNonce: "x", venue: request, privateKey: "SECRET-SENTINEL" },
  { clientClaimNonce: "x", venue: { ...request, admin: { ...request.admin, password: [] } } },
])("refuses malformed claims without echoing secrets: %j", async (body) => {
  const f = await fixture();
  const result = await f.post("/setup-api/first-setup/claim", body);
  expect(result.status).toBe(400);
  expect(await result.text()).not.toContain("SECRET-SENTINEL");
});
it("rejects over-limit streaming bodies before any claim or import side effect", async () => {
  const f = await fixture();
  const result = await f.app.request("/setup-api/first-setup/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"input":"' + "X".repeat(131073) + '"}',
  });
  expect(result.status).toBe(400);
  expect((await f.host.store.read())?.revision).toBe(1);
});

it("imports only the frozen public assignment, enrols the separate key and demands a fresh current-master check", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const reconfirm = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "block-use" },
    f.headers(),
  );
  const candidates = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [1, 2] }, ...(await reconfirm.json()) },
    f.headers(),
  );
  let { state } = await candidates.json();
  const exported = await f.app.request("/setup-api/first-setup/request", {
    headers: f.headers(state),
  });
  const publicRequest = (await exported.json()).modules[0].request;
  const { publicFirstFiscalInput } = await import("../test/first-fiscal-public.js");
  const signed = publicFirstFiscalInput(publicRequest);
  for (const input of [
    { ...signed.input, validated: true },
    {
      ...signed.input,
      allocation: { ...signed.input.allocation, installationIdentity: "S000003" },
    },
    { ...signed.input, approval: { ...signed.input.approval, operatorId: "other" } },
  ]) {
    const rejected = await f.post(
      "/setup-api/first-setup/input",
      { module: MODULE, input },
      f.headers(state),
    );
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe(
      Object.hasOwn(input, "validated") ? "setup.request_invalid" : "sif.allocation_invalid",
    );
  }
  const imported = await f.post(
    "/setup-api/first-setup/input",
    { module: MODULE, input: signed.input },
    f.headers(state),
  );
  expect(imported.status).toBe(200);
  state = (await imported.json()).state;
  const token = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "activation" },
    f.headers(state),
  );
  const missing = await f.post(
    "/setup-api/first-setup/current-master",
    { module: MODULE, statement: signed.current, ...(await token.json()) },
    f.headers(state),
  );
  expect(missing.status).toBe(400);
  const enrolled = await f.post(
    "/setup-api/first-setup/enrol",
    { module: MODULE, publicKey: signed.key, comparison: signed.key.fingerprint },
    f.headers(state),
  );
  expect(enrolled.status).toBe(200);
  const fresh = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "activation" },
    f.headers(state),
  );
  const confirmed = await f.post(
    "/setup-api/first-setup/current-master",
    { module: MODULE, statement: signed.current, ...(await fresh.json()) },
    f.headers(state),
  );
  expect(confirmed.status).toBe(200);
  expect(await f.host.evidence.read(publicRequest.binding)).toEqual({
    trust: signed.key,
    current: signed.current,
  });
  await expect(f.host.evidence.read(publicRequest.binding)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
});

it.each(["legalName", "password", "country"])(
  "refuses an overlong claim %s before saving an assignment",
  async (field) => {
    const f = await fixture();
    expect(f.claimed.status).toBe(200);
    await f.post("/setup-api/first-setup/abandon", {}, f.headers());
    const venue = structuredClone(request);
    if (field === "password") venue.admin.password = "x".repeat(1025);
    else venue[field as "legalName" | "country"] = "x".repeat(257);
    const res = await f.post("/setup-api/first-setup/claim", {
      clientClaimNonce: randomBytes(32).toString("base64url"),
      venue,
    });
    expect(res.status).toBe(400);
    expect((await f.host.store.read())?.status).toBe("abandoned");
  },
);
it("rejects a missing reconfirmation and an invalid serial before any outside-use state", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const invalid = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [0] }, reconfirmation: "x" },
    f.headers(),
  );
  expect(invalid.status).toBe(400);
  expect((await f.host.store.read())?.consumptionIntent).toBe(false);
  const missing = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [1] }, reconfirmation: "x" },
    f.headers(),
  );
  expect(missing.status).toBe(403);
  expect(
    (await f.host.store.read())?.frozen.modules.find((m) => m.module === MODULE)?.request,
  ).toBeNull();
});

it("rejects a delayed old-tab request after the owner resumes in another tab", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const pending = f.app.request(
    new Request("http://localhost/setup-api/first-setup/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...f.headers() },
      body: stream,
      duplex: "half",
    } as RequestInit),
  );
  const resumed = await f.post("/setup-api/first-setup/resume", {
    clientClaimNonce: f.nonce,
    password: PASSWORD,
  });
  expect(resumed.status).toBe(200);
  controller.enqueue(
    new TextEncoder().encode(
      JSON.stringify({ module: MODULE, proposal: { serials: [1] }, reconfirmation: "old" }),
    ),
  );
  controller.close();
  const rejected = await pending;
  expect(rejected.status).toBe(403);
  expect((await rejected.json()).error.code).toBe("setup.owner_required");
  expect((await f.host.store.read())?.consumptionIntent).toBe(false);
});

it("returns the locked public venue and selected module versions only to its owner", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const response = await f.app.request("/setup-api/first-setup/status", { headers: f.headers() });
  const owner = await response.json();
  expect(owner.state).toHaveProperty("venue");
  expect(owner.state.venue.admin.email).toBe("elena@example.test");
  expect(owner.state.venue.taxId).toBe("50000000R");
  expect(owner.state.modules.some((module: { module: string }) => module.module === MODULE)).toBe(
    true,
  );
  for (const field of ["passwordHash", "pinHash", "password", "pin", "ownerVerifier"])
    expect(owner.state.venue.admin).not.toHaveProperty(field);
  expect(JSON.stringify(owner)).not.toContain(PASSWORD);
  const stranger = await f.app.request("/setup-api/first-setup/status");
  expect(await stranger.json()).toEqual({ claimed: true });
});
it("refuses same-generation stale revisions and forged capabilities before abandonment", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const token = await f.post(
    "/setup-api/first-setup/reconfirm",
    { password: PASSWORD, purpose: "block-use" },
    f.headers(),
  );
  const chosen = await f.post(
    "/setup-api/first-setup/candidates",
    { module: MODULE, proposal: { serials: [1] }, ...(await token.json()) },
    f.headers(),
  );
  expect(chosen.status).toBe(200);
  const { state } = await chosen.json();
  for (const headers of [f.headers(), f.headers(state, randomBytes(32).toString("base64url"))]) {
    const rejected = await f.post("/setup-api/first-setup/abandon", {}, headers);
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error.code).toBe("setup.owner_required");
  }
  expect((await f.host.store.read())?.status).toBe("consumption-intent");
});

it.each(["input", "trust"])(
  "retains the assignment after a %s persistence refusal and accepts only the same public retry",
  async (point) => {
    const f = await fixture();
    expect(f.claimed.status).toBe(200);
    const token = await f.post(
      "/setup-api/first-setup/reconfirm",
      { password: PASSWORD, purpose: "block-use" },
      f.headers(),
    );
    const chosen = await f.post(
      "/setup-api/first-setup/candidates",
      { module: MODULE, proposal: { serials: [1] }, ...(await token.json()) },
      f.headers(),
    );
    expect(chosen.status).toBe(200);
    let { state } = await chosen.json();
    const exported = await f.app.request("/setup-api/first-setup/request", {
      headers: f.headers(state),
    });
    const { publicFirstFiscalInput } = await import("../test/first-fiscal-public.js");
    const signed = publicFirstFiscalInput((await exported.json()).modules[0].request);
    const importInput = () =>
      f.post(
        "/setup-api/first-setup/input",
        { module: MODULE, input: signed.input },
        f.headers(state),
      );
    if (point === "trust") {
      const imported = await importInput();
      expect(imported.status).toBe(200);
      state = (await imported.json()).state;
    }
    const before = await f.host.store.read();
    const fileIo = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let injected = false;
    vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      if (
        !injected &&
        String(to).endsWith(
          point === "trust" ? "/module-operation-public.json" : "/first-setup.json",
        )
      ) {
        injected = true;
        throw new Error("synthetic persistence refusal");
      }
      return fileIo.rename(from, to);
    });
    const enrol = () =>
      f.post(
        "/setup-api/first-setup/enrol",
        { module: MODULE, publicKey: signed.key, comparison: signed.key.fingerprint },
        f.headers(state),
      );
    const failed = point === "input" ? await importInput() : await enrol();
    expect(failed.status).toBe(409);
    expect(injected).toBe(true);
    expect(await f.host.store.read()).toEqual(before);
    const retry = point === "input" ? await importInput() : await enrol();
    expect(retry.status).toBe(200);
    expect((await f.host.store.read())?.frozen).toEqual(before?.frozen);
    expect((await f.host.store.read())?.consumptionIntent).toBe(true);
  },
);
it("refuses changed operator module selection before any outside-use export while still allowing abandonment", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const changed = createFirstSetupModuleHost({
    environment: {},
    stateDir: f.stateDir,
    venueDir: join(f.root, "venue"),
    modules: ALL_MODULES,
    moduleConfig: { overrides: new Map([["bookings", false]]) },
  });
  const app = new Hono();
  mountSetup(app, { environment: "production", firstFiscal: changed }, () => {});
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...f.headers() },
      body: JSON.stringify(body),
    });
  const reconfirm = await post("/setup-api/first-setup/reconfirm", {
    password: PASSWORD,
    purpose: "block-use",
  });
  expect(reconfirm.status).toBe(200);
  const rejected = await post("/setup-api/first-setup/candidates", {
    module: MODULE,
    proposal: { serials: [1] },
    ...(await reconfirm.json()),
  });
  expect(rejected.status).toBe(409);
  expect((await f.host.store.read())?.consumptionIntent).toBe(false);
  const abandon = await post("/setup-api/first-setup/abandon", {});
  expect(abandon.status).toBe(200);
  expect((await f.host.store.read())?.status).toBe("abandoned");
});
const foreignOrigins: Record<string, string>[] = [
  { Origin: "https://elsewhere.example" },
  { Origin: "null" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Site": "same-site" },
];
it.each(foreignOrigins)("refuses cross-origin owner requests: %j", async (foreign) => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  for (const path of ["/setup-api/first-setup/reconfirm", "/setup-api/provision"]) {
    const response = await f.post(
      path,
      { password: PASSWORD, purpose: "block-use" },
      { ...f.headers(), ...foreign },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("setup.owner_required");
  }
  expect((await f.host.store.read())?.revision).toBe(1);
});
it("refuses non-JSON owner POSTs and accepts the same-origin JSON control", async () => {
  const f = await fixture();
  expect(f.claimed.status).toBe(200);
  const body = { password: PASSWORD, purpose: "block-use" };
  const refused = await f.post("/setup-api/first-setup/reconfirm", body, {
    ...f.headers(),
    "Content-Type": "text/plain",
  });
  expect(refused.status).toBe(400);
  const allowed = await f.post("/setup-api/first-setup/reconfirm", body, {
    ...f.headers(),
    Origin: "http://localhost",
    "Sec-Fetch-Site": "same-origin",
  });
  expect(allowed.status).toBe(200);
});

it.each([
  { configurationImport: null },
  { configurationImport: "true" },
  { newTaxpayer: null },
  { newTaxpayer: 1 },
  { newTaxpayer: true },
  { configurationImport: false, newTaxpayer: true },
])(
  "refuses malformed claim import selection %j before changing the claimed event",
  async (intent) => {
    const f = await fixture();
    const before = await readFile(join(f.stateDir, "first-setup.json"), "utf8");
    const response = await f.post("/setup-api/first-setup/claim", {
      clientClaimNonce: f.nonce,
      venue: request,
      ...intent,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("setup.request_invalid");
    expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe(before);
  },
);
