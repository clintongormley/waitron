import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  attendanceInbox,
  attendanceItem,
  attendancePrompt,
} from "../../test/attendance-fixtures.js";
import type { TillAttendanceQuestions } from "./till-attendance-questions.js";
import "./till-attendance-questions.js";

afterEach(cleanupWidgets);
const mount = (props: Partial<TillAttendanceQuestions> = {}) =>
  mountWidget<TillAttendanceQuestions>("till-attendance-questions", {
    inbox: attendanceInbox(),
    ...props,
  });
const button = (el: TillAttendanceQuestions, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;

function watch(el: HTMLElement, type: string): CustomEvent[] {
  const seen: CustomEvent[] = [];
  el.addEventListener(type, (e) => seen.push(e as CustomEvent));
  return seen;
}

describe("attendance questions before work", () => {
  it("shows the stored calendar time and offset, not the business day or current location zone", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.textContent).toContain("The deli");
    const time = el.shadowRoot!.querySelector("time")!;
    expect(time).not.toBeNull();
    expect(time.getAttribute("datetime")).toBe("2026-10-13T23:30:00.000Z");
    expect(time.textContent).toBe("2026-10-14 01:30 +02:00");
    expect(el.shadowRoot!.textContent).toContain(
      "This automatic finish already counts towards your hours.",
    );
    expect(el.shadowRoot!.textContent).not.toMatch(/unconfirmed/i);
  });

  it("sends the exact confirmation or edit intent once through real controls", async () => {
    const { el } = await mount();
    const confirms = watch(el, "attendance-confirm");
    const edits = watch(el, "attendance-edit");
    await userEvent.click(button(el, "[data-confirm]"));
    await userEvent.click(button(el, "[data-edit]"));
    expect(confirms.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
      [{ questionId: "question" }, true, true],
    ]);
    expect(edits.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
      [{ prompt: attendancePrompt() }, true, true],
    ]);
  });

  it("missing times offer an editor without guessing times or confirmation", async () => {
    const prompt = attendancePrompt({
      kind: "missing-times",
      automaticEntryId: null,
      missingKinds: ["in", "out"],
      history: [],
    });
    const { el } = await mount({ inbox: attendanceInbox([prompt]) });
    expect(el.shadowRoot!.querySelector("[data-confirm]")).toBeNull();
    expect(el.shadowRoot!.querySelector("time")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Supply your missing times");
    expect(el.shadowRoot!.textContent).toContain("Work day: 2026-10-13");
    const edits = watch(el, "attendance-edit");
    await userEvent.click(button(el, "[data-edit]"));
    expect(edits.map((e) => e.detail)).toEqual([{ prompt }]);
  });

  it("proposals show the distinct original and proposed times, reason and both worker decisions", async () => {
    const item = attendanceItem();
    const prompt = attendancePrompt({
      id: "proposal",
      questionId: null,
      itemId: item.id,
      kind: "proposal",
      automaticEntryId: null,
      history: item.history,
    });
    const { el } = await mount({ inbox: attendanceInbox([prompt], [item]) });
    expect([...el.shadowRoot!.querySelectorAll("time")].map((t) => t.textContent)).toEqual([
      "2026-10-13 17:00 +02:00",
      "2026-10-13 18:00 +02:00",
    ]);
    expect(el.shadowRoot!.textContent).toContain("Original time");
    expect(el.shadowRoot!.textContent).toContain("Proposed time");
    expect(el.shadowRoot!.textContent).toContain("Finished the stock count");
    const decisions = watch(el, "attendance-decide");
    await userEvent.click(button(el, "[data-accept]"));
    await userEvent.click(button(el, "[data-disagree]"));
    expect(decisions.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
      [{ itemId: "proposal", action: "accept" }, true, true],
      [{ itemId: "proposal", action: "disagree" }, true, true],
    ]);
    expect(el.shadowRoot!.querySelector("[data-confirm]")).toBeNull();
  });

  it("a sequence-blocked proposal can be disputed but cannot be accepted", async () => {
    const item = attendanceItem({ readyToApply: false });
    const prompt = attendancePrompt({
      kind: "proposal",
      questionId: null,
      itemId: item.id,
      history: item.history,
    });
    const { el } = await mount({ inbox: attendanceInbox([prompt], [item]) });
    expect(button(el, "[data-accept]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-disagree]").hasAttribute("disabled")).toBe(false);
  });

  it("a replaced or missing proposal cannot emit either decision", async () => {
    const prompt = attendancePrompt({ kind: "proposal", questionId: null, itemId: "proposal" });
    const { el } = await mount({
      inbox: attendanceInbox([prompt], [attendanceItem({ status: "overtaken" })]),
    });
    expect(el.shadowRoot!.querySelector("[data-accept]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-disagree]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("A newer change replaced this request.");
    el.inbox = attendanceInbox([prompt]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-accept]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-disagree]")).toBeNull();
  });

  it("holds the supplied oldest-first order and does not turn a pending request into a question", async () => {
    const first = attendancePrompt({ locationName: "First location" });
    const next = attendancePrompt({
      id: "next",
      questionId: "next",
      locationName: "Second location",
    });
    const { el } = await mount({
      inbox: attendanceInbox(
        [first, next],
        [attendanceItem({ direction: "worker_request", status: "waiting-manager" })],
      ),
    });
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-prompt]")].map((p) =>
        p.getAttribute("data-prompt"),
      ),
    ).toEqual(["question", "next"]);
    el.inbox = attendanceInbox(
      [],
      [attendanceItem({ direction: "worker_request", status: "waiting-manager" })],
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-prompt]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-confirm]")).toBeNull();
  });

  it("a held or failed read keeps Cancel and Retry read usable without writing an answer", async () => {
    const { el } = await mount({ inbox: null, reading: true });
    const canceled = watch(el, "cancel-attendance");
    const retried = watch(el, "retry-attendance");
    const confirms = watch(el, "attendance-confirm");
    expect(button(el, "[data-cancel]").hasAttribute("disabled")).toBe(false);
    await userEvent.click(button(el, "[data-cancel]"));
    el.reading = false;
    el.error = "Hours could not be read";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toBe(
      "Hours could not be read",
    );
    await userEvent.click(button(el, "[data-retry]"));
    expect(canceled).toHaveLength(1);
    expect(retried).toHaveLength(1);
    expect(confirms).toHaveLength(0);
  });

  it("read and write gates stop repeat actions while a refusal leaves them retryable", async () => {
    const { el } = await mount({ busy: true });
    expect(button(el, "[data-confirm]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-edit]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-cancel]").hasAttribute("disabled")).toBe(true);
    el.busy = false;
    el.reading = true;
    await el.updateComplete;
    expect(button(el, "[data-confirm]").hasAttribute("disabled")).toBe(true);
    expect(button(el, "[data-cancel]").hasAttribute("disabled")).toBe(false);
    el.reading = false;
    el.error = "Response refused";
    await el.updateComplete;
    expect(button(el, "[data-confirm]").hasAttribute("disabled")).toBe(false);
    expect(button(el, "[data-edit]").hasAttribute("disabled")).toBe(false);
  });

  it("retained detached controls cannot answer or cancel for a departed operator", async () => {
    const { el } = await mount();
    const confirms = watch(el, "attendance-confirm");
    const canceled = watch(el, "cancel-attendance");
    const confirm = button(el, "[data-confirm]");
    const cancel = button(el, "[data-cancel]");
    el.remove();
    confirm.click();
    cancel.click();
    expect(confirms).toEqual([]);
    expect(canceled).toEqual([]);
  });

  it("switches all question actions to Spanish without introducing an optional hours step", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    try {
      const { el } = await mount();
      expect(button(el, "[data-confirm]").textContent!.trim()).toBe("That's right");
      setLocale("es-ES");
      await el.updateComplete;
      expect(button(el, "[data-confirm]").textContent!.trim()).toBe("Es correcto");
      expect(button(el, "[data-edit]").textContent!.trim()).toBe("No, salí a las…");
      expect(button(el, "[data-cancel]").textContent!.trim()).toBe("Cancelar");
      expect(el.shadowRoot!.textContent).not.toMatch(/My hours|Mis horas|Clock in/);
    } finally {
      setLocale(locale);
    }
  });
});
