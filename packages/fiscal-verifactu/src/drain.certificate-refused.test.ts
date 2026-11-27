import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import "./errors.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const at = (minute: number) => new Date(Date.UTC(2026, 6, 21, 0, minute));

type Answer = "refused" | "network" | "accepted";

function transport() {
  const authority = createFakeAeat({ serverNow: at(0) });
  const state: { answer: Answer; revision: string | null | undefined } = {
    answer: "refused",
    revision: "revision-a",
  };
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      if (state.answer === "refused") {
        throw new AppError("fiscal.certificate_not_accepted", { page: "erro4011.html" });
      }
      if (state.answer === "network") throw new Error("network down");
      return authority.fetch(input, init);
    },
  });
  const deps = {
    db: suite.db,
    environment: "production" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: async () =>
      state.revision === undefined
        ? client
        : { ...client, certificateRevision: state.revision },
  };
  return { state, deps };
}

async function mark() {
  const { rows } = await suite.db.execute<{
    certificate_refused_revision: string | null;
    certificate_refused_at: string | null;
  }>(sql`
    select certificate_refused_revision, certificate_refused_at from verifactu_sending_state
  `);
  return rows;
}

it("stores the refused revision with the pass's time, keeping the first time for the same revision", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();

  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_revision: "revision-a", certificate_refused_at: at(1).toISOString() },
  ]);

  await appendPendingAlta(suite.db, seeded, 2);
  await drain(t.deps, at(30));
  expect(await mark()).toEqual([
    { certificate_refused_revision: "revision-a", certificate_refused_at: at(1).toISOString() },
  ]);

  t.state.revision = "revision-b";
  await drain(t.deps, at(59));
  expect(await mark()).toEqual([
    { certificate_refused_revision: "revision-b", certificate_refused_at: at(59).toISOString() },
  ]);
});

it("clears the mark when AEAT answers", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  await drain(t.deps, at(1));
  expect((await mark())[0]?.certificate_refused_revision).toBe("revision-a");

  t.state.answer = "accepted";
  const accepted = await drain(t.deps, at(30));
  expect(accepted.recordsAccepted).toBe(1);
  expect(await mark()).toEqual([
    { certificate_refused_revision: null, certificate_refused_at: null },
  ]);
});

it("stores no mark for a failure that does not carry the refusal", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  t.state.answer = "network";
  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_revision: null, certificate_refused_at: null },
  ]);
});

it("stores no mark when the client names no revision", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  t.state.revision = undefined;
  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_revision: null, certificate_refused_at: null },
  ]);
});
