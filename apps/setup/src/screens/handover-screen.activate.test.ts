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
    refuse?: boolean | { code: string; params: Record<string, unknown> };
  } = {},
) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let state = status.state;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method === "GET") return new Response(JSON.stringify({ body: { ...status, state } }));
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    requests.push({ path: String(path), body });
    if (String(path).endsWith("/activate")) {
      if (options.refuse)
        return new Response(
          JSON.stringify({
            error:
              typeof options.refuse === "object"
                ? options.refuse
                : { code: "password.invalid", params: {} },
          }),
          {
            status: 401,
          },
        );
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
          ? { id: "comparison", clock }
          : action === "preview"
            ? { status: "preview" }
            : { status: "selected", identity: "0CSQW", binding, input: { chosen: "minute" } };
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
  return { el, requests, fetcher, release };
}
async function select(el: SetupHandoverScreen) {
  const clockEntry = q<LitElement>(el, "vf-recovery-hour");
  await clockEntry.updateComplete;
  q(clockEntry, "[data-test=compare]").click();
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(clockEntry, "[data-test=select]").disabled).toBe(
      false,
    ),
  );
  q(clockEntry, "[data-test=select]").click();
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=activate]").disabled).toBe(false),
  );
}
it("sends the same administrator and selected minute to activation and clears secrets on success", async () => {
  const { el, requests } = await mount();
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=activate]").disabled).toBe(true);
  await select(el);
  q(el, "[data-test=activate]").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
  );
  expect(requests.at(-1)).toEqual({
    path: "/api/node/handover/move/activate",
    body: {
      signIn: { email: "owner@example.com", password: "correct horse", totp: "123456" },
      moduleOperation: { binding, input: { chosen: "minute" } },
    },
  });
  expect(q(el, '[name="handover-password"]')).toBeNull();
});
it("clears a selection when the administrator changes", async () => {
  const { el, requests } = await mount();
  await select(el);
  await edit(el, "handover-email", "other@example.com");
  expect(q(el, "vf-recovery-hour")).toBeNull();
  expect(q<HTMLElement & { value: string }>(el, '[name="handover-password"]').value).toBe("");
  expect(requests.some((row) => row.path.endsWith("/activate"))).toBe(false);
});
it("recovers an activation whose answer was lost by reading status", async () => {
  const { el } = await mount({ loseAnswer: true });
  await select(el);
  q(el, "[data-test=activate]").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("This box has taken over the venue"),
  );
});
it("a refused activation clears the minute and requires an explicit new clock check", async () => {
  const { el, requests } = await mount({ refuse: true });
  await select(el);
  q(el, "[data-test=activate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).toBeNull());
  expect(q<HTMLElement & { error: string }>(el, "wt-form-actions").error).toContain(
    "Check your password and code",
  );
  expect(requests.filter((row) => row.path.endsWith("/activate"))).toHaveLength(1);
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=authenticate]").disabled).toBe(
    false,
  );
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
    q(el, "[data-test=activate]").click();
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
  q(el, "[data-test=activate]").click();
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
