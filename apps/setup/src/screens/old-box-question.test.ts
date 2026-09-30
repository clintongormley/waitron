import { render } from "lit";
import { afterEach, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { OLD_BOX_PROBLEM, oldBoxProblem, oldBoxQuestion } from "./old-box-question.js";

const hosts: HTMLElement[] = [];

function mount(opts: Partial<Parameters<typeof oldBoxQuestion>[0]> = {}): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  render(
    oldBoxQuestion({
      liveSince: undefined,
      liveUnknown: true,
      checked: false,
      invalid: true,
      onChange: () => {},
      ...opts,
    }),
    host,
  );
  return host;
}

const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en-GB");
});

it("asks about the old server in English by default", () => {
  const host = mount();
  expect(text(host.querySelector("[data-test=live-warning]")!)).toBe(
    "Whether the old server is still writing to its bucket could not be checked. If it is still running, two servers would sell from the same records, and that cannot be undone. Switch it off for good before you go on.",
  );
  expect(text(host.querySelector("label")!)).toBe("The old server is switched off for good.");
  expect(text(host.querySelector("#old-box-gone-error")!)).toBe(OLD_BOX_PROBLEM);
  expect(oldBoxProblem()).toBe(OLD_BOX_PROBLEM);
});

it("asks about the old server in Spanish", () => {
  setLocale("es-ES");
  const host = mount({ liveSince: "2026-09-29T10:15:00.000Z", liveUnknown: false });
  const warning = text(host.querySelector("[data-test=live-warning]")!);
  expect(warning.startsWith("El servidor anterior escribió en su bucket el ")).toBe(true);
  expect(warning).toContain("(2026-09-29T10:15:00.000Z).");
  expect(warning).toContain("Apágalo para siempre antes de continuar.");
  expect(text(host.querySelector("label")!)).toBe(
    "El servidor anterior está apagado para siempre.",
  );
  expect(text(host.querySelector("#old-box-gone-error")!)).toBe(
    "Confirma que el servidor anterior está apagado para siempre.",
  );
  expect(oldBoxProblem()).toBe("Confirma que el servidor anterior está apagado para siempre.");
});

it("writes the time the old server wrote in the wizard's language", () => {
  const iso = "2026-09-29T10:15:00.000Z";
  setLocale("es-ES");
  const host = mount({ liveSince: iso, liveUnknown: false });
  expect(text(host.querySelector("time")!)).toBe(
    new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }),
  );
});

it("shows the server's refusal under the checkbox and points the checkbox at it", () => {
  const host = mount({ invalid: false, refusal: "Check your answer about the old server." });
  expect(text(host.querySelector("#old-box-gone-error")!)).toBe(
    "Check your answer about the old server.",
  );
  const box = host.querySelector("[data-test=old-box-gone]")!;
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(box.getAttribute("aria-describedby")).toBe("old-box-gone-error");
});

it("says the question is unanswered rather than repeating the server's refusal", () => {
  const host = mount({ invalid: true, refusal: "Check your answer about the old server." });
  expect(text(host.querySelector("#old-box-gone-error")!)).toBe(OLD_BOX_PROBLEM);
});
