import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type InitialSetupContext,
} from "@waitron/module";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { readHourSetupInput } from "./initial-hour-setup.js";

const context: InitialSetupContext = {
  attemptId: "attempt",
  administratorId: "administrator",
  country: "ES",
  taxId: "89890001K",
  environment: "preproduction",
  recipientVenueId: "first-setup:attempt",
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "event",
    sourceId: "first-setup:attempt",
    targetNodeId: "node",
  },
  bases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
};
const input = {
  allocation: {
    version: 1,
    allocationId: "hour/event",
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction",
    installationIdentity: "06RB",
    series: [
      { code: "A-06RB", purpose: "standard" },
      { code: "FF-06RB", purpose: "full" },
      { code: "R-06RB", purpose: "rectificative" },
    ],
    source: "hour",
    reservationEvidence: null,
    issuedAt: "2026-10-16T11:40:00.000Z",
  },
  approval: {
    version: 1,
    eventId: "event",
    sourceId: "first-setup:attempt",
    targetNodeId: "node",
    operatorId: "administrator",
    oldMachineAbsent: true,
    oldMachineOffline: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-16T11:40:00.000Z",
    incidentEvidence: "hour/event",
  },
};
function fixture() {
  return structuredClone({
    ...context,
    request: { kind: "waitron-hour-setup", status: "selected", identity: "06RB", input },
  });
}
const refusal = { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } };
it("checks the entire frozen request and returns a detached exact input", () => {
  const saved = fixture();
  const checked = readHourSetupInput(saved, structuredClone(input));
  expect(checked).toEqual(input);
  checked.allocation.series[0]!.code = "mutated";
  expect(saved.request.input.allocation.series[0]!.code).toBe("A-06RB");
});
it.each([
  ["country", "FR"],
  ["taxId", "wrong"],
  ["administratorId", " "],
  ["recipientVenueId", "foreign"],
] as const)("refuses a changed trusted %s", (key, value) => {
  expect(() => readHourSetupInput({ ...fixture(), [key]: value }, input)).toThrowError(
    expect.objectContaining(refusal),
  );
});
it.each([
  ["module", "other"],
  ["action", "restore"],
  ["sourceId", "foreign"],
] as const)("refuses a changed binding %s", (key, value) => {
  const saved = fixture();
  expect(() =>
    readHourSetupInput({ ...saved, binding: { ...saved.binding, [key]: value } }, input),
  ).toThrowError(expect.objectContaining(refusal));
});
it.each([
  null,
  [],
  {},
  { kind: "legacy" },
  { kind: "waitron-hour-setup", status: "waiting", identity: "06RB", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "S000001", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "06RC", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "06RB", input: null },
  { kind: "waitron-hour-setup", status: "selected", identity: "06RB", input: { allocation: null } },
])("refuses unusable frozen request %j", (request) => {
  expect(() => readHourSetupInput({ ...context, request }, input)).toThrowError(
    expect.objectContaining(refusal),
  );
});
it.each([
  "invalid",
  "2026-10-16T11:40:00Z",
  "2025-12-31T23:59:59.000Z",
  "2145-08-15T16:00:00.000Z",
])("refuses a noncanonical or out-of-range request instant %s", (issuedAt) => {
  const saved = fixture();
  saved.request.input.allocation.issuedAt = issuedAt;
  expect(() => readHourSetupInput(saved, saved.request.input)).toThrowError(
    expect.objectContaining(refusal),
  );
});
it.each(["allocation", "approval"] as const)(
  "refuses an extra %s field even when the frozen request and upload agree",
  (key) => {
    const saved = fixture();
    Object.assign(saved.request.input[key], { authority: "forged" });
    expect(() => readHourSetupInput(saved, saved.request.input)).toThrowError(
      expect.objectContaining(refusal),
    );
  },
);
it("compares base values independently of their original order", () => {
  const saved = fixture();
  saved.bases = [...saved.bases].reverse();
  expect(readHourSetupInput(saved, input).allocation.series).toEqual(input.allocation.series);
});

const source = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("./hour-clock-internet.js", () => ({ observeInternetHourClock: source.internet }));
vi.mock("./hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  source.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
});
afterEach(() => {
  vi.useRealTimers();
  source.internet.mockReset();
});
function configured() {
  let value: unknown = null;
  const history: unknown[] = [];
  const host: ModuleOperationHost = {
    environment: {},
    readPublicEvidence: async () => {
      throw new Error("legacy evidence read");
    },
    readSetupFacts: async () => ({
      context,
      contextKey: "frozen-scope",
      localHistory: { reference: "venue", complete: true, records: [] },
    }),
    withPreparationState: async (_binding, run) =>
      run({
        get value() {
          return structuredClone(value);
        },
        get history() {
          return structuredClone(history);
        },
        async replace(next) {
          value = structuredClone(next);
          history.push(value);
        },
      }),
  };
  const seat = FISCAL_INITIAL_SETUP.configure!(host);
  const prepare = (proposal: unknown) => seat.preparation!(context, proposal);
  const select = async (answer = "no") =>
    seat.request(context, await seat.candidates(context, { answer }));
  const clock = async () => {
    const challenge = (await prepare({ action: "clock-challenge" })) as { id: string };
    return prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
  };
  return { seat, host, prepare, select, clock, history };
}
it("the configured module validates, projects and prepares the same retained hour", async () => {
  const f = configured();
  await f.clock();
  const saved = await f.select();
  const held = { ...context, request: saved };
  expect(saved).toEqual({
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "06RB",
    input,
  });
  expect(f.seat.inspect(held, input).input).toEqual(input);
  expect(f.seat.assignmentKeys!(held)).toEqual(['["89890001K","preproduction","hour","06RB"]']);
  expect(f.seat.assignmentPositions!(held)).toEqual([
    { namespace: '["89890001K","preproduction","hour"]', position: 6923 },
  ]);
  expect(f.seat.pending!(saved)).toBe(false);
  expect(f.seat.resolutionEvidence!()).toEqual({ files: [], directories: [] });
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  expect(
    await withOperationAuthority(context.binding, context.administratorId, (authority) =>
      operations.prepare({ binding: context.binding, authority, input }, async () => "prepared"),
    ),
  ).toBe("prepared");
  expect(f.history).toHaveLength(1);
});
it("a configured declaration can persist a wait and preview it without activation input", async () => {
  const f = configured();
  await f.clock();
  const wait = await f.select("unknown");
  expect(f.seat.pending!(wait)).toBe(true);
  const preview = await f.prepare({ action: "selection" });
  expect(preview).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T12:00:00Z"),
  });
  expect(preview).not.toHaveProperty("input");
  expect(f.history).toHaveLength(1);
});
it("the configured module binds manual confirmation to the displayed comparison", async () => {
  const f = configured();
  const compared = (await f.prepare({ action: "compare-clocks", browser: null })) as { id: string };
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_unconfirmed" },
  });
  await f.prepare({ action: "confirm-clock", comparisonId: compared.id });
  expect(await f.select()).toMatchObject({ status: "selected", identity: "06RB" });
});
it.each([
  null,
  {},
  { action: "other" },
  { action: "clock-challenge", extra: true },
  { action: "compare-clocks", browser: [] },
  { action: "compare-clocks", browser: { challengeId: "challenge", instantMs: 1.5 } },
  { action: "confirm-clock", comparisonId: 1 },
])("refuses an unsupported clock proposal %j", async (proposal) => {
  await expect(configured().prepare(proposal)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed_allocation" },
  });
});
it.each([null, {}, { answer: "maybe" }, { answer: "no", taxpayerNif: "injected" }])(
  "refuses an unsupported taxpayer declaration %j",
  async (proposal) => {
    await expect(configured().seat.candidates(context, proposal)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed_allocation" },
    });
  },
);
it("requires the module's fresh candidate rather than a copied or reused candidate", async () => {
  const f = configured();
  await f.clock();
  const candidate = await f.seat.candidates(context, { answer: "no" });
  expect(() => f.seat.request(context, structuredClone(candidate))).toThrowError(
    expect.objectContaining(refusal),
  );
  f.seat.request(context, candidate);
  expect(() => f.seat.request(context, candidate)).toThrowError(expect.objectContaining(refusal));
});
it("an unselected setup has no assignment to compare with an old attempt", () => {
  const f = configured();
  expect(f.seat.assignmentKeys!(context)).toEqual([]);
  expect(f.seat.assignmentPositions!(context)).toEqual([]);
});
it("configured setup cannot enrol or confirm legacy outside evidence", () => {
  const f = configured();
  expect(() => f.seat.enrol(context, {}, {})).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
  expect(() => f.seat.confirmation(context, { input, summary: {} }, {})).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
});
