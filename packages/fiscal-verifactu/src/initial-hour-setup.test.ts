import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type InitialSetupContext,
} from "@waitron/module";
import { FISCAL_INITIAL_SETUP } from "./index.js";
import { FISCAL_OPERATIONS } from "./index.js";
import { readHourSetupInput } from "./initial-hour-setup.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
    installationIdentity: "0CNNW",
    series: [
      { code: "A-0CNNW", purpose: "standard" },
      { code: "FF-0CNNW", purpose: "full" },
      { code: "R-0CNNW", purpose: "rectificative" },
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
    request: { kind: "waitron-hour-setup", status: "selected", identity: "0CNNW", input },
  });
}

it.each(["en", "es"] as const)(
  "the command document seat renders the frozen identity and staged key in %s",
  async (locale) => {
    const f = configured();
    const saved = fixture();
    const document = await f.seat.commandRecoveryDocument!(saved, f.seat.inspect(saved, input), {
      key: {
        nodeId: "node",
        name: "2026-10-16 · ACRY",
        secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
      },
      identity: {
        taxpayerName: "Olivo Restauración SL",
        venueName: "Olivo Centro",
        timeZone: "Europe/Madrid",
      },
      locale,
    });
    expect(document.statement).toEqual({
      kind: "waitron-recovery-document",
      version: 1,
      scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
      taxpayerName: "Olivo Restauración SL",
      venueName: "Olivo Centro",
      createdAt: "2026-10-16T11:40:00.000Z",
      nodeKey: { nodeId: "node", name: "2026-10-16 · ACRY" },
    });
    const task = getDocument({
      data: document.bytes.slice(),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
    });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const text = (await page.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      expect(text).toContain(
        locale === "en" ? "Waitron recovery key" : "Clave de recuperación de Waitron",
      );
      expect(text).toContain("Olivo Restauración SL");
      expect(text).toContain("Olivo Centro");
      expect(text).toContain("89890001K");
      expect(text).toContain("2026-10-16 · ACRY");
      const attached = JSON.parse(
        Buffer.from((await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!).toString(),
      );
      expect(attached).toEqual({
        ...(document.statement as object),
        nodeKey: {
          nodeId: "node",
          name: "2026-10-16 · ACRY",
          secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        },
      });
    } finally {
      await task.destroy();
    }
  },
);

it("the command recovery sheet uses the frozen venue zone", async () => {
  const f = configured();
  const saved = fixture();
  const document = await f.seat.commandRecoveryDocument!(saved, f.seat.inspect(saved, input), {
    key: { nodeId: "node", name: "2026-10-16 · ACRY", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    identity: { taxpayerName: "Olivo", venueName: "Centro", timeZone: "Atlantic/Canary" },
    locale: "en",
  });
  const task = getDocument({ data: document.bytes.slice(), useSystemFonts: false, useWasm: false });
  try {
    const pdf = await task.promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain("16 October 2026, 12:40");
    expect(text).toContain("WEST");
  } finally {
    await task.destroy();
  }
});

it("the command document seat refuses a foreign staged node and changed hour input", async () => {
  const f = configured();
  const saved = fixture();
  const document = {
    key: {
      nodeId: "foreign",
      name: "2026-10-16 · ACRY",
      secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    },
    identity: { taxpayerName: "Olivo", venueName: "Centro", timeZone: "Europe/Madrid" },
    locale: "en" as const,
  };
  await expect(
    f.seat.commandRecoveryDocument!(saved, f.seat.inspect(saved, input), document),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  await expect(
    f.seat.commandRecoveryDocument!(
      saved,
      { input: {}, summary: null },
      { ...document, key: { ...document.key, nodeId: "node" } },
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
});

it("dates a delayed recovery document when it is created without selecting another installation hour", async () => {
  const f = configured();
  const saved = fixture();
  vi.setSystemTime(new Date("2026-10-17T12:30:00Z"));
  const document = await f.seat.commandRecoveryDocument!(saved, f.seat.inspect(saved, input), {
    key: { nodeId: "node", name: "2026-10-17 · ACRY", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    identity: { taxpayerName: "Olivo", venueName: "Centro", timeZone: "Europe/Madrid" },
    locale: "en",
  });
  expect(document.statement).toMatchObject({ createdAt: "2026-10-17T12:30:00.000Z" });
  expect(saved.request.input.allocation.installationIdentity).toBe("0CNNW");
  expect(f.history).toEqual([]);
});
const refusal = { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } };
it("checks the entire frozen request and returns a detached exact input", () => {
  const saved = fixture();
  const checked = readHourSetupInput(saved, structuredClone(input));
  expect(checked).toEqual(input);
  checked.allocation.series[0]!.code = "mutated";
  expect(saved.request.input.allocation.series[0]!.code).toBe("A-0CNNW");
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
  { kind: "waitron-hour-setup", status: "waiting", identity: "0CNNW", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "S000001", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "0CNPG", input },
  { kind: "waitron-hour-setup", status: "selected", identity: "0CNNW", input: null },
  {
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "0CNNW",
    input: { allocation: null },
  },
])("refuses unusable frozen request %j", (request) => {
  expect(() => readHourSetupInput({ ...context, request }, input)).toThrowError(
    expect.objectContaining(refusal),
  );
});
it.each([
  "invalid",
  "2026-10-16T11:40:00Z",
  "2025-12-31T23:59:59.000Z",
  "2089-10-18T16:32:00.000Z",
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
let monotonicOffset = 0;
const monotonicNow = () => performance.now() + monotonicOffset;
beforeEach(() => {
  monotonicOffset = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  source.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
});
afterEach(() => {
  vi.useRealTimers();
  source.internet.mockReset();
});
function internetAgrees() {
  source.internet.mockImplementation(async () => {
    const monotonic = monotonicNow();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 500,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: monotonic,
      monotonicFinishedMs: monotonic,
    };
  });
}
// A setup's settle wait ends at a minute start 90 to 150 seconds after its check; a case that
// starts here takes 11:40's name after it.
const startEarly = () => vi.setSystemTime(new Date("2026-10-16T11:38:00Z"));
function configured() {
  let value: unknown = null;
  const history: unknown[] = [];
  const host: ModuleOperationHost = {
    environment: {},
    testClock: { wall: () => Date.now(), monotonic: monotonicNow },
    readPublicEvidence: async () => {
      throw new Error("legacy evidence read");
    },
    readSetupFacts: async () => ({
      context,
      contextKey: "frozen-scope",
      localHistory: { reference: "venue", complete: true, records: [] },
      floors: [],
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
  const prepare = (proposal: unknown) => seat.preparation!(context, proposal, { onBox: true });
  let comparisonId = "none";
  const candidate = () => seat.candidates(context, { comparisonId });
  const select = async () => {
    const first = (await candidate()) as { status: string; targetMs: number; remainingMs: number };
    if (first.status !== "waiting") return seat.request(context, first);
    vi.setSystemTime(first.targetMs);
    monotonicOffset += first.remainingMs;
    await clock();
    return seat.request(context, await candidate());
  };
  const clock = async () => {
    internetAgrees();
    const challenge = (await prepare({ action: "clock-challenge" })) as { id: string };
    const compared = (await prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    })) as { id: string };
    comparisonId = compared.id;
    return compared;
  };
  return { seat, host, prepare, candidate, select, clock, history };
}
it("the configured module validates, projects and prepares the same retained hour", async () => {
  startEarly();
  const f = configured();
  await f.clock();
  const saved = await f.select();
  const held = { ...context, request: saved };
  expect(saved).toEqual({
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "0CNNW",
    input,
  });
  expect(f.seat.inspect(held, input).input).toEqual(input);
  expect(f.seat.assignmentKeys!(held)).toEqual(['["89890001K","preproduction","hour","0CNNW"]']);
  expect(f.seat.assignmentPositions!(held)).toEqual([
    { namespace: '["89890001K","preproduction","hour"]', position: 415420 },
  ]);
  expect(f.seat.pending!(saved)).toBe(false);
  expect(f.seat.resolutionEvidence!()).toEqual({ files: [], directories: [] });
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  expect(
    await withOperationAuthority(context.binding, context.administratorId, (authority) =>
      operations.prepare({ binding: context.binding, authority, input }, async () => "prepared"),
    ),
  ).toBe("prepared");
  expect(f.history).toHaveLength(2);
});
it("a configured setup can persist its settle wait and preview it without activation input", async () => {
  startEarly();
  const f = configured();
  await f.clock();
  const wait = f.seat.request(context, await f.candidate());
  expect(f.seat.pending!(wait)).toBe(true);
  const preview = await f.prepare({ action: "selection" });
  expect(preview).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T11:40:00Z"),
  });
  expect(preview).not.toHaveProperty("input");
  expect(f.history).toHaveLength(1);
});
it("the configured module takes a browser reading as the box's own until the route says otherwise", async () => {
  const f = configured();
  const challenge = (await f.prepare({ action: "clock-challenge" })) as { id: string };
  const compared = (await f.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  })) as { id: string; clock: { secondClock: boolean; unavailable: { reason: string }[] } };
  expect(compared.clock.secondClock).toBe(false);
  expect(compared.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "same_machine" }),
  );
  await expect(f.seat.candidates(context, { comparisonId: compared.id })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
  expect(f.history).toEqual([]);
});
it.each([
  null,
  {},
  { action: "other" },
  { action: "clock-challenge", extra: true },
  { action: "compare-clocks", browser: [] },
  { action: "compare-clocks", browser: { challengeId: "challenge", instantMs: 1.5 } },
  { action: "confirm-clock", comparisonId: 1 },
  { action: "confirm-clock", comparisonId: "comparison" },
])("refuses an unsupported clock proposal %j", async (proposal) => {
  await expect(configured().prepare(proposal)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed_allocation" },
  });
});
it.each([
  null,
  {},
  { answer: "no", comparisonId: "comparison" },
  { comparisonId: 1 },
  { comparisonId: "comparison", taxpayerNif: "injected" },
])("refuses an unsupported selection proposal %j", async (proposal) => {
  await expect(configured().seat.candidates(context, proposal)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed_allocation" },
  });
});
it("requires the module's fresh candidate rather than a copied or reused candidate", async () => {
  const f = configured();
  const compared = await f.clock();
  const candidate = await f.seat.candidates(context, { comparisonId: compared.id });
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

function terminal(f: ReturnType<typeof configured>, answers: string[]) {
  const output: string[] = [];
  const prompts: string[] = [];
  const actions = {
    output: (line: string) => {
      output.push(line);
    },
    prompt: async (question: string) => {
      prompts.push(question);
      return answers.shift() ?? "";
    },
    prepare: f.prepare,
    select: async (proposal: unknown) =>
      f.seat.request(context, await f.seat.candidates(context, proposal)),
  };
  return { actions, output, prompts };
}

it("the terminal with only the box's clock explains and cancels without a question", async () => {
  const f = configured();
  const t = terminal(f, []);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "cancelled" });
  expect(t.output.join("\n")).toContain("box: 2026-10-16T11:40:00.000Z");
  expect(t.output.join("\n")).toContain("internet: unavailable");
  expect(t.output).toContain(
    "No series is made without a confirmed time, so none is ever repeated.",
  );
  expect(t.output).toContain(
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  );
  expect(t.prompts).toEqual([]);
  expect(f.history).toEqual([]);
});

it("the terminal explains and cancels when the internet's clock disagrees", async () => {
  const f = configured();
  source.internet.mockImplementation(async () => {
    const monotonic = monotonicNow();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now() + 31_000,
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: monotonic,
      monotonicFinishedMs: monotonic,
    };
  });
  const t = terminal(f, []);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "cancelled" });
  expect(t.output).toContain(
    "No series is made without a confirmed time, so none is ever repeated.",
  );
  expect(t.output).not.toContain(
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  );
  expect(t.prompts).toEqual([]);
  expect(f.history).toEqual([]);
});

it("the terminal asks nothing, prints why it waits and until when, and keeps the wait", async () => {
  const f = configured();
  internetAgrees();
  const t = terminal(f, []);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "waiting" });
  expect(t.output).toContain("Waiting to confirm the time, so no invoice series is ever repeated.");
  expect(t.output).toContain(
    "Continues at 2026-10-16T11:42:00.000Z; run the command again within a minute after that time (later, it waits again).",
  );
  expect(t.prompts).toEqual([]);
  expect(f.history).toHaveLength(1);
});

it("the terminal keeps an already selected request without another comparison or declaration", async () => {
  const f = configured();
  const t = terminal(f, []);
  expect(await f.seat.command!(fixture(), t.actions)).toEqual({ status: "ready", input });
  expect(t.prompts).toEqual([]);
  expect(t.output).toEqual([]);
  expect(f.history).toEqual([]);
});

it("the terminal run again after its wait's target selects that minute's name, asking nothing", async () => {
  startEarly();
  const f = configured();
  internetAgrees();
  const first = terminal(f, []);
  expect(await f.seat.command!(context, first.actions)).toEqual({ status: "waiting" });
  expect(first.output).toContain(
    "Continues at 2026-10-16T11:40:00.000Z; run the command again within a minute after that time (later, it waits again).",
  );
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  monotonicOffset += 120_000;
  const again = terminal(f, []);
  expect(await f.seat.command!(context, again.actions)).toEqual({ status: "ready", input });
  expect([...first.prompts, ...again.prompts]).toEqual([]);
  expect(again.output.join("\n")).not.toContain("wrong time");
  expect(f.history).toHaveLength(2);
});

it("the terminal near an hour's end waits for its settle point, not for the hour", async () => {
  const f = configured();
  vi.setSystemTime(new Date("2026-10-16T11:59:59.900Z"));
  internetAgrees();
  const t = terminal(f, []);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "waiting" });
  expect(t.output).toContain(
    "Continues at 2026-10-16T12:02:00.000Z; run the command again within a minute after that time (later, it waits again).",
  );
  expect(t.output.join("\n")).not.toContain("UTC-hour boundary");
  expect(f.history).toHaveLength(1);
});

it.each([null, { status: "invalid" }])(
  "the terminal rejects an unusable selection response %j",
  async (selected) => {
    const f = configured();
    internetAgrees();
    const t = terminal(f, ["no"]);
    await expect(
      f.seat.command!(context, { ...t.actions, select: async () => selected }),
    ).rejects.toMatchObject(refusal);
    expect(f.history).toEqual([]);
  },
);

it("a terminal run again before the target prints the same wait and records nothing new", async () => {
  const f = configured();
  internetAgrees();
  expect(await f.seat.command!(context, terminal(f, []).actions)).toEqual({ status: "waiting" });
  const before = structuredClone(f.history);
  const again = terminal(f, []);
  expect(await f.seat.command!(context, again.actions)).toEqual({ status: "waiting" });
  expect(again.prompts).toEqual([]);
  expect(again.output).toContain(
    "Continues at 2026-10-16T11:42:00.000Z; run the command again within a minute after that time (later, it waits again).",
  );
  expect(f.history).toEqual(before);
});

it("a terminal run more than a minute after its wait's target waits again", async () => {
  const f = configured();
  internetAgrees();
  expect(await f.seat.command!(context, terminal(f, []).actions)).toEqual({ status: "waiting" });
  vi.setSystemTime(new Date("2026-10-16T11:43:00.001Z"));
  monotonicOffset += 180_001;
  const later = terminal(f, []);
  expect(await f.seat.command!(context, later.actions)).toEqual({ status: "waiting" });
  expect(later.output).toContain(
    "Continues at 2026-10-16T11:45:00.000Z; run the command again within a minute after that time (later, it waits again).",
  );
  expect(later.prompts).toEqual([]);
  expect(f.history).toHaveLength(2);
});

it("refuses a delivered sheet that still carries an installation code", () => {
  const f = configured();
  const saved = fixture();
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    installationCodes: ["0CNNW"],
    scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
    taxpayerName: "Olivo",
    venueName: "Centro",
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: "node", name: "key" },
  };
  expect(() =>
    f.seat.recoveryDocument!(saved, f.seat.inspect(saved, input), {
      statement,
      stage: { nodeId: "node", name: "key" },
      identity: { taxpayerName: "Olivo", venueName: "Centro" },
    } as Parameters<NonNullable<typeof f.seat.recoveryDocument>>[2]),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
});

it.each(["standard", "full", "rectificative", "unknown"])(
  "refuses a matching setup allocation with a second %s prefix",
  (purpose) => {
    const saved = fixture();
    saved.bases = [...saved.bases, { code: "second", purpose }];
    saved.request.input.allocation.series.push({ code: "second-0CNNW", purpose });
    expect(() => readHourSetupInput(saved, saved.request.input)).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "series_configuration_unsupported" },
      }),
    );
  },
);

it.each(["standard", "full", "rectificative"])(
  "refuses a matching setup allocation missing its %s prefix",
  (purpose) => {
    const saved = fixture();
    saved.bases = saved.bases.filter((base) => base.purpose !== purpose);
    saved.request.input.allocation.series = saved.request.input.allocation.series.filter(
      (series) => series.purpose !== purpose,
    );
    expect(() => readHourSetupInput(saved, saved.request.input)).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "series_configuration_unsupported" },
      }),
    );
  },
);

it.each(["standard", "rectificative", "unknown"])(
  "refuses three setup prefixes whose full purpose is replaced by %s",
  (purpose) => {
    const saved = fixture();
    saved.bases = saved.bases.map((base, index) => (index === 1 ? { ...base, purpose } : base));
    saved.request.input.allocation.series[1]!.purpose = purpose;
    expect(() => readHourSetupInput(saved, saved.request.input)).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "series_configuration_unsupported" },
      }),
    );
  },
);

it.each([true, false])(
  "terminal resume with a second clock %s never selects a replacement hour",
  async (agrees) => {
    const f = configured();
    if (agrees) internetAgrees();
    const t = terminal(f, []);
    expect(await f.seat.commandResume!(fixture(), t.actions)).toEqual(
      agrees ? { status: "ready", input } : { status: "cancelled" },
    );
    expect(t.prompts).toEqual([]);
    expect(f.history).toEqual([]);
  },
);

it("terminal resume refuses an altered retained request before comparing clocks", async () => {
  const f = configured();
  const t = terminal(f, ["yes"]);
  const saved = fixture();
  saved.request.identity = "0CNPG";
  await expect(f.seat.commandResume!(saved, t.actions)).rejects.toMatchObject(refusal);
  expect(t.output).toEqual([]);
  expect(t.prompts).toEqual([]);
  expect(f.history).toEqual([]);
});

it.each([null, { status: "other" }, { status: "waiting" }, { status: "waiting", targetMs: 1.5 }])(
  "terminal refuses malformed preview %j before requesting an allocation",
  async (preview) => {
    const f = configured();
    internetAgrees();
    const t = terminal(f, ["no"]);
    await expect(
      f.seat.command!(context, {
        ...t.actions,
        prepare: async (proposal) =>
          (proposal as { action: string }).action === "selection"
            ? preview
            : t.actions.prepare(proposal),
      }),
    ).rejects.toMatchObject(refusal);
    expect(f.history).toEqual([]);
    expect(t.prompts).toEqual([]);
  },
);

it.each([1.5, 8_640_000_000_060_000, -8_640_000_000_060_000])(
  "terminal refuses a preview wait whose target %d is no time",
  async (targetMs) => {
    const f = configured();
    internetAgrees();
    const t = terminal(f, []);
    await expect(
      f.seat.command!(context, {
        ...t.actions,
        prepare: async (proposal) =>
          (proposal as { action: string }).action === "selection"
            ? { status: "waiting", targetMs }
            : t.actions.prepare(proposal),
      }),
    ).rejects.toMatchObject(refusal);
    expect(t.output).not.toContain(
      "Waiting to confirm the time, so no invoice series is ever repeated.",
    );
    expect(f.history).toEqual([]);
  },
);

it.each([1.5, 8_640_000_000_060_000, -8_640_000_000_060_000])(
  "terminal refuses a selection wait whose target %d is no time",
  async (targetMs) => {
    const f = configured();
    internetAgrees();
    const t = terminal(f, []);
    await expect(
      f.seat.command!(context, {
        ...t.actions,
        prepare: async (proposal) =>
          (proposal as { action: string }).action === "selection"
            ? { status: "preview" }
            : t.actions.prepare(proposal),
        select: async () => ({ status: "waiting", targetMs }),
      }),
    ).rejects.toMatchObject(refusal);
    expect(t.output).not.toContain(
      "Waiting to confirm the time, so no invoice series is ever repeated.",
    );
    expect(f.history).toEqual([]);
  },
);

it("resumes an authenticated retained setup without spending another hour", async () => {
  startEarly();
  const f = configured();
  const read = f.host.readSetupFacts!;
  let contextKey = "original-owner";
  f.host.readSetupFacts = async (binding) => ({
    ...(await read(binding)),
    contextKey,
    continuationKey: "retained-attempt",
  });
  await f.clock();
  const saved = await f.select();
  const before = structuredClone(f.history);
  contextKey = "reauthenticated-owner";
  await f.clock();
  await f.seat.resume!({ ...context, request: saved }, input, "a".repeat(64));
  expect(f.history).toHaveLength(before.length + 1);
  expect(f.history[0]).toEqual(before[0]);
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  expect(
    await withOperationAuthority(context.binding, context.administratorId, (authority) =>
      operations.prepare({ binding: context.binding, authority, input }, async () => "resumed"),
    ),
  ).toBe("resumed");
});

it("binds an exact public recovery statement to its staged node and frozen setup", () => {
  const f = configured();
  const saved = fixture();
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
    taxpayerName: "Olivo",
    venueName: "Centro",
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: "node", name: "key" },
  };
  const document = {
    statement,
    stage: { nodeId: "node", name: "key" },
    identity: { taxpayerName: "Olivo", venueName: "Centro" },
  } as Parameters<NonNullable<typeof f.seat.recoveryDocument>>[2];
  expect(f.seat.recoveryDocument!(saved, f.seat.inspect(saved, input), document)).toEqual(
    statement,
  );
  expect(() =>
    f.seat.recoveryDocument!(saved, f.seat.inspect(saved, input), {
      ...document,
      statement: null,
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    }),
  );
  expect(f.history).toEqual([]);
});

async function boxOnlyComparison(f: ReturnType<typeof configured>) {
  source.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const challenge = (await f.prepare({ action: "clock-challenge" })) as { id: string };
  return (await f.prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  })) as { id: string };
}
const prepareSetup = (f: ReturnType<typeof configured>) =>
  withOperationAuthority(context.binding, context.administratorId, (authority) =>
    FISCAL_OPERATIONS.configure!(f.host).prepare(
      { binding: context.binding, authority, input },
      async () => "prepared",
    ),
  );

it("a page's name is issued after another page's box-only re-check", async () => {
  startEarly();
  const f = configured();
  await f.clock();
  expect(await f.select()).toMatchObject({ status: "selected", identity: "0CNNW" });
  await boxOnlyComparison(f);
  expect(await prepareSetup(f)).toBe("prepared");
});

it("issuing refuses when the only fresh reading is the box's alone", async () => {
  startEarly();
  const f = configured();
  await f.clock();
  await f.select();
  const stale = vi.spyOn(performance, "now");
  const start = performance.now();
  stale.mockImplementation(() => start + 31_000);
  vi.setSystemTime(Date.now() + 31_000);
  try {
    await boxOnlyComparison(f);
    await expect(prepareSetup(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "second_clock_missing" },
    });
  } finally {
    stale.mockRestore();
  }
});

it("issuing refuses clock_stale when the only passing reading is older than thirty seconds", async () => {
  startEarly();
  const f = configured();
  await f.clock();
  await f.select();
  const stale = vi.spyOn(performance, "now");
  const start = performance.now();
  stale.mockImplementation(() => start + 30_001);
  vi.setSystemTime(Date.now() + 30_001);
  try {
    await expect(prepareSetup(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    });
  } finally {
    stale.mockRestore();
  }
});

it("a select with another page's box-only comparison stays refused", async () => {
  startEarly();
  const f = configured();
  const boxPage = await boxOnlyComparison(f);
  await f.clock();
  await expect(f.seat.candidates(context, { comparisonId: boxPage.id })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
  expect(f.history).toEqual([]);
  expect(await f.select()).toMatchObject({ status: "selected", identity: "0CNNW" });
});

const minuteMs = (iso: string) => Date.parse(iso);
const digest = "a".repeat(64);
// The kinds of public evidence a real reader returns that carry no minute name.
const namelessEvidence = [
  {
    format: "waitron-hour-history",
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    sources: [{ reference: "venue", complete: true, records: [] }],
  },
  {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" },
    taxpayerName: "Olivo",
    venueName: "Centro",
    createdAt: "2026-10-16T11:40:00.000Z",
    nodeKey: { nodeId: "node", name: "key" },
  },
  {
    version: 1,
    kind: "cloud-initial-confirmation",
    binding: context.binding,
    operatorId: "administrator",
    allocationId: "cloud/event",
    receiptId: "receipt",
    priorActivation: "none",
    incidentEvidence: "cloud/event",
    requiredBases: context.bases,
    delivery: { kept: true, documentDigest: digest, historyDigest: digest },
  },
  {
    version: 1,
    allocationId: "paper/event",
    binding: context.binding,
    operatorId: "administrator",
    priorActivation: "none",
    incidentEvidence: "paper/event",
    requiredBases: context.bases,
    recipientVenueId: "first-setup:attempt",
    generationId: "generation",
    blockId: "block",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  },
];
const hourEvidence = (identity: string) => ({
  format: "waitron-hour-history",
  scope: { taxpayerNif: "89890001K", environment: "preproduction" },
  sources: [
    {
      reference: "retired",
      complete: true,
      records: [
        {
          taxpayerNif: "89890001K",
          environment: "preproduction",
          reference: "row/retired",
          kind: "intent",
          softwareId: "W1",
          nodeId: "node",
          identity,
          recordedAtMs: null,
        },
      ],
    },
  ],
});
async function selectedIntents(issuedAt: string, identity: string) {
  startEarly();
  const f = configured();
  await f.clock();
  await f.select();
  const state = structuredClone(f.history.at(-1)) as { entries: Record<string, unknown>[] };
  for (const entry of state.entries)
    if (entry.kind === "intent") Object.assign(entry, { issuedAt, identity });
  return { seat: f.seat, state };
}
it("no name gives no floor", () => {
  const seat = configured().seat;
  expect(seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [] })).toBeNull();
  expect(
    seat.startAgainFloor!({
      attempts: [{ context, input: undefined }],
      preparations: [null],
      publicEvidence: namelessEvidence,
    }),
  ).toBeNull();
});
it("evidence that names nothing and is no known nameless kind is refused, not read as empty", () => {
  const seat = configured().seat;
  for (const evidence of [
    {},
    { foo: 1 },
    { format: "waitron-hour-histroy" },
    { ...namelessEvidence[1], venueName: 7 },
    { ...namelessEvidence[2], delivery: null },
    { ...namelessEvidence[3], currentEntryState: "kept" },
    { ...namelessEvidence[3], extra: true },
  ])
    expect(() =>
      seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [evidence] }),
    ).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "history_invalid" },
      }),
    );
});
it("the latest of a frozen request, an intent and public evidence gives the floor", async () => {
  const { seat, state } = await selectedIntents("2026-10-16T11:45:00.000Z", "0CNP1");
  const attempts = [{ context: fixture(), input: undefined }];
  expect(
    seat.startAgainFloor!({
      attempts,
      preparations: [state],
      publicEvidence: [hourEvidence("0CNPG")],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T12:01:00Z"), lastName: "0CNPG" });
  expect(
    seat.startAgainFloor!({
      attempts,
      preparations: [state],
      publicEvidence: [hourEvidence("0CNNA")],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T11:46:00Z"), lastName: "0CNP1" });
  expect(
    seat.startAgainFloor!({
      attempts: [{ context: fixture(), input }],
      preparations: [],
      publicEvidence: [hourEvidence("0CNNA")],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T11:41:00Z"), lastName: "0CNNW" });
});
it("the floor is the start of the minute after the name", () => {
  expect(
    configured().seat.startAgainFloor!({
      attempts: [{ context: fixture(), input: undefined }],
      preparations: [],
      publicEvidence: [],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T11:41:00.000Z"), lastName: "0CNNW" });
});
it("a last write alone gives a time floor with no name", () => {
  expect(
    configured().seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      lastWriteMs: Date.parse("2026-10-16T15:42:10.000Z"),
    }),
  ).toEqual({ floorMs: Date.parse("2026-10-16T15:45:00.000Z"), lastName: null });
});
it("a known name and a last write give the later floor, naming the name only when it is the later", () => {
  const seat = configured().seat;
  const named = (lastWriteMs: number) =>
    seat.startAgainFloor!({
      attempts: [{ context: fixture(), input: undefined }],
      preparations: [],
      publicEvidence: [],
      lastWriteMs,
    });
  expect(named(minuteMs("2026-10-16T11:30:00.000Z"))).toEqual({
    floorMs: minuteMs("2026-10-16T11:41:00.000Z"),
    lastName: "0CNNW",
  });
  expect(named(minuteMs("2026-10-16T15:42:10.000Z"))).toEqual({
    floorMs: minuteMs("2026-10-16T15:45:00.000Z"),
    lastName: null,
  });
  expect(named(minuteMs("2026-10-16T11:38:00.000Z"))).toEqual({
    floorMs: minuteMs("2026-10-16T11:41:00.000Z"),
    lastName: "0CNNW",
  });
});
it("the time floor is the start of the minute after the last write plus 150 seconds", () => {
  const seat = configured().seat;
  const floor = (lastWriteMs: number) =>
    seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [], lastWriteMs });
  expect(floor(minuteMs("2026-10-16T15:42:30.000Z"))).toEqual({
    floorMs: minuteMs("2026-10-16T15:46:00.000Z"),
    lastName: null,
  });
  expect(floor(minuteMs("2026-10-16T15:42:29.999Z"))).toEqual({
    floorMs: minuteMs("2026-10-16T15:45:00.000Z"),
    lastName: null,
  });
  expect(floor(minuteMs("2025-06-01T00:00:00.000Z"))).toEqual({
    floorMs: minuteMs("2026-01-01T00:00:00.000Z"),
    lastName: null,
  });
});
it("a last write that is not a whole number of milliseconds refuses", () => {
  const seat = configured().seat;
  for (const lastWriteMs of [1.5, Number.NaN])
    expect(() =>
      seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [], lastWriteMs }),
    ).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "history_invalid" },
      }),
    );
});
it("an unreadable intent still refuses beside a last write", async () => {
  const { seat, state } = await selectedIntents("2026-10-16T11:45:00.000Z", "0CNNW");
  expect(() =>
    seat.startAgainFloor!({
      attempts: [],
      preparations: [state],
      publicEvidence: [],
      lastWriteMs: minuteMs("2026-10-16T15:42:10.000Z"),
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});
it("an unreadable intent refuses rather than giving no floor", async () => {
  const { seat, state } = await selectedIntents("2026-10-16T11:45:00.000Z", "0CNNW");
  const refused = expect.objectContaining({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
  for (const value of [
    { attempts: [], preparations: [state], publicEvidence: [] },
    { attempts: [], preparations: [{ version: 1, entries: [{}] }], publicEvidence: [] },
    { attempts: [], preparations: [], publicEvidence: [null] },
    {
      attempts: [{ context: { ...fixture(), request: { status: "selected" } }, input: undefined }],
      preparations: [],
      publicEvidence: [],
    },
  ])
    expect(() => seat.startAgainFloor!(value)).toThrowError(refused);
});
it("a paper register's numbered positions are not minute names", () => {
  const scope = { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" };
  const known = {
    scope,
    sHighWater: 42,
    pHighWater: 7,
    sBurnFloor: 42,
    pBurnFloor: 7,
    currentHead: null,
    retainedHeads: [],
    originals: [],
    retiredBindings: [],
  };
  const history = {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    registerId: "retired-public-register",
    scope,
    mode: "checkpoint",
    originals: [],
    revisions: [],
    checkpoint: {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "typed-42",
      scope,
      sHighWater: 42,
      pHighWater: 7,
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: "2026-10-16T03:00:00.000Z",
      },
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: "2026-10-16T03:00:00.000Z",
    },
  };
  const seat = configured().seat;
  expect(seat.retainedAssignments!({ history, known }).positions).toHaveLength(2);
  expect(
    seat.startAgainFloor!({ attempts: [], preparations: [], publicEvidence: [{ history, known }] }),
  ).toBeNull();
});
const recoveryInput = (issuedAt: string, identity: string) => ({
  allocation: {
    ...input.allocation,
    allocationId: "hour/restore",
    installationIdentity: identity,
    series: context.bases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
    issuedAt,
  },
  approval: {
    ...input.approval,
    eventId: "restore",
    sourceId: "archive",
    operatorId: { kind: "recovery-key", nodeId: "node", eventId: "restore" },
    oldMachineAbsent: false,
    oldMachineOffline: true,
    confirmedAt: issuedAt,
    incidentEvidence: "hour/restore",
  },
});
it("a backup recovery's recorded input names its minute", () => {
  const seat = configured().seat;
  const recorded = recoveryInput("2026-10-16T12:42:00.000Z", "0CNQT");
  expect(
    seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      recoveryInputs: [recorded],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
  expect(
    seat.startAgainFloor!({
      attempts: [{ context: fixture(), input: undefined }],
      preparations: [],
      publicEvidence: [],
      recoveryInputs: [recoveryInput("2026-10-16T11:39:00.000Z", "0CNNV")],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T11:41:00.000Z"), lastName: "0CNNW" });
});
it("a recorded input the module cannot read names nothing, and a readable one beside it still names", () => {
  const seat = configured().seat;
  const valid = recoveryInput("2026-10-16T12:42:00.000Z", "0CNQT");
  const malformed: unknown[] = [
    null,
    "0CNQT",
    {},
    { allocation: valid.allocation },
    { ...valid, extra: true },
    { ...valid, allocation: { ...valid.allocation, installationIdentity: "0CNQV" } },
    { ...valid, allocation: { ...valid.allocation, installationIdentity: "nope" } },
    { ...valid, allocation: { ...valid.allocation, source: "cloud" } },
    { ...valid, allocation: { ...valid.allocation, reservationEvidence: {} } },
    { ...valid, allocation: { ...valid.allocation, issuedAt: "2026-10-16T12:42:00Z" } },
    { ...valid, allocation: { ...valid.allocation, issuedAt: "2025-12-31T23:59:00.000Z" } },
    { ...valid, allocation: { ...valid.allocation, extra: true } },
    { ...valid, approval: { ...valid.approval, operatorId: 7 } },
    { ...valid, approval: null },
  ];
  for (const recorded of malformed) {
    expect(
      seat.startAgainFloor!({
        attempts: [],
        preparations: [],
        publicEvidence: [],
        recoveryInputs: [recorded],
      }),
    ).toBeNull();
  }
  expect(
    seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      recoveryInputs: [...malformed, valid],
    }),
  ).toEqual({ floorMs: minuteMs("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
});
const databaseRecord = (identity: unknown, taxpayerNif = "89890001K") => ({
  reference: "invoice_series/series",
  kind: "series",
  taxpayerNif,
  environment: "preproduction",
  softwareId: "W1",
  nodeId: "node",
  identity,
  recordedAtMs: null,
});
const databaseSource = (records: unknown[], complete = true) => ({
  reference: "venue",
  complete,
  records,
});
const historyInvalid = expect.objectContaining({
  code: "sif.allocation_invalid",
  params: { reason: "history_invalid" },
});
it("a setup database's history names its latest minute", () => {
  const seat = configured().seat;
  const floor = (
    databaseHistory: unknown[],
    attempts = [] as { context: InitialSetupContext; input: unknown }[],
  ) => seat.startAgainFloor!({ attempts, preparations: [], publicEvidence: [], databaseHistory });
  expect(floor([databaseSource([databaseRecord("0CNPG")])])).toEqual({
    floorMs: minuteMs("2026-10-16T12:01:00.000Z"),
    lastName: "0CNPG",
  });
  expect(floor([{ ...databaseSource([databaseRecord("0CNPG")]), reference: "elsewhere" }])).toEqual(
    { floorMs: minuteMs("2026-10-16T12:01:00.000Z"), lastName: "0CNPG" },
  );
  expect(
    floor([databaseSource([databaseRecord("0CNNA")])], [{ context: fixture(), input: undefined }]),
  ).toEqual({ floorMs: minuteMs("2026-10-16T11:41:00.000Z"), lastName: "0CNNW" });
  expect(floor([databaseSource([])])).toBeNull();
  expect(floor([])).toBeNull();
  for (const [kind, reference] of [
    ["activation", "registro_sif/sif"],
    ["intent", "fiscal_allocations/event"],
    ["reservation", "fiscal_reservations/event"],
  ])
    expect(
      floor([
        databaseSource([
          databaseRecord("0CNPG"),
          {
            ...databaseRecord("0CNQT"),
            kind,
            reference,
            recordedAtMs: minuteMs("2026-10-16T12:42:00.000Z"),
          },
        ]),
      ]),
    ).toEqual({ floorMs: minuteMs("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
});
it("a setup database's later name under another taxpayer or environment still raises the floor", () => {
  const seat = configured().seat;
  const floor = (records: unknown[]) =>
    seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      databaseHistory: [databaseSource(records)],
    });
  expect(floor([databaseRecord("0CNPG"), databaseRecord("0CNQT", "B12345674")])).toEqual({
    floorMs: minuteMs("2026-10-16T12:43:00.000Z"),
    lastName: "0CNQT",
  });
  expect(
    floor([databaseRecord("0CNPG"), { ...databaseRecord("0CNQT"), environment: "production" }]),
  ).toEqual({ floorMs: minuteMs("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
  expect(
    floor([
      databaseRecord("0CNPG"),
      {
        ...databaseRecord("0CNQT", "B12345674"),
        kind: "reservation",
        reference: "fiscal_reservations/event",
        recordedAtMs: minuteMs("2026-10-16T12:42:00.000Z"),
      },
    ]),
  ).toEqual({ floorMs: minuteMs("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
});
it("a setup database's history that is incomplete refuses", () => {
  expect(() =>
    configured().seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      databaseHistory: [databaseSource([databaseRecord("0CNPG")], false)],
    }),
  ).toThrowError(historyInvalid);
});
it("a setup database's record with no readable name refuses", () => {
  const seat = configured().seat;
  for (const identity of [undefined, null, "", "nope", 7])
    expect(() =>
      seat.startAgainFloor!({
        attempts: [],
        preparations: [],
        publicEvidence: [],
        databaseHistory: [databaseSource([databaseRecord("0CNPG"), databaseRecord(identity)])],
      }),
    ).toThrowError(historyInvalid);
});
it("a malformed setup database history refuses", () => {
  const seat = configured().seat;
  for (const source of [
    null,
    "venue",
    [],
    { reference: "venue", complete: true },
    { reference: "venue", complete: true, records: {} },
    { reference: "venue", complete: "yes", records: [] },
    databaseSource([null]),
    databaseSource(["0CNPG"]),
    // eslint-disable-next-line no-sparse-arrays
    databaseSource([databaseRecord("0CNPG"), , databaseRecord("0CNQT")]),
  ])
    expect(() =>
      seat.startAgainFloor!({
        attempts: [],
        preparations: [],
        publicEvidence: [],
        databaseHistory: [source],
      }),
    ).toThrowError(historyInvalid);
  expect(() =>
    seat.startAgainFloor!({
      attempts: [],
      preparations: [],
      publicEvidence: [],
      // eslint-disable-next-line no-sparse-arrays
      databaseHistory: [databaseSource([databaseRecord("0CNPG")]), , databaseSource([])],
    }),
  ).toThrowError(historyInvalid);
});
