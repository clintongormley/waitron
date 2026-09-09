import { afterEach, expect, it, vi } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillEnrolScreen } from "./till-enrol-screen.js";
import type { TillApi } from "../api/client.js";

/**
 * A fake `TillApi` exposing only the verbs the join screen calls (`join`, `joinStatus`) plus
 * `getLocales` (the language chooser's lazy source). Each defaults to a benign value a test overrides.
 * Cast through `unknown` because the screen touches only these verbs, never the rest of the class
 * surface (the screen-test pattern).
 */
type JoinVerbs = "join" | "joinStatus" | "getLocales";
function stubApi(overrides: Partial<Record<JoinVerbs, unknown>> = {}): TillApi {
  return {
    join: vi.fn().mockResolvedValue({ joinId: "jr-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
}

/** Lets a pending API promise settle and the element re-render (a `setTimeout(0)` macrotask drains the
 * microtask queue first). */
async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The fake-timer twin of {@link flush} — the poll runs on `setInterval`, so its tests drive the clock. */
async function flushFake(el: TillEnrolScreen): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
}

function query(el: TillEnrolScreen, selector: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(selector);
}

/** Sets the name field's live `.value` AND fires the `wt-change` the render binds. */
function typeName(el: TillEnrolScreen, value: string): void {
  const input = query(el, "[data-name]") as HTMLElement & { value: string };
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Names the device and knocks, settling the join. */
async function knock(el: TillEnrolScreen, name = "Front counter"): Promise<void> {
  typeName(el, name);
  await el.updateComplete;
  query(el, "[data-submit]")!.click();
  await flush(el);
}

afterEach(cleanupWidgets);

it("registers as a custom element", () => {
  expect(customElements.get("till-enrol-screen")).toBe(TillEnrolScreen);
});

it("asks only for a name — no key field, no profile picker, no binding picker", async () => {
  // The profile and the binding are chosen in the dashboard's accept dialog, so an unapproved device
  // reads no catalogue: there is nothing here for it to learn about the venue.
  const getLocales = vi.fn().mockResolvedValue({ locales: [] });
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ getLocales }),
  });
  await flush(el);
  expect(query(el, "[data-name]")).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("select")).toBeNull();
  expect(query(el, "[data-number]")).toBeNull();
  // Submit is dead until a name is typed, so an empty knock never reaches the server.
  expect(query(el, "[data-submit]")!.hasAttribute("disabled")).toBe(true);
});

it("posts only the name and shows the two-digit number, announced, with 'waiting for approval'", async () => {
  const join = vi.fn().mockResolvedValue({ joinId: "jr-9", verificationNumber: "47" });
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join }),
  });
  await flush(el);
  await knock(el, "Front counter");
  expect(join).toHaveBeenCalledWith("Front counter");
  expect(join).toHaveBeenCalledTimes(1);
  // The name field is gone; the number is up.
  expect(query(el, "[data-name]")).toBeNull();
  const number = query(el, "[data-number]")!;
  expect(number.textContent!.trim()).toBe("47");
  // ANNOUNCED, not merely styled large: a live region plus a label that reads the digits out.
  expect(number.getAttribute("role")).toBe("status");
  expect(number.getAttribute("aria-label")).toBe(
    t("device.join_number_label").replace("{number}", "47"),
  );
  expect(el.shadowRoot!.textContent).toContain(t("device.join_waiting_title"));
});

it("submits on Enter from the name field itself", async () => {
  // `submitOnEnter` reads the input off `composedPath()`, which is empty on an undispatched event — so
  // this drives a real keydown from the native input inside `wt-input`.
  const join = vi.fn().mockResolvedValue({ joinId: "jr-1", verificationNumber: "12" });
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join }),
  });
  await flush(el);
  typeName(el, "Pass");
  await el.updateComplete;
  const input = query(el, "[data-name]")!;
  await (input as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const native = input.shadowRoot!.querySelector("input")!;
  native.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await flush(el);
  expect(join).toHaveBeenCalledWith("Pass");
  expect(query(el, "[data-number]")).not.toBeNull();
});

it("polls the status route and emits `enrolled` carrying the joinId as the deviceId when approved", async () => {
  vi.useFakeTimers();
  try {
    const joinStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValue({ status: "approved" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({
        join: vi.fn().mockResolvedValue({ joinId: "jr-77", verificationNumber: "31" }),
        joinStatus,
      }),
    });
    await flushFake(el);
    const enrolled = vi.fn();
    el.addEventListener("enrolled", (e) => enrolled((e as CustomEvent).detail));
    typeName(el, "Front counter");
    await flushFake(el);
    query(el, "[data-submit]")!.click();
    await flushFake(el);
    // Nothing has been asked yet: the first poll is one interval away, not immediate.
    expect(joinStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(joinStatus).toHaveBeenCalledTimes(1);
    expect(enrolled).not.toHaveBeenCalled(); // still pending
    await vi.advanceTimersByTimeAsync(2_000);
    await el.updateComplete;
    // The detail carries the join request's id, which accept carries onto the devices row — and NOT the
    // name or form factor, which this device is never told.
    expect(enrolled).toHaveBeenCalledWith({ deviceId: "jr-77" });
    // Approval stops the poll: no further asking against a screen the parent is about to replace.
    const calls = joinStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(joinStatus.mock.calls.length).toBe(calls);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps waiting through a transient status failure — the admin has not answered either way", async () => {
  vi.useFakeTimers();
  try {
    const joinStatus = vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue({ status: "pending" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ joinStatus }),
    });
    await flushFake(el);
    typeName(el, "Front counter");
    await flushFake(el);
    query(el, "[data-submit]")!.click();
    await flushFake(el);
    await vi.advanceTimersByTimeAsync(2_000);
    await el.updateComplete;
    // Still on the number, still polling — a network blip is not a refusal.
    expect(query(el, "[data-number]")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(joinStatus).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("shows 'not approved' with a Try again that knocks afresh", async () => {
  vi.useFakeTimers();
  try {
    const join = vi
      .fn()
      .mockResolvedValueOnce({ joinId: "jr-1", verificationNumber: "12" })
      .mockResolvedValue({ joinId: "jr-2", verificationNumber: "89" });
    const joinStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: "not_approved" })
      .mockResolvedValue({ status: "pending" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ join, joinStatus }),
    });
    await flushFake(el);
    typeName(el, "Front counter");
    await flushFake(el);
    query(el, "[data-submit]")!.click();
    await flushFake(el);
    await vi.advanceTimersByTimeAsync(2_000);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("device.join_refused_title"));
    expect(query(el, "[data-number]")).toBeNull();
    // The refusal stops the poll — the answer is final until the operator knocks again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(joinStatus).toHaveBeenCalledTimes(1);
    // Try again knocks afresh with the retained name and gets a NEW number.
    query(el, "[data-retry]")!.click();
    await flushFake(el);
    expect(join).toHaveBeenCalledTimes(2);
    expect(join).toHaveBeenLastCalledWith("Front counter");
    expect(query(el, "[data-number]")!.textContent!.trim()).toBe("89");
  } finally {
    vi.useRealTimers();
  }
});

it("tells the operator to ask for pairing mode when the server says pairing_closed", async () => {
  // The one refusal with a real next step, so it must not fold into the generic sentence.
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join: vi.fn().mockRejectedValue({ code: "device.pairing_closed" }) }),
  });
  await flush(el);
  await knock(el);
  const banner = query(el, "[data-error]")!;
  expect(banner.textContent!.trim()).toBe(codeMessage("device.pairing_closed"));
  // And it is a DIFFERENT sentence from the generic one, naming the dashboard toggle — the point of the
  // branch. Without this, the assertion above passes by degrading with the resolver's table.
  expect(banner.textContent!.trim()).not.toBe(codeMessage("server.internal"));
  expect(banner.textContent).toContain("Allow new devices");
  expect(banner.getAttribute("role")).toBe("alert");
  // Still on the name form, with the name retained, so Ask to join is one tap once pairing is on.
  expect(query(el, "[data-name]")).not.toBeNull();
  expect(query(el, "[data-submit]")!.hasAttribute("disabled")).toBe(false);
});

it("folds every other refusal into the generic sentence and clears it on a retype", async () => {
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join: vi.fn().mockRejectedValue({ code: "device.join_rate_limited" }) }),
  });
  await flush(el);
  await knock(el);
  expect(query(el, "[data-error]")!.textContent!.trim()).toBe(codeMessage("server.internal"));
  typeName(el, "Front counter 2");
  await el.updateComplete;
  expect(query(el, "[data-error]")).toBeNull();
});

it("falls back to the generic sentence for a rejection carrying no code at all", async () => {
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join: vi.fn().mockRejectedValue(new Error("offline")) }),
  });
  await flush(el);
  await knock(el);
  expect(query(el, "[data-error]")!.textContent!.trim()).toBe(codeMessage("server.internal"));
});

it("ignores a second tap while a knock is in flight", async () => {
  let settle!: (value: unknown) => void;
  const join = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join }),
  });
  await flush(el);
  typeName(el, "Front counter");
  await el.updateComplete;
  query(el, "[data-submit]")!.click();
  await el.updateComplete;
  query(el, "[data-submit]")!.click();
  settle({ joinId: "jr-1", verificationNumber: "47" });
  await flush(el);
  expect(join).toHaveBeenCalledTimes(1);
});

it("stops polling when disconnected — a torn-down screen leaves no timer running", async () => {
  vi.useFakeTimers();
  try {
    const joinStatus = vi.fn().mockResolvedValue({ status: "pending" });
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ joinStatus }),
    });
    await flushFake(el);
    typeName(el, "Front counter");
    await flushFake(el);
    query(el, "[data-submit]")!.click();
    await flushFake(el);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(joinStatus).toHaveBeenCalledTimes(1);
    el.remove();
    await vi.advanceTimersByTimeAsync(20_000);
    // Ten intervals have passed against a dead component: the poll was cleared on teardown.
    expect(joinStatus).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("drops a join that resolves after teardown rather than repainting a dead screen", async () => {
  let settle!: (value: unknown) => void;
  const join = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  const joinStatus = vi.fn().mockResolvedValue({ status: "pending" });
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join, joinStatus }),
  });
  await flush(el);
  typeName(el, "Front counter");
  await el.updateComplete;
  query(el, "[data-submit]")!.click();
  el.remove();
  settle({ joinId: "jr-1", verificationNumber: "47" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // No number was adopted and no poll was started, so nothing is left ticking.
  expect(query(el, "[data-number]")).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(joinStatus).not.toHaveBeenCalled();
});

it("drops a refusal that lands after teardown", async () => {
  let reject!: (reason: unknown) => void;
  const join = vi.fn().mockReturnValue(
    new Promise((_resolve, r) => {
      reject = r;
    }),
  );
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
    api: stubApi({ join }),
  });
  await flush(el);
  typeName(el, "Front counter");
  await el.updateComplete;
  query(el, "[data-submit]")!.click();
  el.remove();
  reject({ code: "device.pairing_closed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(query(el, "[data-error]")).toBeNull();
});

it("does not emit `enrolled` for an approval that lands after teardown", async () => {
  vi.useFakeTimers();
  try {
    let settle!: (value: unknown) => void;
    const joinStatus = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", {
      api: stubApi({ joinStatus }),
    });
    await flushFake(el);
    const enrolled = vi.fn();
    el.addEventListener("enrolled", enrolled);
    typeName(el, "Front counter");
    await flushFake(el);
    query(el, "[data-submit]")!.click();
    await flushFake(el);
    await vi.advanceTimersByTimeAsync(2_000);
    el.remove();
    settle({ status: "approved" });
    await vi.advanceTimersByTimeAsync(0);
    expect(enrolled).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("renders its own language chooser, so a fresh device can be set up in Spanish", async () => {
  const { el } = await mountWidget<TillEnrolScreen>("till-enrol-screen", { api: stubApi() });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
});
