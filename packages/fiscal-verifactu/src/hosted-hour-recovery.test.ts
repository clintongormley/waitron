import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type ModuleOperationInput,
  type ModuleRecoveryFacts,
  type OperationBinding,
  type OperationOperator,
} from "@waitron/module";
import { FISCAL_OPERATIONS } from "./index.js";
import * as internet from "./hour-clock-internet.js";
import * as release from "./hour-release.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "recovered-hour",
  sourceId: "selected-archive/sha256",
  targetNodeId: "recovered-node",
};
const key = {
  kind: "recovery-key" as const,
  nodeId: binding.targetNodeId,
  eventId: binding.eventId,
};
const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
let monotonic = 1000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  monotonic = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.spyOn(release, "readHourRelease").mockReturnValue({
    sourceCommit: "a".repeat(40),
    instantMs: NOW - 86_400_000,
    committedAt: "2026-10-15T11:40:00.000Z",
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
  vi.spyOn(internet, "observeInternetHourClock").mockImplementation(async () => ({
    source: "internet",
    result: "unavailable",
    reason: "tls",
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture() {
  let value: unknown = null;
  const history: unknown[] = [];
  let held = false;
  let reads = 0;
  const facts: ModuleRecoveryFacts = {
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction",
    bases: [
      { code: "a/b_.-", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
    contextKey: "selected-backup/host-key/isolation",
    history: [{ reference: "selected-backup", complete: true, records: [] }],
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    priorActivation: "none",
  };
  const host: ModuleOperationHost = {
    environment: {},
    readPublicEvidence: async () => undefined,
    readRecoveryFacts: async () => {
      if (!held) throw new Error("facts read without exclusion");
      reads++;
      return facts;
    },
    withPreparationState: async (_binding, run) => {
      if (held) throw new Error("nested exclusion");
      held = true;
      try {
        return await run({
          get value() {
            return structuredClone(value);
          },
          get history() {
            return structuredClone(history);
          },
          async replace(next) {
            value = structuredClone(next);
            history.push(structuredClone(next));
          },
        });
      } finally {
        held = false;
      }
    },
  };
  return {
    host,
    facts,
    history,
    get reads() {
      return reads;
    },
  };
}
type Operations = ReturnType<NonNullable<typeof FISCAL_OPERATIONS.configure>>;
type Operation = Pick<ModuleOperationInput, "binding" | "authority">;
async function compare(operations: Operations, operation: Operation, browser = false) {
  const challenge = (await operations.recovery!(operation, { action: "clock-challenge" })) as {
    id: string;
  };
  return (await operations.recovery!(operation, {
    action: "compare-clocks",
    browser: browser ? { challengeId: challenge.id, instantMs: Date.now() } : null,
  })) as { id: string; clock: { requiresConfirmation: boolean; usable: { source: string }[] } };
}
async function confirmed(operations: Operations, operation: Operation) {
  const displayed = await compare(operations, operation);
  await operations.recovery!(operation, { action: "confirm-clock", comparisonId: displayed.id });
  return displayed;
}

it.each(["restore", "re-register", "promote"])(
  "prepares %s only from the selected hour with the correct authenticated operator",
  async (action) => {
    const f = fixture();
    const operations = FISCAL_OPERATIONS.configure!(f.host);
    const selectedBinding = { ...binding, action };
    const operator = action === "promote" ? "authenticated-manager" : key;
    await withOperationAuthority(selectedBinding, operator, async (authority) => {
      const operation = { binding: selectedBinding, authority };
      await confirmed(operations, operation);
      const selected = (await operations.recovery!(operation, {
        action: "select",
        answer: "no",
        installationCodes: ["06rA"],
      })) as { status: string; identity: string; input: unknown };
      expect(selected).toMatchObject({
        status: "selected",
        identity: "06RB",
        input: {
          allocation: {
            source: "hour",
            installationIdentity: "06RB",
            series: [
              { code: "FF-06RB", purpose: "full" },
              { code: "R-06RB", purpose: "rectificative" },
              { code: "a/b_.--06RB", purpose: "standard" },
            ],
          },
          approval: { operatorId: operator, eventId: "recovered-hour", oldMachineOffline: true },
        },
      });
      const before = structuredClone(f.history);
      expect(
        await operations.prepare({ ...operation, input: selected.input }, async (prepared) => {
          expect(prepared.binding).toEqual(selectedBinding);
          expect(prepared.input).not.toEqual(selected.input);
          return "admitted";
        }),
      ).toBe("admitted");
      expect(f.history).toEqual(before);
      await expect(
        operations.prepare({ ...operation, input: {} }, async () => "unexpected"),
      ).rejects.toMatchObject(refusal("event_mismatch"));
    });
    expect(f.history).toHaveLength(1);
  },
);

it("uses the challenge's browser reading without inventing a confirmation requirement", async () => {
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    const displayed = await compare(operations, operation, true);
    expect(displayed.clock.requiresConfirmation).toBe(false);
    expect(displayed.clock.usable.map((sample) => sample.source)).toEqual(["browser", "box"]);
    expect(await operations.recovery!(operation, { action: "preview" })).toMatchObject({
      status: "preview",
      identity: "06RB",
    });
    expect(f.history).toEqual([]);
    expect(
      await operations.recovery!(operation, {
        action: "select",
        answer: "no",
        installationCodes: ["06RA"],
      }),
    ).toMatchObject({ status: "selected", identity: "06RB" });
  });
});

it.each(["yes", "unknown"])(
  "retains a %s wait across newly configured public adapters",
  async (answer) => {
    const f = fixture();
    await withOperationAuthority(binding, key, async (authority) => {
      const operation = { binding, authority };
      await confirmed(FISCAL_OPERATIONS.configure!(f.host), operation);
      const proposal = { action: "select", answer, installationCodes: ["06RA"] };
      expect(
        await FISCAL_OPERATIONS.configure!(f.host).recovery!(operation, proposal),
      ).toMatchObject({ status: "waiting", remainingMs: 1_200_000 });
      vi.setSystemTime(NOW + 1_200_000);
      monotonic += 1_200_000;
      await confirmed(FISCAL_OPERATIONS.configure!(f.host), operation);
      expect(
        await FISCAL_OPERATIONS.configure!(f.host).recovery!(operation, proposal),
      ).toMatchObject({ status: "selected", identity: "06RC" });
      expect(f.history).toHaveLength(2);
    });
  },
);

it.each(["clock-challenge", "compare-clocks", "resume"])(
  "%s invalidates an earlier manual clock confirmation",
  async (action) => {
    const f = fixture();
    const operations = FISCAL_OPERATIONS.configure!(f.host);
    await withOperationAuthority(binding, key, async (authority) => {
      const operation = { binding, authority };
      await confirmed(operations, operation);
      if (action === "resume") await operations.resumeRecovery!(operation);
      else
        await operations.recovery!(
          operation,
          action === "clock-challenge" ? { action } : { action, browser: null },
        );
      await expect(
        operations.recovery!(operation, {
          action: "select",
          answer: "no",
          installationCodes: ["06RA"],
        }),
      ).rejects.toMatchObject(
        refusal(action === "clock-challenge" ? "clock_stale" : "clock_unconfirmed"),
      );
      expect(f.history).toEqual([]);
    });
  },
);

it("resumes committed work without collecting fresh clocks or rewriting the journal", async () => {
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    await confirmed(operations, operation);
    const selected = (await operations.recovery!(operation, {
      action: "select",
      answer: "no",
      installationCodes: ["06RA"],
    })) as { input: unknown };
    Object.assign(f.facts, { priorActivation: "committed" });
    const before = structuredClone(f.history);
    vi.mocked(internet.observeInternetHourClock).mockImplementation(async () => {
      throw new Error("committed replay must not call network");
    });
    await operations.resumeRecovery!(operation);
    expect(
      await operations.prepare({ ...operation, input: selected.input }, async () => "exact replay"),
    ).toBe("exact replay");
    expect(f.history).toEqual(before);
  });
});

it.each([
  null,
  [],
  1,
  {},
  { action: "unknown" },
  { action: "preview", extra: true },
  { action: "select", answer: "maybe", installationCodes: ["06RA"] },
  { action: "select", answer: "no" },
  { action: "compare-clocks" },
  { action: "compare-clocks", browser: {} },
  { action: "compare-clocks", browser: { challengeId: 1, instantMs: NOW } },
  { action: "compare-clocks", browser: { challengeId: "x", instantMs: NOW + 0.5 } },
  { action: "compare-clocks", browser: { challengeId: "x", instantMs: NOW, extra: true } },
  { action: "confirm-clock", comparisonId: 42 },
  { action: "confirm-clock", comparisonId: "x", extra: true },
])("refuses malformed recovery proposal %j without saving an hour", async (proposal) => {
  const f = fixture();
  await withOperationAuthority(binding, key, async (authority) => {
    await expect(
      FISCAL_OPERATIONS.configure!(f.host).recovery!({ binding, authority }, proposal),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  expect(f.history).toEqual([]);
});

it.each(["readRecoveryFacts", "withPreparationState"] as const)(
  "requires host capability %s before using recovery",
  async (missing) => {
    const f = fixture();
    delete f.host[missing];
    await withOperationAuthority(binding, key, async (authority) => {
      await expect(
        FISCAL_OPERATIONS.configure!(f.host).recovery!(
          { binding, authority },
          { action: "preview" },
        ),
      ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
    });
    expect(f.history).toEqual([]);
  },
);

it.each(["preview", "resume"])("rejects another country before %s", async (action) => {
  const f = fixture();
  Object.assign(f.facts, { country: "FR" });
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    await expect(
      action === "resume"
        ? operations.resumeRecovery!(operation)
        : operations.recovery!(operation, { action: "preview" }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  expect(f.history).toEqual([]);
});

it.each<OperationOperator>(["administrator", { ...key, eventId: "different-event" }])(
  "rejects unauthenticated recovery principal %j before reading host facts",
  async (operator) => {
    const f = fixture();
    const operations = FISCAL_OPERATIONS.configure!(f.host);
    await withOperationAuthority(binding, operator, async (authority) => {
      const operation = { binding, authority };
      await expect(operations.recovery!(operation, { action: "preview" })).rejects.toMatchObject(
        refusal("reauthentication_required"),
      );
      await expect(operations.resumeRecovery!(operation)).rejects.toMatchObject(
        refusal("reauthentication_required"),
      );
    });
    expect(f.reads).toBe(0);
    expect(f.history).toEqual([]);
  },
);

it.each(["clock-challenge", "compare-clocks", "resume"])(
  "rechecks authority after the host read for %s",
  async (action) => {
    const f = fixture();
    let releaseRead!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = f.host.readRecoveryFacts!;
    f.host.readRecoveryFacts = async (held) => {
      const facts = await original(held);
      entered();
      await gate;
      return facts;
    };
    const operations = FISCAL_OPERATIONS.configure!(f.host);
    let pending!: Promise<unknown>;
    await withOperationAuthority(binding, key, async (authority) => {
      const operation = { binding, authority };
      pending =
        action === "resume"
          ? operations.resumeRecovery!(operation)
          : operations.recovery!(
              operation,
              action === "clock-challenge" ? { action } : { action, browser: null },
            );
      await reading;
    });
    const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
    releaseRead();
    await rejected;
    expect(internet.observeInternetHourClock).not.toHaveBeenCalled();
    expect(f.history).toEqual([]);
  },
);

it.each(["compare-clocks", "resume"])(
  "rechecks authority after the internet comparison for %s",
  async (action) => {
    const f = fixture();
    let releaseRead!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(internet.observeInternetHourClock).mockImplementation(async () => {
      entered();
      await gate;
      return { source: "internet", result: "unavailable", reason: "tls" };
    });
    const operations = FISCAL_OPERATIONS.configure!(f.host);
    let pending!: Promise<unknown>;
    await withOperationAuthority(binding, key, async (authority) => {
      const operation = { binding, authority };
      pending =
        action === "resume"
          ? operations.resumeRecovery!(operation)
          : operations.recovery!(operation, { action, browser: null });
      await reading;
    });
    const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
    releaseRead();
    await rejected;
    expect(f.history).toEqual([]);
  },
);

it("rejects a comparison identifier from another host context", async () => {
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    const first = await compare(operations, operation);
    Object.assign(f.facts, { contextKey: "different-selected-backup" });
    await compare(operations, operation);
    await expect(
      operations.recovery!(operation, {
        action: "confirm-clock",
        comparisonId: first.id,
      }),
    ).rejects.toMatchObject(refusal("clock_confirmation_required"));
    expect(f.history).toEqual([]);
  });
});

it("evicts old confirmations while retaining the next host context", async () => {
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    for (let index = 0; index < 65; index++) {
      Object.assign(f.facts, { contextKey: `context/${index}` });
      await confirmed(operations, operation);
    }
    Object.assign(f.facts, { contextKey: "context/1" });
    expect(await operations.recovery!(operation, { action: "preview" })).toMatchObject({
      status: "preview",
      identity: "06RB",
    });
    Object.assign(f.facts, { contextKey: "context/0" });
    await expect(operations.recovery!(operation, { action: "preview" })).rejects.toMatchObject(
      refusal("clock_stale"),
    );
    expect(f.history).toEqual([]);
  });
});

it.each([
  [{ oldMachineOffline: false }, "old_machine_active"],
  [{ oldMachineAbsent: true }, "old_machine_absence_unconfirmed"],
  [{ noParallelRecovery: false }, "parallel_recovery"],
] as const)("retains host isolation refusals for %j", async (changed, reason) => {
  const f = fixture();
  Object.assign(f.facts, changed);
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    await confirmed(operations, operation);
    await expect(
      operations.recovery!(operation, {
        action: "select",
        answer: "no",
        installationCodes: ["06RA"],
      }),
    ).rejects.toMatchObject(refusal(reason));
    expect(f.history).toEqual([]);
  });
});

it("uses reported installations as a floor before saving an hour", async () => {
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!(f.host);
  await withOperationAuthority(binding, key, async (authority) => {
    const operation = { binding, authority };
    await confirmed(operations, operation);
    await expect(
      operations.recovery!(operation, {
        action: "select",
        answer: "no",
        installationCodes: ["06rc"],
      }),
    ).rejects.toMatchObject(refusal("hour_not_later"));
    expect(f.history).toEqual([]);
  });
});
