import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { en, es } from "../i18n/strings.js";
import { clockDateTime, setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./box-time-dialog.js";
import type { BoxTimeApi, TillBoxTimeDialog } from "./box-time-dialog.js";

const TILL_AT = Date.UTC(2026, 9, 31, 16, 45);
const BOX_AGREES = new Date(TILL_AT - 20_000).toISOString();
const BOX_BEHIND = new Date(Date.UTC(2001, 0, 2, 3, 4)).toISOString();
const ADMIN = { personId: "p-admin", displayName: "Alex Admin" };

let challenges = 0;

function fakeApi(boxAt: string, confirm: BoxTimeApi["boxClockConfirm"] = okConfirm()) {
  challenges = 0;
  return {
    boxClockChallenge: vi.fn<BoxTimeApi["boxClockChallenge"]>(() =>
      Promise.resolve({ challengeId: `c${++challenges}`, boxAt }),
    ),
    boxClockConfirm: vi.fn(confirm),
    listAdjustmentApprovers: vi.fn(() => Promise.resolve([ADMIN])),
  };
}

function okConfirm(stepMs = 0): BoxTimeApi["boxClockConfirm"] {
  return () =>
    Promise.resolve({
      confirmationId: "k1",
      stepMs,
      confirmedAt: new Date(TILL_AT).toISOString(),
    });
}

const refusing =
  (refusal: Record<string, unknown>): BoxTimeApi["boxClockConfirm"] =>
  () =>
    Promise.reject(refusal);

const flat = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/[ \t\n\r]+/g, " ").trim();
const root = (el: TillBoxTimeDialog) => el.shadowRoot!;
const words = (el: TillBoxTimeDialog) => flat(root(el).querySelector("[data-box-time-words]"));
const shownError = (el: TillBoxTimeDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")?.error ?? "";
const control = (el: TillBoxTimeDialog, name: string) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>(`[data-box-time="${name}"]`);
const controls = (el: TillBoxTimeDialog) =>
  [...root(el).querySelectorAll<HTMLElement>("wt-form-actions wt-button")].map(
    (button) => button.dataset.boxTime!,
  );

async function settle(el: TillBoxTimeDialog): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function open(api: ReturnType<typeof fakeApi>): Promise<TillBoxTimeDialog> {
  const { el } = await mountWidget<TillBoxTimeDialog>("till-box-time-dialog", { api });
  await settle(el);
  return el;
}

async function press(el: TillBoxTimeDialog, name: string): Promise<void> {
  await userEvent.click(control(el, name)!);
  await settle(el);
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(TILL_AT);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("en-GB");
});

describe("till-box-time-dialog", () => {
  it("shows both times when this till differs, and offers this till's time", async () => {
    const el = await open(fakeApi(BOX_BEHIND));
    expect(words(el)).toContain(
      en["box_time.differs"]
        .replace("{box}", clockDateTime(Date.parse(BOX_BEHIND)))
        .replace("{till}", clockDateTime(TILL_AT)),
    );
    expect(words(el)).toContain(en["box_time.differs_ask"]);
    expect(words(el)).toContain(en["box_time.differs_wrong_till"]);
    expect(flat(control(el, "primary"))).toBe(en["box_time.use_till"]);
    expect(controls(el)).toEqual(["not-now", "primary"]);
  });

  it("asks only to confirm when this till agrees", async () => {
    const el = await open(fakeApi(BOX_AGREES));
    expect(words(el)).toBe(
      en["box_time.agrees"].replace("{box}", clockDateTime(Date.parse(BOX_AGREES))),
    );
    expect(flat(control(el, "primary"))).toBe(en["box_time.time_right"]);
  });

  it("takes a second challenge for the confirm and sends this till's own time", async () => {
    const api = fakeApi(BOX_BEHIND, okConfirm(800_000_000_000));
    const el = await open(api);
    const later = TILL_AT + 3_000;
    vi.mocked(Date.now).mockReturnValue(later);
    await press(el, "primary");
    expect(api.boxClockChallenge).toHaveBeenCalledTimes(2);
    expect(api.boxClockConfirm.mock.calls).toEqual([[{ challengeId: "c2", deviceAt: later }]]);
    expect(words(el)).toBe(en["box_time.set_to"].replace("{after}", clockDateTime(TILL_AT)));
    expect(controls(el)).toEqual(["close"]);
  });

  it("says the time is confirmed when nothing was moved, and tells the till", async () => {
    const api = fakeApi(BOX_AGREES);
    const el = await open(api);
    let done = 0;
    el.addEventListener("box-time-done", () => done++);
    await press(el, "primary");
    expect(words(el)).toBe(en["box_time.confirmed"]);
    expect(done).toBe(1);
  });

  it("keeps the primary disabled while the confirm is out", async () => {
    let answer!: () => void;
    const api = fakeApi(BOX_AGREES, () => {
      return new Promise((resolve) => {
        answer = () => resolve({ confirmationId: "k1", stepMs: 0, confirmedAt: BOX_AGREES });
      });
    });
    const el = await open(api);
    await press(el, "primary");
    expect(control(el, "primary")!.disabled).toBe(true);
    answer();
    await settle(el);
    expect(words(el)).toBe(en["box_time.confirmed"]);
  });

  it("keeps Not now disabled, and the dialog from closing, while the confirm is out", async () => {
    let answer!: () => void;
    const api = fakeApi(BOX_AGREES, () => {
      return new Promise((resolve) => {
        answer = () => resolve({ confirmationId: "k1", stepMs: 0, confirmedAt: BOX_AGREES });
      });
    });
    const el = await open(api);
    const box = () => root(el).querySelector<HTMLElement & { dismissible: boolean }>("wt-dialog")!;
    expect(box().dismissible).toBe(true);
    await press(el, "primary");
    expect(control(el, "not-now")!.disabled).toBe(true);
    expect(box().dismissible).toBe(false);
    answer();
    await settle(el);
    expect(box().dismissible).toBe(true);
  });

  it.each([
    [60_000, "box_time.time_right"],
    [60_001, "box_time.use_till"],
  ] as const)("treats a till %i ms from the box as %s", async (gap, label) => {
    const el = await open(fakeApi(new Date(TILL_AT - gap).toISOString()));
    expect(flat(control(el, "primary"))).toBe(en[label]);
  });

  it("sends nothing on Not now and closes", async () => {
    const api = fakeApi(BOX_BEHIND);
    const el = await open(api);
    let closed = 0;
    el.addEventListener("box-time-close", () => closed++);
    await press(el, "not-now");
    expect(api.boxClockConfirm).not.toHaveBeenCalled();
    expect(api.boxClockChallenge).toHaveBeenCalledTimes(1);
    expect(closed).toBe(1);
  });

  const REFUSALS: [string, Record<string, unknown>, string, string[]][] = [
    [
      "not_stopped",
      { code: "clock.set_refused", reason: "not_stopped" },
      "box_time.refused.not_stopped",
      ["close"],
    ],
    [
      "a confirm's not_stopped",
      { code: "clock.confirm_refused", reason: "not_stopped" },
      "box_time.refused.not_stopped",
      ["close"],
    ],
    [
      "not_start_up",
      { code: "clock.set_refused", reason: "not_start_up" },
      "box_time.refused.not_start_up",
      ["close", "admin"],
    ],
    [
      "authority_pending",
      { code: "clock.set_refused", reason: "authority_pending" },
      "box_time.refused.authority_pending",
      ["close", "check-again"],
    ],
    [
      "witnessed",
      { code: "clock.set_refused", reason: "witnessed" },
      "box_time.refused.witnessed",
      ["close"],
    ],
    [
      "synchronised",
      { code: "clock.set_refused", reason: "synchronised" },
      "box_time.refused.synchronised",
      ["close"],
    ],
    [
      "host_unavailable",
      { code: "clock.set_refused", reason: "host_unavailable" },
      "box_time.refused.host_unavailable",
      ["close"],
    ],
    [
      "stale",
      { code: "clock.set_refused", reason: "stale" },
      "box_time.refused.stale",
      ["close", "check-again"],
    ],
    [
      "a check that took too long",
      { code: "clock.check_expired" },
      "box_time.refused.check_expired",
      ["close", "check-again"],
    ],
    [
      "same_machine",
      { code: "clock.set_refused", reason: "same_machine" },
      "box_time.refused.same_machine",
      ["close"],
    ],
    [
      "contrary_proof",
      { code: "clock.confirm_refused", reason: "contrary_proof" },
      "box_time.refused.contrary_proof",
      ["close"],
    ],
    [
      "a profile that no longer admits the person",
      { code: "device_profile.not_admitted" },
      "box_time.refused.not_admitted",
      ["close"],
    ],
    [
      "a set the host refused",
      { code: "clock.set_failed", reason: "refused" },
      "box_time.refused.set_failed_refused",
      ["close", "check-again"],
    ],
    [
      "a set the box could not verify",
      { code: "clock.set_failed", reason: "unverified" },
      "box_time.refused.set_failed_unverified",
      ["close", "check-again"],
    ],
    [
      "pending_disproofs",
      { code: "clock.set_refused", reason: "pending_disproofs" },
      "box_time.refused.pending_disproofs",
      ["close", "check-again"],
    ],
    [
      "a reason this till does not know",
      { code: "clock.set_refused", reason: "agrees" },
      "box_time.refused.other",
      ["close", "check-again"],
    ],
    ["no answer", { code: "network" }, "box_time.refused.other", ["close", "check-again"]],
  ];

  it.each(REFUSALS)(
    "words a confirm refused for %s above its buttons",
    async (_case, refusal, key, buttons) => {
      const el = await open(fakeApi(BOX_BEHIND, refusing(refusal)));
      await press(el, "primary");
      expect(shownError(el)).toBe(en[key as keyof typeof en]);
      expect(controls(el)).toEqual(buttons);
    },
  );

  it.each(REFUSALS)(
    "words a challenge refused for %s in Spanish too",
    async (_case, refusal, key) => {
      setLocale("es-ES");
      const api = fakeApi(BOX_BEHIND);
      api.boxClockChallenge.mockImplementation(() => Promise.reject(refusal));
      const el = await open(api);
      expect(shownError(el)).toBe(es[key as keyof typeof es]);
    },
  );

  it("words a till date the box cannot take with this till's own reading", async () => {
    const el = await open(
      fakeApi(BOX_BEHIND, refusing({ code: "clock.set_refused", reason: "target_invalid" })),
    );
    await press(el, "primary");
    expect(shownError(el)).toBe(
      en["box_time.refused.target_invalid"].replace("{till}", clockDateTime(TILL_AT)),
    );
    expect(controls(el)).toEqual(["close", "check-again"]);
  });

  it("asks for a new challenge on Check again and shows the question again", async () => {
    const api = fakeApi(BOX_BEHIND, refusing({ code: "clock.set_refused", reason: "stale" }));
    const el = await open(api);
    await press(el, "primary");
    await press(el, "check-again");
    expect(api.boxClockChallenge).toHaveBeenCalledTimes(3);
    expect(shownError(el)).toBe("");
    expect(flat(control(el, "primary"))).toBe(en["box_time.use_till"]);
  });

  it("closes on Close after a refusal", async () => {
    const el = await open(
      fakeApi(BOX_BEHIND, refusing({ code: "clock.set_refused", reason: "witnessed" })),
    );
    let closed = 0;
    el.addEventListener("box-time-close", () => closed++);
    await press(el, "primary");
    await press(el, "close");
    expect(closed).toBe(1);
  });

  describe("an administrator signing in here", () => {
    const pinDialog = (el: TillBoxTimeDialog) =>
      root(el).querySelector<HTMLElement & { error: string | null }>(
        "till-supervisor-override-dialog",
      );

    async function signIn(el: TillBoxTimeDialog, pin = "1234"): Promise<void> {
      const dialog = pinDialog(el)!;
      dialog.dispatchEvent(
        new CustomEvent("override-confirm", {
          detail: { personId: ADMIN.personId, pin },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(el);
    }

    async function refusedNotStartUp(api: ReturnType<typeof fakeApi>) {
      api.boxClockChallenge.mockImplementationOnce(() =>
        Promise.reject({ code: "clock.set_refused", reason: "not_start_up" }),
      );
      const el = await open(api);
      await press(el, "admin");
      return el;
    }

    const override = { personId: ADMIN.personId, pin: "1234" };

    it("lists the administrators and, on a PIN, shows both times before sending anything", async () => {
      const api = fakeApi(BOX_BEHIND, okConfirm(5_000));
      const el = await refusedNotStartUp(api);
      expect(api.listAdjustmentApprovers).toHaveBeenCalledWith(["admin"]);
      const dialog = pinDialog(el) as unknown as { authorizers: unknown; approverRole: string };
      expect(dialog.authorizers).toEqual([ADMIN]);
      expect(dialog.approverRole).toBe("admin");
      await signIn(el);
      expect(pinDialog(el)).toBeNull();
      expect(api.boxClockChallenge.mock.calls.at(-1)).toEqual([override]);
      expect(api.boxClockConfirm).not.toHaveBeenCalled();
      expect(words(el)).toContain(
        en["box_time.differs"]
          .replace("{box}", clockDateTime(Date.parse(BOX_BEHIND)))
          .replace("{till}", clockDateTime(TILL_AT)),
      );
      expect(controls(el)).toEqual(["not-now", "primary"]);
      await press(el, "primary");
      expect(api.boxClockConfirm.mock.calls).toEqual([
        [{ challengeId: "c2", deviceAt: TILL_AT, override }],
      ]);
      expect(words(el)).toBe(en["box_time.set_to"].replace("{after}", clockDateTime(TILL_AT)));
    });

    it.each([
      ["pin.invalid", en["pin.invalid"]],
      ["pin.throttled", en["pin.throttled"]],
      ["authorization.not_permitted", codeMessage("authorization.not_permitted")],
    ])(
      "shows a PIN refused at the confirm (%s) and offers the sign-in again",
      async (code, text) => {
        const api = fakeApi(BOX_BEHIND, refusing({ code }));
        const el = await refusedNotStartUp(api);
        await signIn(el);
        await press(el, "primary");
        expect(shownError(el)).toBe(text);
        expect(controls(el)).toEqual(["close", "admin"]);
        await press(el, "admin");
        await signIn(el, "5678");
        expect(api.boxClockChallenge.mock.calls.at(-1)).toEqual([
          { personId: ADMIN.personId, pin: "5678" },
        ]);
      },
    );

    it("takes one sign-in when the PIN pad answers twice", async () => {
      const api = fakeApi(BOX_BEHIND);
      const el = await refusedNotStartUp(api);
      const pad = pinDialog(el)!;
      for (const pin of ["1234", "1234"])
        pad.dispatchEvent(
          new CustomEvent("override-confirm", {
            detail: { personId: ADMIN.personId, pin },
            bubbles: true,
            composed: true,
          }),
        );
      await settle(el);
      expect(api.boxClockChallenge).toHaveBeenCalledTimes(2);
      expect(api.boxClockConfirm).not.toHaveBeenCalled();
    });

    it("carries the administrator's PIN on Check again", async () => {
      const api = fakeApi(BOX_BEHIND, refusing({ code: "clock.set_refused", reason: "stale" }));
      const el = await refusedNotStartUp(api);
      await signIn(el);
      await press(el, "primary");
      await press(el, "check-again");
      expect(api.boxClockChallenge.mock.calls.at(-1)).toEqual([override]);
    });

    it("goes back to the refusal when the sign-in is cancelled", async () => {
      const api = fakeApi(BOX_BEHIND);
      const el = await refusedNotStartUp(api);
      pinDialog(el)!.dispatchEvent(
        new CustomEvent("override-cancel", { bubbles: true, composed: true }),
      );
      await settle(el);
      expect(pinDialog(el)).toBeNull();
      expect(shownError(el)).toBe(en["box_time.refused.not_start_up"]);
      expect(api.boxClockConfirm).not.toHaveBeenCalled();
    });
  });
});
