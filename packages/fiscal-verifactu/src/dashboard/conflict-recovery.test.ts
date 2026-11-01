import { active, input, committed, prepared } from "../../test/conflict-browser-fixture.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  createRequest,
  currentLocale,
  setLocale,
  type DashboardRequest,
  type DashboardScreenHandle,
} from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { ConflictRecovery } from "./conflict-recovery.js";
import type { ConflictRequest } from "../conflict-recovery-contract.js";

const hosts: HTMLElement[] = [];
let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("en");
  sessionStorage.removeItem("vf-conflict-attempt");
});
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
  setLocale(previousLocale);
  sessionStorage.removeItem("vf-conflict-attempt");
});

it("opens key-only recovery without a session or disclosing conflicts before key entry", async () => {
  const request = vi.fn(async () => {
    throw new Error("No request before key entry");
  });
  const pages = (
    VERIFACTU_DASHBOARD as typeof VERIFACTU_DASHBOARD & {
      publicPages?: readonly {
        path: string;
        create(ctx: { request: DashboardRequest; locale: "en" | "es" }): DashboardScreenHandle;
      }[];
    }
  ).publicPages;
  const page = pages?.find((entry) => entry.path === "/manage/recovery/fiscal-conflict");
  expect(page, "The module must supply its key-only public page").toBeDefined();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(page!.create({ request: request as DashboardRequest, locale: "en" }).render(), host);
  const screen = host.querySelector("vf-conflict-recovery") as HTMLElement & {
    updateComplete: Promise<boolean>;
  };
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("h1")!.textContent).toBe(
    "Recover from an invoice identity conflict",
  );
  const input = screen.shadowRoot!.querySelector("wt-input[name=recoveryKey]")!;
  await (input as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  const native = input.shadowRoot!.querySelector("input")!;
  expect(native.type).toBe("password");
  expect(native.value).toBe("");
  expect(native.autocomplete).toBe("off");
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("makes the inspect action primary only after the key is entered", async () => {
  const { screen } = await mount(async () => ({
    kind: "status",
    active: [],
    event: { kind: "none" },
  }));
  const action = () =>
    screen.shadowRoot!.querySelector("[data-action=inspect]") as HTMLElement & { variant: string };
  expect(action().variant).toBe("secondary");
  await key(screen, "current-key");
  expect(action().variant).toBe("primary");
});

async function mount(answer: (body: ConflictRequest) => Promise<unknown>) {
  const calls: ConflictRequest[] = [];
  const request: DashboardRequest = async <T>(_path: string, _method: string, body?: unknown) => {
    calls.push(structuredClone(body as ConflictRequest));
    return (await answer(body as ConflictRequest)) as T;
  };
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(VERIFACTU_DASHBOARD.publicPages![0]!.create({ request, locale: "en" }).render(), host);
  const screen = host.querySelector("vf-conflict-recovery") as ConflictRecovery;
  await screen.updateComplete;
  return { screen, calls };
}
async function key(screen: ConflictRecovery, value: string) {
  const field = screen.shadowRoot!.querySelector("wt-input[name=recoveryKey]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
async function click(screen: ConflictRecovery, action: string) {
  const button = screen.shadowRoot!.querySelector<HTMLElement>(`[data-action=${action}]`);
  expect(button, `Missing ${action} action`).not.toBeNull();
  button!.click();
  await screen.updateComplete;
}
async function confirm(screen: ConflictRecovery, name: string) {
  const field = screen.shadowRoot!.querySelector(`wt-switch[name=${name}]`);
  expect(field).not.toBeNull();
  field!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
async function inspect(screen: ConflictRecovery) {
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
}
async function compare(screen: ConflictRecovery) {
  await confirm(screen, "oldMachineOffline");
  await confirm(screen, "noParallelRecovery");
  await click(screen, "compare");
}

it("validates the key before any network work and allows a corrected key", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
  }));
  await click(screen, "inspect");
  expect(calls).toEqual([]);
  expect(screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.textContent).toContain(
    "Enter the current recovery key.",
  );
  await key(screen, "paper-secret");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")?.textContent).toContain(
      "A-0CNQA/19",
    ),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]!.recoveryKey).toBe("paper-secret");
  expect(calls[0]!.command).toEqual({ kind: "status" });
  expect(screen.shadowRoot!.innerHTML).not.toContain("paper-secret");
});

it("clears a refused recovery key and lets the operator authenticate again", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.recoveryKey === "replaced-key")
      throw { code: "promotion.break_glass_invalid", status: 403 };
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await key(screen, "replaced-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(
      screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
    ).toBe(""),
  );
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
  expect(calls.map((c) => c.recoveryKey)).toEqual(["replaced-key", "current-key"]);
});

it("does not disclose conflict data from a reply outside the public response contract", async () => {
  const { screen } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
    authority: "PRIVATE_AUTHORITY",
  }));
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(screen.shadowRoot!.innerHTML).not.toContain("PRIVATE_AUTHORITY");
});

it("Stop clears the native key and ignores a late status reply", async () => {
  let finish!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  const { screen, calls } = await mount(async () => held);
  await key(screen, "private-key");
  await click(screen, "inspect");
  expect(calls).toHaveLength(1);
  await click(screen, "stop");
  finish({ kind: "status", active: [active], event: { kind: "none" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("");
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(calls).toHaveLength(1);
});

it("requires both isolation answers, compares clocks and switches only on explicit action", async () => {
  const { screen, calls } = await mount(async (body) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : body.command.kind === "activate"
        ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
        : prepared(body),
  );
  await inspect(screen);
  await click(screen, "compare");
  expect(calls).toHaveLength(1);
  await confirm(screen, "oldMachineOffline");
  await click(screen, "compare");
  expect(calls).toHaveLength(1);
  await confirm(screen, "noParallelRecovery");
  await click(screen, "compare");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-identity]")?.textContent).toContain("0CNQR"),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(0);
  expect(
    calls
      .slice(1)
      .map((c) => (c.command.kind === "prepare" ? c.command.proposal.action : c.command.kind)),
  ).toEqual(["clock-challenge", "compare-clocks", "select"]);
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")?.textContent).toContain("A-0CNQR"),
  );
  const activation = calls.find((c) => c.command.kind === "activate")!;
  expect(activation.conflict).toEqual({ registroId: "record-1", caseId: "case-1", sifId: "sif-1" });
  expect(activation.oldMachineOffline).toBe(true);
  expect(activation.noParallelRecovery).toBe(true);
  expect(screen.shadowRoot!.querySelector("wt-input")).toBeNull();
});

it("does not select or activate when the second clock disagrees", async () => {
  const { screen, calls } = await mount(async (body) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : body.command.kind === "prepare" && body.command.proposal.action === "compare-clocks"
        ? {
            kind: "prepared",
            value: {
              id: "comparison-1",
              clock: {
                usable: [],
                unavailable: [],
                secondClock: true,
                disagreement: true,
                releaseBlocked: false,
                rangeBlocked: false,
              },
            },
          }
        : prepared(body),
  );
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The clocks do not agree",
    ),
  );
  expect(calls).toHaveLength(3);
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
});

it("waits five seconds between automatic minute checks and never activates from a countdown", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", targetMs: Date.now() + 60000, remainingMs: 60000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview")
      return { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")).not.toBeNull();
  const count = calls.length;
  await vi.advanceTimersByTimeAsync(4999);
  expect(calls).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(1);
  await screen.updateComplete;
  expect(calls).toHaveLength(count + 1);
  expect(calls.at(-1)!.command).toEqual({ kind: "prepare", proposal: { action: "preview" } });
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  await vi.advanceTimersByTimeAsync(60000);
  expect(calls).toHaveLength(count + 1);
});

it("releases the countdown after a failed automatic check so Compare clocks can be retried", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", remainingMs: 60000, targetMs: Date.now() + 60000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview")
      throw { code: "connection.failed" };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")).toBeNull();
  const action = screen.shadowRoot!.querySelector("[data-action=compare]") as HTMLElement & {
    disabled: boolean;
  };
  expect(action.disabled).toBe(false);
  const before = calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(calls).toHaveLength(before);
});

it("retains only event and conflict across Stop and reopening, and authenticates the exact attempt", async () => {
  const answer = async (body: ConflictRequest) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : prepared(body);
  const first = await mount(answer);
  await inspect(first.screen);
  await compare(first.screen);
  await vi.waitFor(() =>
    expect(first.screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  const before = first.calls.at(-1)!;
  await click(first.screen, "stop");
  const retained = JSON.parse(sessionStorage.getItem("vf-conflict-attempt")!);
  expect(retained).toEqual({
    eventId: before.eventId,
    conflict: { registroId: "record-1", caseId: "case-1", sifId: "sif-1" },
  });
  first.screen.remove();
  const second = await mount(answer);
  await inspect(second.screen);
  expect(second.calls[0]!.eventId).toBe(before.eventId);
  expect(second.calls[0]!.conflict).toEqual(before.conflict);
  expect(second.calls[0]!.recoveryKey).toBe("current-key");
});

it("requires a new event and key after an interrupted retained attempt", async () => {
  let retained = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: [active],
        event: { kind: retained ? "restart-required" : "none" },
      };
    if (body.command.kind === "activate") {
      retained = true;
      throw { code: "connection.failed" };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=again]")).not.toBeNull(),
  );
  const original = calls[0]!.eventId;
  await click(screen, "again");
  retained = false;
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("");
  await inspect(screen);
  expect(calls.at(-1)!.eventId).not.toBe(original);
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
});

it("keeps a rate-limit refusal actionable without starting an automatic retry loop", async () => {
  let limited = true;
  const { screen, calls } = await mount(async () => {
    if (limited) throw { code: "recovery.rate_limited", status: 429 };
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "Wait a minute",
    ),
  );
  expect(calls).toHaveLength(1);
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("");
  await key(screen, "current-key");
  expect(
    (
      screen.shadowRoot!.querySelector("[data-action=inspect]") as HTMLElement & {
        disabled: boolean;
      }
    ).disabled,
  ).toBe(false);
  limited = false;
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
});

it("refuses a selected allocation for another event before offering Switch", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return { kind: "prepared", value: { status: "selected", identity: "0CNQR", input } };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(0);
});

it("Stop during activation hides late completion and reopening reconciles the same event", async () => {
  let finish!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  let activated = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: activated ? [] : [active],
        event: activated
          ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
          : { kind: "none" },
      };
    if (body.command.kind === "activate") {
      activated = true;
      return held;
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")?.textContent).toContain(
    "Switch identity",
  );
  await click(screen, "stop");
  finish({ kind: "committed", result: { ...committed, activationEventId: calls[0]!.eventId } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")).not.toBeNull(),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
});

it("reconciles a lost activation reply using the exact event and conflict without resending activation", async () => {
  let activated = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: activated ? [] : [active],
        event: activated
          ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
          : { kind: "none" },
      };
    if (body.command.kind === "activate") {
      activated = true;
      throw { code: "connection.failed" };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")).not.toBeNull(),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
  expect(calls.at(-1)!.command).toEqual({ kind: "status" });
  expect(calls.at(-1)!.eventId).toBe(calls.at(-2)!.eventId);
  expect(calls.at(-1)!.conflict).toEqual(calls.at(-2)!.conflict);
});

it.each(["connection.failed", "promotion.break_glass_invalid"])(
  "ignores a late %s failure after Stop and a new key inspection",
  async (code) => {
    let reject!: (error: unknown) => void;
    const held = new Promise((_resolve, refuse) => {
      reject = refuse;
    });
    let first = true;
    const { screen } = await mount(async () => {
      if (first) {
        first = false;
        return held;
      }
      return { kind: "status", active: [active], event: { kind: "none" } };
    });
    await key(screen, "old-key");
    await click(screen, "inspect");
    await click(screen, "stop");
    await key(screen, "new-key");
    await click(screen, "inspect");
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
    );
    reject({ code });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(
      screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
    ).toBe("new-key");
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull();
    expect(
      (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
        .error,
    ).toBe("");
  },
);

function refusedHttp(code: string, reason?: string) {
  return createRequest({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: { code, params: reason === undefined ? {} : { reason } } }),
        {
          status: code === "authorization.not_permitted" ? 403 : 409,
          headers: { "content-type": "application/json" },
        },
      ),
  });
}

it.each([
  { code: "authorization.not_permitted", words: "HTTPS recovery address directly" },
  { code: "node.read_only", words: "cannot write invoices" },
  {
    code: "sif.allocation_invalid",
    reason: "old_machine_active",
    words: "Confirm both isolation answers",
  },
  {
    code: "sif.allocation_invalid",
    reason: "parallel_recovery",
    words: "Confirm both isolation answers",
  },
])("explains an actionable recovery refusal: $code/$reason", async ({ code, reason, words }) => {
  const request = refusedHttp(code, reason);
  const { screen } = await mount((body) =>
    reason !== undefined && body.command.kind === "status"
      ? Promise.resolve({ kind: "status", active: [active], event: { kind: "none" } })
      : request("/api/module-recovery/fiscal-verifactu/conflict", "POST", body),
  );
  await key(screen, "current-key");
  await click(screen, "inspect");
  if (reason !== undefined) {
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
    );
    await compare(screen);
  }
  await vi.waitFor(() =>
    expect(
      (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
        .error,
    ).toContain(words),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=stop]")).not.toBeNull();
});

it("reconciles an uncertain preparation before offering a new attempt", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "prepare")
      return refusedHttp("sif.allocation_invalid", "uncertain_prior_activation")(
        "/api/module-recovery/fiscal-verifactu/conflict",
        "POST",
        body,
      );
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await inspect(screen);
  const eventId = calls[0]!.eventId;
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=inspect]")).not.toBeNull(),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=again]")).toBeNull();
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=again]")).not.toBeNull(),
  );
  expect(calls.at(-1)!.eventId).toBe(eventId);
  expect(calls.at(-1)!.command).toEqual({ kind: "status" });
  expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
});

it("updates the countdown locally and keeps repeated waits five seconds apart", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  let previews = 0;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", targetMs: Date.now() + 7000, remainingMs: 7000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview") {
      previews++;
      return previews === 1
        ? {
            kind: "prepared",
            value: { status: "waiting", targetMs: Date.now() + 2000, remainingMs: 2000 },
          }
        : { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  const count = calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")?.textContent).toContain("5 seconds");
  expect(calls).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(3000);
  expect(previews).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")?.textContent).toContain("1 seconds");
  await vi.advanceTimersByTimeAsync(4000);
  await screen.updateComplete;
  expect(previews).toBe(2);
  expect(screen.shadowRoot!.querySelector("[data-wait]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  const finished = calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(calls).toHaveLength(finished);
  expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
});

it.each(["status", "clock-challenge", "compare-clocks", "select", "preview-selection"])(
  "refuses a schema-valid reply for the wrong %s command without activating",
  async (stage) => {
    const { screen, calls } = await mount(async (body) => {
      if (body.command.kind === "status")
        return stage === "status"
          ? {
              kind: "prepared",
              value: { id: "unexpected-challenge", boxInstantMs: Date.now(), expiresInMs: 5000 },
            }
          : { kind: "status", active: [active], event: { kind: "none" } };
      if (body.command.kind === "prepare" && body.command.proposal.action === stage)
        return { kind: "status", active: [active], event: { kind: "none" } };
      if (
        stage === "preview-selection" &&
        body.command.kind === "prepare" &&
        body.command.proposal.action === "select"
      )
        return { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
      return prepared(body);
    });
    if (stage === "status") {
      await key(screen, "current-key");
      await click(screen, "inspect");
    } else {
      await inspect(screen);
      await compare(screen);
    }
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("wt-form-actions")?.error).toContain(
        "The request could not be completed",
      ),
    );
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
    expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
    expect(screen.shadowRoot!.querySelector("[data-action=stop]")).not.toBeNull();
  },
);

it("refuses a committed result for another event without clearing the current key", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [],
    event: { kind: "committed", result: { ...committed, activationEventId: "another-event" } },
  }));
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")?.error).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
  expect(
    screen.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!.value,
  ).toBe("current-key");
  expect(calls).toHaveLength(1);
});
