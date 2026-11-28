import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  attendanceEntry,
  attendanceInbox,
  attendanceMissingTimesPrompts,
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
const words = (node: Node) => node.textContent!.replace(/\s+/g, " ").trim();

function watch(el: HTMLElement, type: string): CustomEvent[] {
  const seen: CustomEvent[] = [];
  el.addEventListener(type, (e) => seen.push(e as CustomEvent));
  return seen;
}

describe("attendance questions before work", () => {
  it("shows the stored calendar date and time instead of recalculating them in the venue's zone", async () => {
    const { el } = await mount();
    const time = el.shadowRoot!.querySelector("time")!;
    expect(time).not.toBeNull();
    expect(time.getAttribute("datetime")).toBe("2026-10-13T23:30:00.000Z");
    expect(words(time.closest("li")!)).toBe(
      "Clocked out 01:30, Wednesday 14 October · added automatically",
    );
    expect(el.shadowRoot!.textContent).toContain(
      "This automatic finish already counts towards your hours.",
    );
    expect(el.shadowRoot!.textContent).not.toMatch(/unconfirmed/i);
  });

  it("heads a question card by its work day and a proposal card by nothing", async () => {
    const proposal = attendancePrompt({
      id: "proposal",
      questionId: null,
      kind: "proposal",
      businessDay: null,
    });
    const { el } = await mount({ inbox: attendanceInbox([attendancePrompt(), proposal]) });
    const card = (id: string) => el.shadowRoot!.querySelector(`[data-prompt="${id}"]`)!;
    expect([...card("question").querySelectorAll("h2")].map((h) => h.textContent!.trim())).toEqual([
      "Tuesday 13 October",
    ]);
    expect(card("question").querySelectorAll("p")[0]!.textContent).not.toContain("2026-10-13");
    expect(card("proposal").querySelector("h2")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("The deli");
  });

  it("stacks full-width answers and offers Answer later in the foot bar", async () => {
    const { el } = await mount();
    el.style.inlineSize = "390px";
    const confirm = button(el, "[data-confirm]").getBoundingClientRect();
    const edit = button(el, "[data-edit]").getBoundingClientRect();
    expect(edit.top).toBeGreaterThanOrEqual(confirm.bottom);
    expect(edit.width).toBe(confirm.width);
    expect(words(button(el, "wt-foot-button-bar [data-cancel]"))).toBe("Answer later");
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
    expect(el.shadowRoot!.textContent).toContain("Add missing times");
    expect(el.shadowRoot!.textContent).toContain("Tuesday 13 October");
    const edits = watch(el, "attendance-edit");
    await userEvent.click(button(el, "[data-edit]"));
    expect(edits.map((e) => e.detail)).toEqual([{ prompt }]);
  });

  it("shows the work dates, missing times and stored attendance in plain words", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    try {
      const { el } = await mount({ inbox: attendanceInbox(attendanceMissingTimesPrompts()) });
      const [monday, tuesday] = el.shadowRoot!.querySelectorAll("article");
      const lines = (card: Element) => Array.from(card.querySelectorAll("li"), words);
      expect(monday!.querySelector("h2")!.textContent).toBe("Monday 23 November");
      expect(monday!.querySelector("p")!.textContent).toBe("Some times are missing.");
      expect(lines(monday!)).toEqual([
        "Clocked in 19:10",
        "Clocked out 19:35 · added automatically",
        "You answered 19:35",
      ]);
      expect(Array.from(monday!.querySelectorAll("time"), (time) => time.dateTime)).toEqual([
        "2026-11-23T18:10:00.000Z",
        "2026-11-23T18:35:00.000Z",
        "2026-11-23T18:35:00.000Z",
      ]);
      expect(tuesday!.querySelector("h2")!.textContent).toBe("Tuesday 24 November");
      expect(tuesday!.querySelector("p")!.textContent).toBe("No times recorded.");
      for (const card of [monday!, tuesday!]) {
        expect(
          Array.from(card.querySelectorAll("wt-button"), (action) => action.textContent),
        ).toEqual(["Add missing times"]);
      }
      setLocale("es-ES");
      await el.updateComplete;
      expect(monday!.querySelector("h2")!.textContent).toBe("lunes, 23 de noviembre");
      expect(lines(monday!)).toEqual([
        "Fichaste la entrada 19:10",
        "Fichaste la salida 19:35 · añadida automáticamente",
        "Respondiste 19:35",
      ]);
      expect(tuesday!.querySelector("p")!.textContent).toBe("No hay fichajes.");
      expect(tuesday!.querySelector("[data-edit]")!.textContent).toBe("Añadir fichajes que faltan");
    } finally {
      setLocale(locale);
    }
  });

  it.each([
    ["after midnight", "2026-11-24T00:30:00.000Z", 60, "01:30, Tuesday 24 November"],
    ["at a different offset", "2026-11-23T18:35:00.000Z", 120, "20:35"],
  ] as const)("uses the recorded time %s", async (_label, eventAt, offsetMinutes, shown) => {
    const [prompt] = attendanceMissingTimesPrompts();
    prompt.history = [attendanceEntry({ eventAt, offsetMinutes })];
    const { el } = await mount({ inbox: attendanceInbox([prompt]) });
    expect(words(el.shadowRoot!.querySelector("li")!)).toBe(
      `Clocked out ${shown} · added automatically`,
    );
  });

  it("keeps both recorded offsets on a work day that crosses a clock change", async () => {
    const [prompt] = attendanceMissingTimesPrompts();
    prompt.businessDay = "2026-10-25";
    prompt.day = {
      businessDay: "2026-10-25",
      startAt: "2026-10-24T22:00:00.000Z",
      endAt: "2026-10-25T23:00:00.000Z",
    };
    prompt.history = [
      { ...prompt.history[0]!, eventAt: "2026-10-24T23:30:00.000Z", offsetMinutes: 120 },
      attendanceEntry({ eventAt: "2026-10-25T01:35:00.000Z", offsetMinutes: 60 }),
    ];
    const { el } = await mount({ inbox: attendanceInbox([prompt]) });
    expect(Array.from(el.shadowRoot!.querySelectorAll("time"), words)).toEqual([
      "01:30 +02:00",
      "02:35 +01:00",
    ]);
  });

  it("shows the break range, manager entry and worker correction with its decline", async () => {
    const [prompt] = attendanceMissingTimesPrompts();
    const [clockIn, clockOut, answer] = prompt.history;
    const correction = attendanceEntry({
      ...answer!,
      entryKind: "correction",
      eventAt: "2026-11-23T18:45:00.000Z",
      correctsEntryId: clockOut!.entryId,
      correctionStatus: "requested",
      correctionReason: "Finished the stock count",
      correctionActorId: "worker",
      extension: { ...clockIn!.extension!, direction: "worker_request" },
    });
    prompt.history = [
      { ...clockIn!, extension: undefined },
      {
        ...clockIn!,
        entryId: "break-start",
        entryKind: "break_start",
        eventAt: "2026-11-23T18:15:00.000Z",
      },
      {
        ...clockIn!,
        entryId: "break-end",
        entryKind: "break_end",
        eventAt: "2026-11-23T18:30:00.000Z",
      },
      {
        ...clockOut!,
        recordedByPersonId: "manager",
        extension: { ...clockIn!.extension!, authorKind: "manager" },
      },
      correction,
      attendanceEntry({
        ...correction,
        entryId: "decline",
        correctionStatus: "declined",
        correctionActorId: "manager",
        recordedByPersonId: "manager",
        extension: {
          ...correction.extension!,
          authorKind: "manager",
          respondsToEntryId: correction.entryId,
        },
      }),
    ];
    const { el } = await mount({ inbox: attendanceInbox([prompt]) });
    expect(Array.from(el.shadowRoot!.querySelectorAll("li"), words)).toEqual([
      "Clocked in 19:10",
      "Break 19:15 to 19:30",
      "Clocked out 19:35 · added by a manager",
      "You asked to change it to 19:45: Finished the stock count · declined by a manager",
    ]);
  });

  it.each(["single", "pair", "pair across work days"])(
    "shows the reason once for a declined missing-time request (%s)",
    async (scenario) => {
      const prompt = attendanceMissingTimesPrompts()[1];
      const acrossDays = scenario === "pair across work days";
      const clockIn = attendanceEntry({
        entryId: "request-in",
        entryKind: "correction",
        eventAt: "2026-11-24T08:00:00.000Z",
        offsetMinutes: 60,
        recordedByPersonId: "worker",
        correctionStatus: "requested",
        correctionReason: "The till was offline",
        extension: {
          ...attendanceEntry().extension!,
          authorKind: "worker",
          direction: "worker_request",
          missingEntryKind: "in",
        },
      });
      const clockOut = attendanceEntry({
        ...clockIn,
        entryId: "request-out",
        eventAt: acrossDays ? "2026-11-25T04:30:00.000Z" : "2026-11-24T16:00:00.000Z",
        extension: { ...clockIn.extension!, missingEntryKind: "out" },
      });
      const requests = scenario === "single" ? [clockIn] : [clockIn, clockOut];
      const declines = requests.map((entry) =>
        attendanceEntry({
          ...entry,
          entryId: `decline-${entry.entryId}`,
          recordedByPersonId: "manager",
          correctionStatus: "declined",
          extension: {
            ...entry.extension!,
            authorKind: "manager",
            respondsToEntryId: entry.entryId,
          },
        }),
      );
      const history = [...requests, ...declines];
      prompt.history = acrossDays ? [clockIn, declines[0]!] : history;
      const item = attendanceItem({
        direction: "worker_request",
        status: "declined",
        readyToApply: false,
        requestEntryIds: requests.map((entry) => entry.entryId),
        responseEntryIds: declines.map((entry) => entry.entryId),
        changes: requests.map(({ eventAt: at, offsetMinutes, extension }) => ({
          target: { missingKind: extension!.missingEntryKind! },
          at,
          offsetMinutes,
        })),
        reason: "The till was offline",
        requestedByPersonId: "worker",
        history,
      });
      const locale = currentLocale();
      try {
        const { el } = await mount({ inbox: attendanceInbox([prompt], [item]) });
        const lines = () => Array.from(el.shadowRoot!.querySelectorAll("li"), words);
        expect(lines()).toEqual(
          scenario === "pair"
            ? [
                "You asked to add a clock-in at 09:00 · declined by a manager",
                "You asked to add a clock-out at 17:00: The till was offline · declined by a manager",
              ]
            : [
                "You asked to add a clock-in at 09:00: The till was offline · declined by a manager",
              ],
        );
        setLocale("es-ES");
        await el.updateComplete;
        expect(lines()).toEqual(
          scenario === "pair"
            ? [
                "Pediste añadir una entrada a las 09:00 · rechazada por un responsable",
                "Pediste añadir una salida a las 17:00: The till was offline · rechazada por un responsable",
              ]
            : [
                "Pediste añadir una entrada a las 09:00: The till was offline · rechazada por un responsable",
              ],
        );
      } finally {
        setLocale(locale);
      }
    },
  );

  it.each([
    [["out"], "2026-11-25T16:00:00.000Z", "clocking out at 17:00", "fichar la salida a las 17:00"],
    [
      ["in", "out"],
      "2026-11-25T16:00:00.000Z",
      "clocking in at 09:00 and out at 17:00",
      "fichar la entrada a las 09:00 y la salida a las 17:00",
    ],
    [
      ["in", "out"],
      "2026-11-26T00:00:00.000Z",
      "clocking in at 09:00 and out at 01:00, Thursday 26 November",
      "fichar la entrada a las 09:00 y la salida a la 01:00, jueves, 26 de noviembre",
    ],
  ] as const)(
    "names the missing clock events above the decision (%j, %s)",
    async (kinds, outAt, english, spanish) => {
      const item = attendanceItem({
        changes: kinds.map((missingKind) => ({
          target: { missingKind },
          at: missingKind === "in" ? "2026-11-25T08:00:00.000Z" : outAt,
          offsetMinutes: 60,
        })),
        history: [],
        reason: "The till was offline",
      });
      const prompt = attendancePrompt({
        kind: "proposal",
        itemId: item.id,
        questionId: null,
        businessDay: null,
        timeZone: "Europe/Madrid",
        history: item.history,
      });
      const locale = currentLocale();
      try {
        const { el } = await mount({ inbox: attendanceInbox([prompt], [item]) });
        const card = el.shadowRoot!.querySelector("article")!;
        expect(words(card)).toBe(
          `Wednesday 25 November. A manager proposed ${english}: The till was offline Accept Disagree`,
        );
        setLocale("es-ES");
        await el.updateComplete;
        expect(words(card)).toBe(
          `miércoles, 25 de noviembre. Un responsable propuso ${spanish}: The till was offline Aceptar No estoy de acuerdo`,
        );
      } finally {
        setLocale(locale);
      }
    },
  );

  it("proposals show the distinct original and proposed times, reason and both worker decisions", async () => {
    const item = attendanceItem();
    const prompt = attendancePrompt({
      id: "proposal",
      questionId: null,
      itemId: item.id,
      kind: "proposal",
      businessDay: null,
      day: null,
      timeZone: "Europe/Madrid",
      automaticEntryId: null,
      history: item.history,
    });
    const question = attendancePrompt({ history: item.history });
    const { el } = await mount({ inbox: attendanceInbox([question, prompt], [item]) });
    expect(words(el.shadowRoot!.querySelector('[data-prompt="proposal"]')!)).toBe(
      "Tuesday 13 October. A manager proposed 18:00 instead of 17:00: Finished the stock count Accept Disagree",
    );
    expect(el.shadowRoot!.textContent!.split(item.reason)).toHaveLength(2);
    const decisions = watch(el, "attendance-decide");
    await userEvent.click(button(el, "[data-accept]"));
    await userEvent.click(button(el, "[data-disagree]"));
    expect(decisions.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
      [{ itemId: "proposal", action: "accept" }, true, true],
      [{ itemId: "proposal", action: "disagree" }, true, true],
    ]);
    expect(el.shadowRoot!.querySelector('[data-prompt="proposal"] [data-confirm]')).toBeNull();
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
    const first = attendancePrompt();
    const next = attendancePrompt({
      id: "next",
      questionId: "next",
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

  it("a held or failed read keeps Answer later and Retry read usable without writing an answer", async () => {
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
      expect(button(el, "[data-cancel]").textContent!.trim()).toBe("Responder más tarde");
      expect(el.shadowRoot!.textContent).not.toMatch(/My hours|Mis horas|Clock in/);
    } finally {
      setLocale(locale);
    }
  });
});
