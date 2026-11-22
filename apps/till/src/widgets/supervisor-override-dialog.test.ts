import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, textFieldsIn } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import {
  TillSupervisorOverrideDialog,
  approverRefusal,
  type OverrideConfirmDetail,
} from "./supervisor-override-dialog.js";
import type { StaffMember } from "../api/client.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const authorizers: StaffMember[] = [
  { personId: "sup-1", displayName: "Responsable" },
  { personId: "adm-1", displayName: "Administradora" },
];

async function mount(props: Partial<TillSupervisorOverrideDialog> = {}) {
  setLocale("en-GB");
  return mountWidget<TillSupervisorOverrideDialog>("till-supervisor-override-dialog", {
    authorizers,
    ...props,
  });
}

const root = (el: TillSupervisorOverrideDialog) => el.shadowRoot!;
async function shownError(el: TillSupervisorOverrideDialog) {
  await root(el).querySelector("wt-form-actions")?.updateComplete;
  const dialog = root(el).querySelector("wt-dialog")!;
  await dialog.updateComplete;
  return dialog.shadowRoot!.querySelector('[role="alert"]');
}
const pad = (el: TillSupervisorOverrideDialog) =>
  root(el).querySelector<HTMLElement & { value: string }>("till-numeric-pad");

async function pick(el: TillSupervisorOverrideDialog, personId: string): Promise<void> {
  root(el).querySelector<HTMLElement>(`[data-person="${personId}"]`)!.click();
  await el.updateComplete;
}

async function typePin(el: TillSupervisorOverrideDialog, digits: string): Promise<void> {
  for (const digit of digits) {
    pad(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!.click();
    await el.updateComplete;
  }
}

describe("till-supervisor-override-dialog", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-supervisor-override-dialog")).toBe(
      TillSupervisorOverrideDialog,
    );
  });

  it("renders one picker button per authorizer, no PIN pad until one is chosen", async () => {
    const { el } = await mount();
    expect(root(el).querySelector('[data-person="sup-1"]')).not.toBeNull();
    expect(root(el).querySelector('[data-person="adm-1"]')).not.toBeNull();
    expect(pad(el)).toBeNull();
  });

  it("shows the no-supervisors state for an empty authorizer list", async () => {
    const { el } = await mount({ authorizers: [] });
    expect(root(el).textContent).toContain(t("override.no_supervisors"));
    expect(root(el).querySelector("[data-person]")).toBeNull();
  });

  it("choosing a supervisor enters PIN mode for that person", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    expect(root(el).textContent).toContain("Responsable");
    expect(pad(el)).not.toBeNull();
    expect(pad(el)!.shadowRoot!.querySelector('[data-key="."]')).toBeNull();
  });

  it("emits override-confirm carrying the picked personId + entered PIN, then wipes the PIN", async () => {
    const { el } = await mount();
    const confirmed = vi.fn();
    el.addEventListener("override-confirm", (e) =>
      confirmed((e as CustomEvent<OverrideConfirmDetail>).detail),
    );

    await pick(el, "sup-1");
    await typePin(el, "4321");
    root(el).querySelector<HTMLElement>(".authorize")!.click();
    await el.updateComplete;

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith({ personId: "sup-1", pin: "4321" });
    expect(pad(el)!.value).toBe("");
  });

  it("does not confirm on an empty PIN (the Authorize control is guarded)", async () => {
    const { el } = await mount();
    const confirmed = vi.fn();
    el.addEventListener("override-confirm", confirmed);

    await pick(el, "sup-1");
    root(el).querySelector<HTMLElement>(".authorize")!.click();
    await el.updateComplete;
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("Back returns from PIN mode to the picker, discarding the half-entered PIN", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    await typePin(el, "12");
    expect(pad(el)).not.toBeNull();

    root(el).querySelector<HTMLElement>(".back")!.click();
    await el.updateComplete;
    expect(pad(el)).toBeNull();
    expect(root(el).querySelector('[data-person="sup-1"]')).not.toBeNull();

    await pick(el, "sup-1");
    expect(pad(el)!.value).toBe("");
  });

  it("emits override-cancel from the Cancel control", async () => {
    const { el } = await mount();
    const cancelled = vi.fn();
    el.addEventListener("override-cancel", cancelled);
    root(el).querySelector<HTMLElement>(".cancel")!.click();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("emits override-cancel when the modal is dismissed (wt-close)", async () => {
    const { el } = await mount();
    const cancelled = vi.fn();
    el.addEventListener("override-cancel", cancelled);
    root(el)
      .querySelector("wt-dialog")!
      .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("shows the pin.invalid retry copy when the parent passes that error after a failed attempt", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = { code: "pin.invalid", personId: "sup-1" };
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(t("pin.invalid"));
  });

  it("shows the wait-then-retry copy when the parent passes pin.throttled", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = { code: "pin.throttled", personId: "sup-1" };
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent).toContain(t("pin.throttled"));
    expect(alert!.textContent).not.toContain(t("override.error"));
  });

  it("dismisses a shown error as soon as the operator starts retyping", async () => {
    const { el } = await mount({ error: { code: "pin.invalid", personId: "sup-1" } });
    await pick(el, "sup-1");
    // Selecting dismissed the error; a fresh one re-arms it.
    el.error = null;
    await el.updateComplete;
    el.error = { code: "pin.invalid", personId: "sup-1" };
    await el.updateComplete;
    expect(await shownError(el)).not.toBeNull();

    await typePin(el, "1");
    expect(await shownError(el)).toBeNull();
  });

  it("maps any other code to the generic override.error copy, never the raw code", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = { code: "server.internal", personId: "sup-1" };
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent).toContain(t("override.error"));
    expect(alert!.textContent).not.toContain("server.internal");
  });

  it("says the approver may not do it when the parent passes authorization.not_permitted", async () => {
    const { el } = await mount();
    await pick(el, "sup-1");
    el.error = { code: "authorization.not_permitted", personId: "sup-1" };
    await el.updateComplete;
    const alert = await shownError(el);
    expect(alert!.textContent!.trim()).toBe(codeMessage("authorization.not_permitted"));
  });
});

describe("till-supervisor-override-dialog: approval prompts", () => {
  it.each(["en", "es-ES"])("asks for approval without a role throughout (%s)", async (locale) => {
    setLocale(locale);
    const { el } = await mountWidget<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog",
      { authorizers },
    );
    const dialog = root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!;
    expect(dialog.heading).toBe(t("override.title"));
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.pick_supervisor"),
    );
    await pick(el, "sup-1");
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(t("override.enter_pin"));

    el.authorizers = [];
    await pick(el, "sup-1").catch(() => undefined);
    root(el).querySelector<HTMLElement>(".back")?.click();
    await el.updateComplete;
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.no_supervisors"),
    );
  });

  it("uses the same permission-based wording by default", async () => {
    const { el } = await mount();
    const dialog = root(el).querySelector<HTMLElement & { heading: string }>("wt-dialog")!;
    expect(dialog.heading).toBe(t("override.title"));
    expect(root(el).querySelector(".prompt")!.textContent!.trim()).toBe(
      t("override.pick_supervisor"),
    );
  });
});

it("hands a refusal to the footer row while Authorize remains usable for retry", async () => {
  const { el } = await mount();
  await pick(el, "sup-1");
  await typePin(el, "1234");
  el.error = { code: "pin.invalid", personId: "sup-1" };
  await el.updateComplete;
  const actions = root(el).querySelector<
    HTMLElement & { error: string; updateComplete: Promise<unknown> }
  >('wt-form-actions[slot="footer"]');
  expect(actions).not.toBeNull();
  await actions!.updateComplete;
  expect(actions!.error).toBe(t("pin.invalid"));
  expect(root(el).querySelector(".error")).toBeNull();
  expect(root(el).querySelector<HTMLElement & { disabled: boolean }>(".authorize")!.disabled).toBe(
    false,
  );
});

it.each([
  ["en", "Approval needed", "Choose who approves", "Enter their PIN"],
  ["es", es["override.title"], es["override.pick_supervisor"], es["override.enter_pin"]],
])(
  "asks for an approver without naming a role in %s",
  async (locale, heading, pickText, pinText) => {
    const { el } = await mount();
    setLocale(locale);
    el.requestUpdate();
    await el.updateComplete;
    const dialog = root(el).querySelector("wt-dialog")!;
    await dialog.updateComplete;
    expect(dialog.heading).toBe(heading);
    expect(root(el).textContent).toContain(pickText);
    await pick(el, "sup-1");
    expect(root(el).textContent).toContain(pinText);
    setLocale("en");
  },
);

describe("typing the supervisor's PIN with a keyboard", () => {
  async function pinFor() {
    const { el } = await mount();
    await pick(el, "sup-1");
    await root(el).querySelector("till-numeric-pad")!.updateComplete;
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    el.addEventListener("override-confirm", (e) =>
      confirmed((e as CustomEvent<OverrideConfirmDetail>).detail),
    );
    el.addEventListener("override-cancel", cancelled);
    return { el, confirmed, cancelled };
  }

  it("types the PIN and Enter authorizes with it", async () => {
    const { el, confirmed } = await pinFor();
    await userEvent.keyboard("0451");
    await el.updateComplete;
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(confirmed).toHaveBeenCalledExactlyOnceWith({ personId: "sup-1", pin: "0451" });
  });

  it("Enter with no PIN authorizes nothing", async () => {
    const { el, confirmed } = await pinFor();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("Escape still closes the window, as Cancel does", async () => {
    const { el, cancelled } = await pinFor();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    expect(root(el).querySelector("wt-dialog")!.open).toBe(false);
  });

  it("draws no text field while the PIN pad shows", async () => {
    const { el } = await pinFor();
    expect(pad(el)).not.toBeNull();
    expect(textFieldsIn(root(el))).toEqual([]);
  });
});

describe("a throttled approval PIN counts down like sign-in", () => {
  const countdown = (n: number) => t("override.throttled").replace("{n}", String(n));
  const authorize = (el: TillSupervisorOverrideDialog) =>
    root(el).querySelector<HTMLElement & { disabled: boolean }>(".authorize")!;
  const padWrap = (el: TillSupervisorOverrideDialog) =>
    root(el).querySelector<HTMLElement>(".pad-wrap")!;
  const dots = (el: TillSupervisorOverrideDialog) =>
    root(el).querySelector(".pin-display")!.textContent!.trim();
  const useClockTimers = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });

  async function throttledFor(seconds: number, pin = "") {
    const { el } = await mount();
    await pick(el, "sup-1");
    if (pin !== "") await typePin(el, pin);
    el.error = { code: "pin.throttled", retryAfterSeconds: seconds, personId: "sup-1" };
    await el.updateComplete;
    return el;
  }

  it("shows the seconds left and ticks down, letting the approver try again at zero", async () => {
    useClockTimers();
    try {
      const el = await throttledFor(3);
      expect((await shownError(el))!.textContent!.trim()).toBe(
        "Too many wrong PINs. Try again in 3s",
      );
      expect(authorize(el).disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect((await shownError(el))!.textContent!.trim()).toBe(countdown(2));
      expect(authorize(el).disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
      await el.updateComplete;
      expect(await shownError(el)).toBeNull();
      await typePin(el, "1");
      expect(authorize(el).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the wait at the server's deadline even when the page was too busy to tick", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let now = 10_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const el = await throttledFor(3, "12");
      expect((await shownError(el))!.textContent!.trim()).toBe(countdown(3));
      // The page was paused for 3.5 s; only one timer callback runs when it wakes.
      now += 3500;
      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect(await shownError(el)).toBeNull();
      expect(authorize(el).disabled).toBe(false);
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("greys the number pad and takes no keys while counting, as sign-in does", async () => {
    const el = await throttledFor(1);
    expect(padWrap(el).inert).toBe(true);
    expect(getComputedStyle(padWrap(el)).opacity).toBe("0.5");
    await userEvent.keyboard("12");
    await el.updateComplete;
    expect(dots(el)).toBe("");

    await vi.waitFor(() => expect(padWrap(el).inert).toBe(false), { timeout: 3000 });
    expect(getComputedStyle(padWrap(el)).opacity).toBe("1");
    await userEvent.keyboard("12");
    await el.updateComplete;
    expect(dots(el)).toBe("●●");
  });

  it("keeps Back and the approver list usable while counting", async () => {
    useClockTimers();
    try {
      const el = await throttledFor(30);
      expect(root(el).querySelector<HTMLElement>(".back")!.closest("[inert]")).toBeNull();
      root(el).querySelector<HTMLElement>(".back")!.click();
      await el.updateComplete;
      expect(root(el).querySelector('[data-person="adm-1"]')!.closest("[inert]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not authorize with Enter or a click while counting", async () => {
    useClockTimers();
    try {
      const el = await throttledFor(2, "1234");
      const confirmed = vi.fn();
      el.addEventListener("override-confirm", confirmed);
      authorize(el).click();
      pad(el)!.dispatchEvent(new CustomEvent("pad-enter"));
      await el.updateComplete;
      expect(confirmed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the count for a new refusal", async () => {
    useClockTimers();
    try {
      const el = await throttledFor(3);
      await vi.advanceTimersByTimeAsync(2000);
      el.error = null;
      await el.updateComplete;
      el.error = { code: "pin.throttled", retryAfterSeconds: 5, personId: "sup-1" };
      await el.updateComplete;
      expect((await shownError(el))!.textContent!.trim()).toBe(countdown(5));
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the count when the person goes Back, so another approver can try at once", async () => {
    useClockTimers();
    try {
      const el = await throttledFor(30);
      root(el).querySelector<HTMLElement>(".back")!.click();
      await el.updateComplete;
      await pick(el, "adm-1");
      expect(await shownError(el)).toBeNull();
      await typePin(el, "1");
      expect(authorize(el).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops counting when the prompt closes, and starts no count for a refusal arriving after", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const el = await throttledFor(30);
      expect(vi.getTimerCount()).toBe(1);
      root(el)
        .querySelector("wt-dialog")!
        .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
      await el.updateComplete;
      expect(vi.getTimerCount()).toBe(0);

      el.error = { code: "pin.throttled", retryAfterSeconds: 30, personId: "sup-1" };
      await el.updateComplete;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the wait-a-moment wording when the refusal carries no seconds", async () => {
    const el = await throttledFor(0);
    expect((await shownError(el))!.textContent!.trim()).toBe(t("pin.throttled"));
    expect(padWrap(el).inert).toBe(false);
    await typePin(el, "1");
    expect(authorize(el).disabled).toBe(false);
  });

  it("counts in Spanish", async () => {
    const { el } = await mount();
    setLocale("es-ES");
    await pick(el, "sup-1");
    el.error = { code: "pin.throttled", retryAfterSeconds: 4, personId: "sup-1" };
    await el.updateComplete;
    expect((await shownError(el))!.textContent!.trim()).toBe(
      es["override.throttled"].replace("{n}", "4"),
    );
  });
});

describe("a refusal belongs to the approver whose PIN was sent", () => {
  const authorize = (el: TillSupervisorOverrideDialog) =>
    root(el).querySelector<HTMLElement & { disabled: boolean }>(".authorize")!;

  /** The first approver's PIN is sent; the person goes Back and starts on another before the
   * answer comes. */
  async function secondApproverTyping() {
    const { el } = await mount();
    await pick(el, "sup-1");
    await typePin(el, "1111");
    authorize(el).click();
    await el.updateComplete;
    root(el).querySelector<HTMLElement>(".back")!.click();
    await el.updateComplete;
    await pick(el, "adm-1");
    await typePin(el, "2222");
    return el;
  }

  it("does not count the first approver's wait down under the second", async () => {
    const el = await secondApproverTyping();
    el.error = { code: "pin.throttled", retryAfterSeconds: 30, personId: "sup-1" };
    await el.updateComplete;
    expect(await shownError(el)).toBeNull();
    expect(root(el).querySelector(".pad-wrap")!.hasAttribute("inert")).toBe(false);
    expect(authorize(el).disabled).toBe(false);
  });

  it("does not show the first approver's wrong PIN under the second", async () => {
    const el = await secondApproverTyping();
    el.error = { code: "pin.invalid", personId: "sup-1" };
    await el.updateComplete;
    expect(await shownError(el)).toBeNull();
  });

  it("shows the second approver's own refusal", async () => {
    const el = await secondApproverTyping();
    el.error = { code: "pin.invalid", personId: "adm-1" };
    await el.updateComplete;
    expect((await shownError(el))!.textContent).toContain(t("pin.invalid"));
  });
});

describe("approverRefusal", () => {
  it("names the approver, and keeps the seconds only on a throttled refusal", () => {
    expect(
      approverRefusal({ code: "pin.throttled", retryAfterSeconds: 5, status: 429 }, "sup-1"),
    ).toStrictEqual({ code: "pin.throttled", retryAfterSeconds: 5, personId: "sup-1" });
    expect(approverRefusal({ code: "pin.throttled", status: 429 }, "sup-1")).toStrictEqual({
      code: "pin.throttled",
      personId: "sup-1",
    });
    expect(approverRefusal({ code: "pin.throttled", retryAfterSeconds: 0 }, "sup-1")).toStrictEqual(
      { code: "pin.throttled", personId: "sup-1" },
    );
    expect(approverRefusal({ code: "pin.invalid", retryAfterSeconds: 5 }, "sup-1")).toStrictEqual({
      code: "pin.invalid",
      personId: "sup-1",
    });
    expect(approverRefusal(new Error("boom"), "sup-1")).toStrictEqual({
      code: "server.internal",
      personId: "sup-1",
    });
  });
});
