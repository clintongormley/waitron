import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./mode-screen.js";
import type { SetupModeScreen } from "./mode-screen.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupModeScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();

const rowBox = (row: Element) => {
  const button = row.shadowRoot!.querySelector("button")!;
  const style = getComputedStyle(button);
  return {
    rect: button.getBoundingClientRect(),
    top: [style.borderTopLeftRadius, style.borderTopRightRadius],
    bottom: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
    lineAbove: style.borderTopWidth,
  };
};

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("setup-mode-screen", () => {
  it("offers Demo, Prepare and Live as three equal rows, each a whole-row choice", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const rows = [...el.shadowRoot!.querySelectorAll(".choices > wt-choice-row")];
    expect(rows.map((row) => row.getAttribute("data-test"))).toEqual([
      "choose-demo",
      "choose-prepare",
      "choose-live",
    ]);
    expect(rows.map((row) => row.getAttribute("heading"))).toEqual([
      "Demo",
      "Prepare your restaurant",
      "Live",
    ]);
    expect(rows.map((row) => text(row))).toEqual([
      "A practice server. Nothing is filed to AEAT — safe to explore and throw away.",
      "Enter your real menus, staff and layouts, then practise with test payments. Nothing is filed to AEAT.",
      "The real thing. Every sale is filed to AEAT. This choice is permanent.",
    ]);
  });

  it("draws the three new-restaurant choices as one rounded box with a line between rows", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const [demo, prepare, live] = [
      ...el.shadowRoot!.querySelectorAll(".choices > wt-choice-row"),
    ].map(rowBox);
    expect(prepare!.rect.top).toBe(demo!.rect.bottom);
    expect(live!.rect.top).toBe(prepare!.rect.bottom);
    expect([prepare!.lineAbove, live!.lineAbove]).toEqual(["1px", "1px"]);
    expect(demo!.top).not.toEqual(["0px", "0px"]);
    expect([demo!.bottom, prepare!.top, prepare!.bottom, live!.top]).toEqual(
      Array(4).fill(["0px", "0px"]),
    );
    expect(live!.bottom).toEqual(demo!.top);
  });

  it("draws Join or recover as a box of its own, rounded at every corner", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const existing = rowBox(q(el, "[data-test=choose-existing]")!);
    expect(existing.top).not.toEqual(["0px", "0px"]);
    expect(existing.bottom).toEqual(existing.top);
  });

  it("puts Join or recover under its own question, apart from the three new-restaurant choices", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const existing = q(el, "[data-test=choose-existing]")!;
    expect(existing.tagName).toBe("WT-CHOICE-ROW");
    expect(existing.closest(".choices")).toBeNull();
    expect(existing.getAttribute("heading")).toBe("Join or recover");
    expect(text(existing)).toBe(
      "Add this server as a mirror of a running restaurant, or recover a restaurant from a backup.",
    );
    expect(text(q(el, "h2")!)).toBe("Already have a restaurant?");
  });

  it("draws no extra buttons beside the rows", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(el.shadowRoot!.querySelectorAll("wt-button")).toHaveLength(0);
  });

  it("says nothing about certificates unless asked to", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(q(el, "[data-test=cert-note]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("certificate");
  });

  it("links to certificate help when asked to show the certificate note", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      certificateNote: true,
    });
    const note = q(el, "[data-test=cert-note]")!;
    expect(note.textContent).toContain("If your browser shows a certificate warning");
    const link = note.querySelector<HTMLAnchorElement>("[data-test=trust-help]")!;
    expect(link.getAttribute("href")).toBe("/setup/trust");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("opens the Join or recover subchooser without selecting a provision mode", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-existing]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "role" } }]);
  });

  it("advances to admin with mode:demo on the demo choice", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-demo]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "demo" } } },
      { kind: "goto", detail: { screen: "admin" } },
    ]);
  });

  it("advances to admin with mode:prepare on the Prepare choice", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-prepare]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "prepare" } } },
      { kind: "goto", detail: { screen: "admin" } },
    ]);
  });

  it("does NOT provision live on a single click — it shows the permanence warning instead", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=live-warning]")).not.toBeNull();
    expect(q(el, "[data-test=choose-demo]")).toBeNull();
  });

  it("still does not emit when confirm is clicked before 'I understand' is on", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    const events = collect(host);
    // Clicking the host directly bypasses the inner disabled <button>, exercising the method guard.
    q(el, "[data-test=confirm-live]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
  });

  it("provisions live only after 'I understand' is switched on and confirm is clicked", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    const events = collect(host);
    q(el, "[data-test=understand]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    q(el, "[data-test=confirm-live]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "live" } } },
      { kind: "goto", detail: { screen: "live-source" } },
    ]);
  });

  it("cancels the live confirm back to the two choices", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    q(el, "[data-test=understand]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    q(el, "[data-test=live-cancel]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=choose-demo]")).not.toBeNull();
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect((el as unknown as { understood: boolean }).understood).toBe(false);
  });

  it("calls out a production box loudly", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "production",
    });
    expect(q(el, "[data-test=production-warning]")).not.toBeNull();
  });

  it("shows no production warning for a preproduction box", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "preproduction",
    });
    expect(q(el, "[data-test=production-warning]")).toBeNull();
  });

  it("never prints the box environment as a word of its own", async () => {
    for (const environment of ["production", "preproduction"] as const) {
      const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", { environment });
      const paragraphs = [...el.shadowRoot!.querySelectorAll("p")].map((p) => text(p));
      expect(paragraphs).not.toContain(environment);
      expect(q(el, "[data-test=environment]")).toBeNull();
    }
  });
});

describe("setup-mode-screen in Spanish", () => {
  it("offers every choice and the live warning in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      certificateNote: true,
      environment: "production",
    });
    expect(text(q(el, "h1")!)).toBe("Configura este servidor Waitron");
    expect(text(q(el, "[data-test=trust-help]")!)).toBe("abre la ayuda sobre el certificado");
    expect(text(q(el, "[data-test=production-warning]")!)).toBe(
      "Este servidor está marcado para producción: al configurarlo se envían registros reales a la AEAT.",
    );
    expect(q(el, "[data-test=choose-demo]")!.getAttribute("heading")).toBe("Demostración");
    expect(q(el, "[data-test=choose-existing]")!.getAttribute("heading")).toBe(
      "Unirse o recuperar",
    );
    expect(text(q(el, "h2")!)).toBe("¿Ya tienes un restaurante?");
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect(text(q(el, "h2")!)).toBe("Esto es permanente");
    expect(q(el, "[data-test=understand]")!.getAttribute("label")).toBe(
      "Entiendo que no se puede deshacer",
    );
    expect(text(q(el, "[data-test=confirm-live]")!)).toBe("Configurar este servidor en vivo");
  });

  it("switches language while mounted and keeps the live confirm open", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "h1")!)).toBe("Configura este servidor Waitron");
    expect(text(q(el, "[data-test=live-cancel]")!)).toBe("Volver");
  });
});
