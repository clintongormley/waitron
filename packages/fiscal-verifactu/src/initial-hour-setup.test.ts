import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type InitialSetupContext,
} from "@waitron/module";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
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
      identity: { taxpayerName: "Olivo Restauración SL", venueName: "Olivo Centro" },
      locale,
    });
    expect(document.statement).toEqual({
      kind: "waitron-recovery-document",
      installationCodes: ["06RB"],
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

it("the command document seat refuses a foreign staged node and changed hour input", async () => {
  const f = configured();
  const saved = fixture();
  const document = {
    key: {
      nodeId: "foreign",
      name: "2026-10-16 · ACRY",
      secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    },
    identity: { taxpayerName: "Olivo", venueName: "Centro" },
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
    identity: { taxpayerName: "Olivo", venueName: "Centro" },
    locale: "en",
  });
  expect(document.statement).toMatchObject({ createdAt: "2026-10-17T12:30:00.000Z" });
  expect(saved.request.input.allocation.installationIdentity).toBe("06RB");
  expect(f.history).toEqual([]);
});
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

it("the terminal's unavailable-clock confirmation prepares the exact complete hour input", async () => {
  const f = configured();
  const t = terminal(f, [" YES ", " NO "]);
  const result = await f.seat.command!(context, t.actions);
  expect(result).toEqual({ status: "ready", input });
  expect(t.output.join("\n")).toContain("box: 2026-10-16T11:40:00.000Z");
  expect(t.output.join("\n")).toContain("internet: unavailable");
  expect(t.output.join("\n")).toContain("every venue using this taxpayer's NIF");
  expect(t.prompts).toHaveLength(2);
  expect(f.history).toHaveLength(1);
});

it.each(["yes", "unknown"])(
  "terminal %s retains a wait without returning a usable input",
  async (answer) => {
    const f = configured();
    const t = terminal(f, ["yes", answer]);
    expect(await f.seat.command!(context, t.actions)).toEqual({ status: "waiting" });
    expect(t.output.join("\n")).toContain("2026-10-16T12:00:00.000Z");
    expect(t.output.join("\n")).toContain("does not reserve a separate hour");
    expect(f.history).toHaveLength(1);
  },
);

it.each([[""], ["no"], ["yes", ""], ["yes", "maybe"]])(
  "terminal cancellation %j records no hour",
  async (...answers: string[]) => {
    const f = configured();
    const t = terminal(f, answers);
    expect(await f.seat.command!(context, t.actions)).toEqual({ status: "cancelled" });
    expect(f.history).toEqual([]);
  },
);

it("the terminal keeps an already selected request without another comparison or declaration", async () => {
  const f = configured();
  const t = terminal(f, []);
  expect(await f.seat.command!(fixture(), t.actions)).toEqual({ status: "ready", input });
  expect(t.prompts).toEqual([]);
  expect(t.output).toEqual([]);
  expect(f.history).toEqual([]);
});

it("the terminal uses automatic agreement without a manual clock question", async () => {
  const f = configured();
  source.internet.mockImplementation(async () => {
    const monotonic = performance.now();
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
  const t = terminal(f, ["no"]);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "ready", input });
  expect(t.prompts).toHaveLength(1);
  expect(t.output.join("\n")).not.toContain("wrong time");
});

it("the terminal waits when clock uncertainty spans the hour boundary", async () => {
  const f = configured();
  vi.setSystemTime(new Date("2026-10-16T11:59:59.900Z"));
  source.internet.mockImplementation(async () => {
    const monotonic = performance.now();
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
  const t = terminal(f, []);
  expect(await f.seat.command!(context, t.actions)).toEqual({ status: "waiting" });
  expect(t.prompts).toEqual([]);
  expect(t.output.join("\n")).toContain("UTC-hour boundary");
  expect(f.history).toEqual([]);
});

it.each([null, { status: "invalid" }])(
  "the terminal rejects an unusable selection response %j",
  async (selected) => {
    const f = configured();
    const t = terminal(f, ["yes", "no"]);
    await expect(
      f.seat.command!(context, { ...t.actions, select: async () => selected }),
    ).rejects.toMatchObject(refusal);
    expect(f.history).toEqual([]);
  },
);

it("the terminal reconnects to the same wait without asking the taxpayer question again", async () => {
  const f = configured();
  expect(await f.seat.command!(context, terminal(f, ["yes", "unknown"]).actions)).toEqual({
    status: "waiting",
  });
  const before = structuredClone(f.history);
  const again = terminal(f, ["yes"]);
  expect(await f.seat.command!(context, again.actions)).toEqual({ status: "waiting" });
  expect(again.prompts).toEqual(["The box's displayed date and time are correct? [y/N]: "]);
  expect(again.output.join("\n")).toContain("2026-10-16T12:00:00.000Z");
  expect(f.history).toEqual(before);
});

it("the terminal retains the original unknown answer when its monotonic wait has finished", async () => {
  let monotonic = 1;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  try {
    const f = configured();
    expect(await f.seat.command!(context, terminal(f, ["yes", "unknown"]).actions)).toEqual({
      status: "waiting",
    });
    monotonic += 1_200_000;
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const resumed = terminal(f, ["yes"]);
    const result = await f.seat.command!(context, resumed.actions);
    expect(result).toMatchObject({
      status: "ready",
      input: { allocation: { installationIdentity: "06RC" } },
    });
    expect(resumed.prompts).toEqual(["The box's displayed date and time are correct? [y/N]: "]);
    expect(f.history).toHaveLength(2);
  } finally {
    clock.mockRestore();
  }
});

it("refuses a delivered sheet whose installation code differs from its frozen activation", () => {
  const f = configured();
  const saved = fixture();
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    installationCodes: ["06RC"],
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
