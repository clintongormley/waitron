import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError, nodeId } from "@waitron/shared";
import { steadyClock } from "../test/write-path-fixtures.js";
import { setFreshManagementSignIn } from "../test/fresh-management-sign-in.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";
import { REMEDY_KINDS } from "./record-remedy.js";
import { REMEDY_REFUSALS } from "./remedy-refusals.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let token: string;
let personId: string;
beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
  });
});

function send(body: unknown, cookie = `${MANAGEMENT_COOKIE}=${token}`) {
  const app = new Hono();
  mountRecordRemedies(app, { db: suite.db }, () => {});
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it.each(["", "management_session=not-a-session"])(
  "requires a real management session: %s",
  async (cookie) => {
    const res = await send({ kind: "record-correction" }, cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  },
);

it.each(["staff", "supervisor", "manager"] as const)(
  "refuses a direct %s request",
  async (role) => {
    await setBuiltInRoleForTest(suite.db, personId, role);
    const res = await send({ kind: "record-correction" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  },
);

it.each(["corrective-invoice", "absent-original-cancellation", "release-brake"])(
  "refuses disabled %s even when the administrator sends a claimed enablement",
  async (kind) => {
    const res = await send({
      kind,
      enabledRemedies: [kind],
      operatorId: personId,
      reason: "Claimed authorisation",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "fiscal.remedy_disabled", params: { kind } },
    });
  },
);

it("the default policy enables exactly record-correction", async () => {
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, token));
  const sendDefault = (kind: string) => {
    const app = new Hono();
    mountRecordRemedies(
      app,
      {
        db: suite.db,
        recordGeneration: {
          nodeId: nodeId(crypto.randomUUID()),
          environment: "preproduction",
          clock: steadyClock,
          requireWritable() {},
          requireClockConfirmed() {},
        },
      },
      () => {},
    );
    return app.request("/management-api/fiscal-records/remedy", {
      method: "POST",
      headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
  };
  for (const kind of REMEDY_KINDS) {
    const res = await sendDefault(kind);
    if (kind === "record-correction") {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "fiscal.remedy_request_invalid", params: {} },
      });
    } else {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "fiscal.remedy_disabled", params: { kind } },
      });
    }
  }
});

it.each([
  { body: null },
  { body: [] },
  { body: {} },
  { body: { kind: null } },
  { body: { kind: "unknown" } },
])("refuses a malformed remedy request: %j", async ({ body }) => {
  const res = await send(body);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
});

it("refuses clock.unconfirmed before writing while the start's time check holds", async () => {
  const records = () => suite.db.all(sql`select id from registros_facturacion`).length;
  const before = records();
  const sendUnder = (confirmed: boolean) => {
    const app = new Hono();
    mountRecordRemedies(
      app,
      {
        db: suite.db,
        recordGeneration: {
          nodeId: nodeId(crypto.randomUUID()),
          environment: "preproduction",
          clock: steadyClock,
          requireWritable() {},
          requireClockConfirmed() {
            if (!confirmed) throw new AppError("clock.unconfirmed" as never, {} as never);
          },
        },
      },
      () => {},
      new Set(["record-correction"]),
    );
    return app.request("/management-api/fiscal-records/remedy", {
      method: "POST",
      headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "record-correction",
        caseId: crypto.randomUUID(),
        registroId: crypto.randomUUID(),
        actionKey: "correct-facts",
        reason: "Correct the stored record facts",
        facts: { description: "Corrected restaurant service" },
      }),
    });
  };

  const held = await sendUnder(false);
  expect(held.status).toBe(409);
  expect(await held.json()).toEqual({ error: { code: "clock.unconfirmed", params: {} } });
  expect(records()).toBe(before);
  // Control: with the time confirmed the same request goes on to the fresh sign-in check.
  const confirmed = await sendUnder(true);
  expect(await confirmed.json()).toMatchObject({
    error: { code: "management_session.proof_required" },
  });
});

/** This package's files a correction record runs through, the route's own included. */
const CORRECTION_FILES = [
  "record-remedy-routes.ts",
  "record-remedy.ts",
  "record-remedy-http.ts",
  "record-remedy-facts.ts",
  "chain.ts",
  "clock-behind.ts",
  "registro-row.ts",
  "registro-sif.ts",
  "filing-cases.ts",
];
/** Thrown in those files, but by a function a correction record never calls. */
const NOT_ON_THE_CORRECTION_PATH: Record<string, string> = {
  "sif.id_sistema_invalid": "registerSif and writeReservedSif only",
  "sif.allocation_invalid": "registerSif and writeReservedSif only",
  "filing_case.remedy_invalid": "recordCaseEvent is handed the new record, never the case's own",
};
/** Thrown on the correction path by code outside this package, so no file here names them. */
const THROWN_ELSEWHERE = [
  "management_session.required", // @waitron/server-kit, @waitron/identity
  "management_session.expired", // @waitron/identity
  "management_session.proof_required", // @waitron/identity requireFreshManagementSignIn
  "person.suspended", // @waitron/identity
  "authorization.not_permitted", // @waitron/identity authorizeManager
  "node.read_only", // apps/server moduleRecordGeneration's requireWritable
  "venue.time_zone_not_ready", // apps/server TradingAdmission, through requireWritable
  "clock.unconfirmed", // apps/server moduleRecordGeneration's requireClockConfirmed
  "venue.time_zone_invalid", // @waitron/fiscal prepareIssueClock
  "venue.time_zone_target_invalid", // @waitron/fiscal prepareIssueClock
  "storage.disk_full", // the error boundary, for any full-disk failure
];

it("lists every code thrown in this package's correction files, and the hand list of codes thrown outside it, among the refusals the page words", async () => {
  // Reads `throw new AppError("…")`, `throw new IssuanceRefusedError("…")` and
  // `throw new IssuanceRefusal(new AppError("…"` literals as text, in CORRECTION_FILES only.
  const thrown = new Set<string>();
  for (const file of CORRECTION_FILES) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    for (const [, code] of source.matchAll(
      /throw new (?:IssuanceRefusal\(\s*new )?(?:AppError|IssuanceRefusedError)\(\s*"([^"]+)"/g,
    ))
      thrown.add(code!);
  }
  expect(thrown).toContain("fiscal.fingerprint_mismatch");
  expect(thrown).toContain("fiscal.chain_handed_over");
  for (const code of Object.keys(NOT_ON_THE_CORRECTION_PATH)) expect(thrown).toContain(code);
  const listed = new Set(Object.keys(REMEDY_REFUSALS));
  expect(
    [...thrown, ...THROWN_ELSEWHERE].filter(
      (code) => !listed.has(code) && !Object.hasOwn(NOT_ON_THE_CORRECTION_PATH, code),
    ),
  ).toEqual([]);
});

it("answers a refusal with the status the refusal list gives it", async () => {
  const res = await send({ kind: "not-a-kind" });
  expect(res.status).toBe(REMEDY_REFUSALS["fiscal.remedy_request_invalid"]);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
});
