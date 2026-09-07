import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { PromoteRunResult } from "./promote-api.js";

// A UNIT test: the two authorization paths and the delegation to `run` are doubled, not driven
// against real Postgres. The admin-login path threads `withTenant` → `asAppUser` → `loginManagerById`
// → `authorizeManager` → `endManagementSession`; each is mocked (the boot.test.ts `importOriginal`
// idiom) so a test can wire login/authorize to SUCCEED for an admin, THROW for a bad credential, or
// THROW `authorization.not_permitted` for a non-admin — without a database. `verifyBreakGlass` is
// mocked at its own module boundary so the fallback path needs no `deployment` row. `run` is a stub
// `vi.fn`, so this suite proves the endpoint's own logic (which credential path, when `run` is
// reached, how a thrown code maps to a status) — never the promote functions themselves (Task 7's
// closure wires those; the endpoint never calls them directly, spec §2).

const TENANT = "11111111-1111-1111-1111-111111111111";
const PERSON = "22222222-2222-2222-2222-222222222222";
const GOOD_SECRET = "correct-break-glass-secret";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

// withTenant/asAppUser: run the callback against a dummy tx; no real connection. loginManagerById
// resolves a session for the good PERSON; authorizeManager succeeds (admin has node.promote) by
// default. Individual tests re-wire these via the hoisted refs. `vi.hoisted` is required: the
// `vi.mock` factory is hoisted above the file, so the refs it closes over must be too.
const { loginManagerById, authorizeManager, endManagementSession, verifyBreakGlass } = vi.hoisted(
  () => ({
    loginManagerById: vi.fn(async () => ({ id: "33333333-3333-3333-3333-333333333333" })),
    authorizeManager: vi.fn(async () => {}),
    endManagementSession: vi.fn(async () => {}),
    verifyBreakGlass: vi.fn(
      async (_db: unknown, secret: string) => secret === "correct-break-glass-secret",
    ),
  }),
);
vi.mock("@waitron/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...actual,
    withTenant: vi.fn(
      async (_db: unknown, _tenantId: string, cb: (tx: unknown) => Promise<unknown>) => cb({}),
    ),
    asAppUser: vi.fn(async () => {}),
  };
});
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return { ...actual, loginManagerById, authorizeManager, endManagementSession };
});

vi.mock("./break-glass.js", () => ({ verifyBreakGlass }));

// The mounted module is imported AFTER the mocks above so it binds the doubled dependencies.
import { mountPromoteApi } from "./promote-api.js";

const fakeDb = {} as Database;

function appWith(
  run: (a: { oldNodeNeutralised: boolean }) => Promise<PromoteRunResult> = vi.fn(async () => ({
    alreadyPrimary: false,
    restarting: true,
  })),
): { app: Hono; run: typeof run } {
  const app = new Hono();
  mountPromoteApi(app, { appDb: fakeDb, tenantId: TENANT, run });
  return { app, run };
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /management-api/promote (two-path auth over the promote closure)", () => {
  // The auth-double refs accumulate calls across tests; clear them (call history only — the default
  // implementations set at `vi.hoisted` survive `clearAllMocks`) so each test's "was X reached?"
  // assertions see only its own request.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an admin login with node.promote authorizes and promotes", async () => {
    const { app, run } = appWith();
    const res = await post(app, {
      oldNodeNeutralised: true,
      personId: PERSON,
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
    expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
    // The admin-login path was taken: it authenticated, authorized node.promote, and ended the session.
    expect(loginManagerById).toHaveBeenCalled();
    expect(authorizeManager).toHaveBeenCalledWith(expect.anything(), {
      managementSessionId: SESSION_ID,
      permission: "node.promote",
    });
    expect(endManagementSession).toHaveBeenCalledWith(expect.anything(), SESSION_ID);
    expect(verifyBreakGlass).not.toHaveBeenCalled();
  });

  it("break-glass secret authorizes and promotes", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
    // The break-glass path never touches the manager-login path.
    expect(loginManagerById).not.toHaveBeenCalled();
  });

  it("a wrong break-glass secret is refused 401 and never calls run", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: "wrong" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("promotion.break_glass_invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("no credential is refused 401 and never calls run", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("a non-admin credential (authorization.not_permitted) is refused 403 and never calls run", async () => {
    authorizeManager.mockRejectedValueOnce(
      new AppError("authorization.not_permitted", { permission: "node.promote" }),
    );
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
    expect(run).not.toHaveBeenCalled();
  });

  it("missing attestation surfaces run's promotion.fence_not_attested (400)", async () => {
    const run = vi.fn(async (): Promise<PromoteRunResult> => {
      throw new AppError("promotion.fence_not_attested", {});
    });
    const { app } = appWith(run);
    const res = await post(app, { oldNodeNeutralised: false, personId: PERSON, password: "pw" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("promotion.fence_not_attested");
    // The endpoint passed the operator's attestation through verbatim (false → false).
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: false });
  });

  it("run's promotion.node_fenced maps to 409", async () => {
    const run = vi.fn(async (): Promise<PromoteRunResult> => {
      throw new AppError("promotion.node_fenced", { standing: "sell-only" });
    });
    const { app } = appWith(run);
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("promotion.node_fenced");
  });
});
