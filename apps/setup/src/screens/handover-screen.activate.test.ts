import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupHandoverScreen } from "./handover-screen.js";
import { setLocale } from "../i18n/t.js";

const binding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: "move",
  sourceId: "old",
  targetNodeId: "new",
};
const status = {
  operationId: "move",
  role: "destination",
  scenario: "controlled",
  state: "filing_assumed",
  sourceNodeId: "old",
  destinationNodeId: "new",
  waitingReason: null,
  copyPlaced: true,
};
const input = {
  allocation: {
    installationIdentity: "0CSQW",
    series: [
      { code: "A-0CSQW", purpose: "standard" },
      { code: "FF-0CSQW", purpose: "full" },
      { code: "R-0CSQW", purpose: "rectificative" },
    ],
  },
};
const clock = {
  usable: ["box", "internet", "browser"].map((source) => ({
    source,
    lowerMs: Date.now(),
    upperMs: Date.now(),
  })),
  unavailable: [],
  secondClock: true,
  disagreement: false,
  releaseBlocked: false,
  rangeBlocked: false,
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
const q = <T extends HTMLElement>(el: HTMLElement, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
async function edit(el: HTMLElement, name: string, value: string) {
  const field = q<LitElement>(el, `[name="${name}"]`);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await (el as LitElement).updateComplete;
}
async function mount(
  options: {
    loseAnswer?: boolean;
    waitForStatus?: boolean;
    holdActivation?: boolean;
    restartOutage?: boolean;
    refuse?: { code: string; params: Record<string, unknown> };
    secondClockLater?: boolean;
  } = {},
) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let state = status.state;
  let secondClock = !options.secondClockLater;
  // Where the box stops accepting the first code: an authenticator code lasts under a minute.
  let expiredAt: "preparation" | "activate" | undefined;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === "GET") {
      if (options.restartOutage && state === "activated") throw new TypeError("box restarting");
      return new Response(JSON.stringify({ body: { ...status, state } }));
    }
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    requests.push({ path: String(path), body });
    if (
      expiredAt !== undefined &&
      String(path).endsWith(expiredAt) &&
      (body.signIn as { totp?: string }).totp === "123456"
    )
      return new Response(JSON.stringify({ error: { code: "password.invalid", params: {} } }), {
        status: 401,
      });
    if (String(path).endsWith("/activate")) {
      if (options.refuse)
        return new Response(JSON.stringify({ error: options.refuse }), {
          status: 401,
        });
      if (options.holdActivation) await pending;
      state = "activated";
      if (options.waitForStatus) await pending;
      if (options.loseAnswer) throw new TypeError("network lost");
      return new Response(JSON.stringify({ activated: true, restarting: true }));
    }
    const action = (body.proposal as { action: string }).action;
    const result =
      action === "clock-challenge"
        ? { id: "challenge" }
        : action === "compare-clocks"
          ? { id: "comparison", clock: { ...clock, secondClock } }
          : { status: "selected", identity: "0CSQW", binding, input };
    return new Response(JSON.stringify(result));
  });
  const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api: new SetupApi("", fetcher),
    operationId: "move",
  });
  await vi.waitFor(() => expect(q(el, '[name="handover-password"]')).not.toBeNull());
  await edit(el, "handover-email", "owner@example.com");
  await edit(el, "handover-password", "correct horse");
  await edit(el, "handover-code", "123456");
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  return {
    el,
    requests,
    fetcher,
    release,
    showState: (value: string) => {
      state = value;
    },
    expireCode: (at: "preparation" | "activate") => {
      expiredAt = at;
    },
    secondClockArrives: () => {
      secondClock = true;
    },
  };
}
async function select(el: SetupHandoverScreen) {
  const clockEntry = q<LitElement>(el, "vf-recovery-hour");
  await clockEntry.updateComplete;
  const tick = q<HTMLInputElement>(clockEntry, '[name="recovery-details-confirmed"]');
  tick.checked = true;
  tick.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(clockEntry, "[data-test=compare]").disabled).toBe(
      false,
    ),
  );
  expect(q(clockEntry, "[data-test=compare]").textContent!.trim()).toBe("Proceed");
  q(clockEntry, "[data-test=compare]").click();
}
const activations = (requests: { path: string }[]) =>
  requests.filter((row) => row.path.endsWith("/activate"));
it("sends the same administrator and selected minute to activation and clears secrets on success", async () => {
  const { el, requests } = await mount();
  expect(q(el, "wt-form-actions wt-button")).toBeNull();
  await select(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
  );
  expect(requests.at(-1)).toEqual({
    path: "/api/node/handover/move/activate",
    body: {
      signIn: { email: "owner@example.com", password: "correct horse", totp: "123456" },
      moduleOperation: { binding, input },
    },
  });
  expect(q(el, '[name="handover-password"]')).toBeNull();
  expect(Reflect.get(el, "password")).toBe("");
  expect(Reflect.get(el, "code")).toBe("");
});

it("keeps the successful restart visible while every progress read fails", async () => {
  const { el, fetcher } = await mount({ restartOutage: true });
  await select(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(
      "The venue has started here; this box is restarting",
    ),
  );
  expect(Reflect.get(el, "password")).toBe("");
  expect(Reflect.get(el, "code")).toBe("");
  await vi.waitFor(
    () =>
      expect(
        fetcher.mock.calls.filter(([, init]) => init?.method === "GET").length,
      ).toBeGreaterThanOrEqual(3),
    { timeout: 4000 },
  );
  await el.updateComplete;
  expect(q(el, "[data-test=authenticate]")).toBeNull();
  expect(q(el, "wt-form-actions")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Could not read handover progress");
}, 10_000);

it.each(["password", "code"] as const)(
  "keeps the clock entry when the %s changes, and every later request sends the new value",
  async (field) => {
    const { el, requests } = await mount();
    const clockEntry = q(el, "vf-recovery-hour");
    const value = field === "password" ? "changed password" : "654321";
    await edit(el, "handover-" + field, value);
    expect(q(el, "vf-recovery-hour")).toBe(clockEntry);
    expect(requests).toHaveLength(0);
    await select(el);
    await vi.waitFor(() => expect(activations(requests)).toHaveLength(1));
    const key = field === "password" ? "password" : "totp";
    expect(requests.map((row) => (row.body.signIn as Record<string, string>)[key])).toEqual(
      requests.map(() => value),
    );
  },
);

it("clears the stored secrets and selected clock on leaving", async () => {
  const { el, requests } = await mount({ holdActivation: true });
  await select(el);
  await vi.waitFor(() => expect(activations(requests)).toHaveLength(1));
  const selected = Reflect.get(el, "entry") as { readOperation(): unknown };
  expect(selected.readOperation()).not.toBeNull();
  const host = el.parentElement!;
  el.remove();
  expect(Reflect.get(el, "password")).toBe("");
  expect(Reflect.get(el, "code")).toBe("");
  expect(selected.readOperation()).toBeNull();
  host.append(el);
  await vi.waitFor(() => expect(q(el, "[data-test=authenticate]")).not.toBeNull());
  expect(q(el, "vf-recovery-hour")).toBeNull();
});

it.each(["activated", "abandoned"])(
  "clears stored secrets and the clock when progress becomes %s",
  async (state) => {
    const { el, requests, showState } = await mount({ holdActivation: true });
    await select(el);
    await vi.waitFor(() => expect(activations(requests)).toHaveLength(1));
    const selected = Reflect.get(el, "entry") as { readOperation(): unknown };
    expect(selected.readOperation()).not.toBeNull();
    showState(state);
    await vi.waitFor(() => expect(Reflect.get(el, "password")).toBe(""), { timeout: 4000 });
    expect(Reflect.get(el, "code")).toBe("");
    expect(selected.readOperation()).toBeNull();
  },
  10_000,
);
it("removes the clock entry and the secrets when the administrator's email changes", async () => {
  const { el, requests } = await mount();
  await edit(el, "handover-email", "other@example.com");
  expect(q(el, "vf-recovery-hour")).toBeNull();
  expect(q<HTMLElement & { value: string }>(el, '[name="handover-password"]').value).toBe("");
  expect(q<HTMLElement & { value: string }>(el, '[name="handover-code"]').value).toBe("");
  expect(requests.some((row) => row.path.endsWith("/activate"))).toBe(false);
});
it("starts the venue once, showing that it is starting, when the series report ready again", async () => {
  const { el, requests, release } = await mount({ holdActivation: true });
  await select(el);
  await vi.waitFor(() => expect(activations(requests)).toHaveLength(1));
  expect(q(el, '[role="status"]').textContent).toBe("Starting the venue on this box…");
  for (const name of ["handover-email", "handover-password", "handover-code"])
    expect(q<HTMLElement & { disabled: boolean }>(el, `[name="${name}"]`).disabled).toBe(true);
  expect(q(el, "wt-form-actions wt-button")).toBeNull();
  q(el, "vf-recovery-hour").dispatchEvent(
    new CustomEvent("promotion-change", { bubbles: true, composed: true }),
  );
  release();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).toBeNull());
  expect(activations(requests)).toHaveLength(1);
});
it("recovers an activation whose answer was lost by reading status", async () => {
  const { el } = await mount({ loseAnswer: true });
  await select(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
  );
});
const sentCodes = (requests: { body: Record<string, unknown> }[]) =>
  requests.map((row) => (row.body.signIn as { totp?: string }).totp);
it("asks for a fresh code when one runs out during the automatic clock check, and carries on with it", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { el, requests, expireCode, secondClockArrives } = await mount({
      secondClockLater: true,
    });
    await select(el);
    const clockEntry = q<LitElement>(el, "vf-recovery-hour");
    await vi.waitFor(() => expect(q(clockEntry, "[data-test=clock-wait]")).not.toBeNull());
    expireCode("preparation");
    secondClockArrives();
    const before = requests.length;
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() =>
      expect(q<HTMLElement & { error: string }>(clockEntry, "wt-form-actions").error).toContain(
        "Use a fresh authenticator code",
      ),
    );
    expect(requests.length).toBeGreaterThan(before);
    expect(activations(requests)).toHaveLength(0);
    await edit(el, "handover-code", "654321");
    expect(q(el, "vf-recovery-hour")).toBe(clockEntry);
    q(clockEntry, "[data-test=compare]").click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
    );
    const retried = requests.slice(before + 1);
    expect(new Set(sentCodes(retried))).toEqual(new Set(["654321"]));
    expect(activations(requests)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("asks for a fresh code when one runs out just before the venue starts, keeping the chosen minute", async () => {
  const { el, requests, expireCode } = await mount();
  expireCode("activate");
  await select(el);
  await vi.waitFor(() =>
    expect(q<HTMLElement & { error: string }>(el, "wt-form-actions").error).toContain(
      "Use a fresh authenticator code",
    ),
  );
  expect(activations(requests)).toHaveLength(1);
  const clockEntry = q(el, "vf-recovery-hour");
  expect(clockEntry).not.toBeNull();
  clockEntry.dispatchEvent(new CustomEvent("promotion-change", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(activations(requests)).toHaveLength(1);
  await edit(el, "handover-code", "654321");
  expect(q(el, "vf-recovery-hour")).toBe(clockEntry);
  q(el, "[data-test=retry-activation]").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
  );
  expect(activations(requests)).toHaveLength(2);
  expect(requests.at(-1)!.body).toEqual({
    signIn: { email: "owner@example.com", password: "correct horse", totp: "654321" },
    moduleOperation: { binding, input },
  });
});

it("Try again refuses an emptied password the way the clock-check button does, and sends once it is filled", async () => {
  const { el, requests, expireCode } = await mount();
  expireCode("activate");
  await select(el);
  await vi.waitFor(() => expect(q(el, "[data-test=retry-activation]")).not.toBeNull());
  expect(activations(requests)).toHaveLength(1);
  await edit(el, "handover-password", "");
  const retry = q<HTMLElement & { disabled: boolean }>(el, "[data-test=retry-activation]");
  expect(retry.disabled).toBe(true);
  expect(q<HTMLElement & { error: string }>(el, '[name="handover-password"]').error).toBe(
    "Complete this field.",
  );
  expect(q<HTMLElement & { error: string }>(el, "wt-form-actions").error).toBe(
    "Complete the highlighted fields to continue.",
  );
  retry.click();
  await vi.waitFor(() =>
    expect(
      q(el, '[name="handover-password"]').shadowRoot!.querySelector("input")!.matches(":focus"),
    ).toBe(true),
  );
  expect(activations(requests)).toHaveLength(1);
  await edit(el, "handover-password", "correct horse");
  await edit(el, "handover-code", "654321");
  expect(retry.disabled).toBe(false);
  retry.click();
  await vi.waitFor(() => expect(activations(requests)).toHaveLength(2));
  expect(requests.at(-1)!.body.signIn).toEqual({
    email: "owner@example.com",
    password: "correct horse",
    totp: "654321",
  });
});

it("focuses the first missing field after an empty clock-check submission", async () => {
  const api = new SetupApi(
    "",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ body: status }))),
  );
  const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api,
    operationId: "move",
  });
  await vi.waitFor(() => expect(q(el, '[name="handover-password"]')).not.toBeNull());
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() =>
    expect(
      q(el, '[name="handover-email"]').shadowRoot!.querySelector("input")!.matches(":focus"),
    ).toBe(true),
  );
});

it.each([
  [{ code: "password.throttled", params: {} }, "Wait before trying your password again"],
  [
    { code: "authorization.not_permitted", params: {} },
    "Use an administrator account allowed to hand over",
  ],
  [
    { code: "sif.allocation_invalid", params: { reason: "clock_stale" } },
    "The clock check is too old",
  ],
] as const)(
  "explains an activation refusal and returns to clock comparison: %s",
  async (refuse, message) => {
    const { el } = await mount({ refuse });
    await select(el);
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).toBeNull());
    expect(q<HTMLElement & { error: string }>(el, "wt-form-actions").error).toContain(message);
    expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=authenticate]").disabled).toBe(
      false,
    );
  },
);

it("keeps the completed status when a lost activation answer settles after polling clears its clock entry", async () => {
  const { el, release } = await mount({ loseAnswer: true, waitForStatus: true });
  await select(el);
  await vi.waitFor(
    () => expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
    { timeout: 4000 },
  );
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(q(el, "vf-recovery-hour")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue");
});

it.each([false, true])(
  "resumes a restored controlled page and shows its activation outcome, refused %s",
  async (refuse) => {
    const { el } = await mount({
      refuse: refuse ? { code: "password.invalid", params: {} } : undefined,
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await el.updateComplete;
    await edit(el, "handover-password", "correct horse");
    await edit(el, "handover-code", "123456");
    q(el, "[data-test=authenticate]").click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    await select(el);
    if (refuse) {
      await vi.waitFor(() =>
        expect(q<HTMLElement & { error: string }>(el, "wt-form-actions").error).not.toBe(""),
      );
    } else {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
      );
      expect(Reflect.get(el, "password")).toBe("");
      expect(Reflect.get(el, "code")).toBe("");
    }
  },
);

it("Change these details goes back to the sign-in step and sends nothing", async () => {
  const { el, requests } = await mount();
  const clockEntry = q<LitElement>(el, "vf-recovery-hour");
  await clockEntry.updateComplete;
  const sent = requests.length;
  q(clockEntry, "[data-test=change-details]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).toBeNull());
  expect(q(el, "[data-test=authenticate]")).not.toBeNull();
  expect(q<HTMLElement & { value: string }>(el, '[name="handover-email"]').value).toBe(
    "owner@example.com",
  );
  expect(requests).toHaveLength(sent);
});
