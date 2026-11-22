import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./reset-screen.js";
import type { SetupResetScreen } from "./reset-screen.js";

const q = (el: SetupResetScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

function collect(host: HTMLElement): unknown[] {
  const events: unknown[] = [];
  host.addEventListener("reset-requested", (e) => events.push((e as CustomEvent).detail));
  return events;
}

/** The one message above the reset button, as `wt-form-actions` shows it. */
async function bottomOf(el: SetupResetScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

/** Every alert in the screen and in its action row. */
async function alerts(el: SetupResetScreen): Promise<Element[]> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions");
  await actions?.updateComplete;
  return [
    ...el.shadowRoot!.querySelectorAll("[role=alert]"),
    ...(actions?.shadowRoot!.querySelectorAll("[role=alert]") ?? []),
  ];
}

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup-reset-screen", () => {
  it("says what the reset does to this server and that it changes nothing on the primary", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reset this server");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("half-finished join");
    expect(text).toContain("Nothing on the primary server is changed");
  });

  it("says how to take this server off the primary's list", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(
      "To take it off that list, open the primary's dashboard, then System, then Servers, open this server's row menu and choose Remove, then open the row menu again and choose Clear from list.",
    );
    expect(text).toContain("If its row already says Removed, only Clear from list is needed.");
    expect(text).toContain(
      "Do this before you join this server again: otherwise the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
    );
  });

  it.each([
    [
      "en-GB",
      "To take it off that list, open the primary's Servers page and, in this server's row menu, choose Remove, then Clear from list (only Clear from list if the row already says Removed). Do this before you join this server again, or the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
      "Servers page",
    ],
    [
      "es-ES",
      "Para quitarlo de esa lista, abre la página Servidores del principal y, en el menú de la fila de este servidor, elige Retirar y después Quitar de la lista (solo Quitar de la lista si la fila ya dice Retirado). Hazlo antes de volver a unir este servidor, o la nueva unión añade una segunda fila difícil de distinguir de esta, o se rechaza si la lista está llena.",
      "página Servidores",
    ],
  ] as const)(
    "links to the primary's Servers page when its address is known (%s)",
    async (locale, words, label) => {
      setLocale(locale);
      const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
        serversUrl: "https://waitron.local/servers",
      });
      const link = q(el, "[data-test=servers-link]") as HTMLAnchorElement;
      expect(link.href).toBe("https://waitron.local/servers");
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
      expect(link.textContent!.trim()).toBe(label);
      const text = q(el, "[data-test=remove-from-list]")!.textContent!.replace(/\s+/g, " ").trim();
      expect(text).toBe(words);
    },
  );

  it("has no Servers link when the primary's address is not known", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "[data-test=servers-link]")).toBeNull();
  });

  it("asks for nothing and emits reset-requested carrying nothing", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(0);
    expect(await bottomOf(el)).toBe("");
    q(el, "[data-test=reset]")!.click();
    expect(events).toEqual([null]);
  });

  it("disables the reset button and reads Resetting… while the reset is in flight", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", { busy: true });
    const events = collect(host);
    const reset = q(el, "[data-test=reset]")!;
    expect(reset.hasAttribute("disabled")).toBe(true);
    expect(reset.textContent!.trim()).toBe("Resetting…");
    reset.click();
    expect(events).toEqual([]);
  });

  it("shows a routed-back message as one alert above the reset button, leaving it working", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "The server could not be reset.",
    });
    expect(await bottomOf(el)).toBe("The server could not be reset.");
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(false);
  });

  it("drops a routed-back message when the reset is asked for again, and shows a new refusal", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "The server could not be reset.",
      refusal: {},
    });
    const events = collect(host);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(await bottomOf(el)).toBe("");
    el.refusal = {};
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("The server could not be reset.");
  });

  it("steps back to the provisioning message without resetting", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    const gotos: unknown[] = [];
    host.addEventListener("setup-goto", (e) => gotos.push((e as CustomEvent).detail));
    expect(q(el, "[data-test=back]")!.getAttribute("variant")).toBe("ghost");
    q(el, "[data-test=back]")!.click();
    expect(gotos).toEqual([{ screen: "provisioning" }]);
    expect(events).toEqual([]);
  });

  it("replaces the form with the restart message and a Reload once the reset is staged", async () => {
    const reload = vi.fn();
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      outcome: { kind: "resetting", message: "The server is resetting and will restart." },
      reload,
    });
    const status = q(el, "[data-test=outcome]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("resetting and will restart");
    expect(q(el, "[data-test=reset]")).toBeNull();
    expect(q(el, "[data-test=back]")).toBeNull();
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("replaces the form with a refusal alert and a Reload when the reset cannot run", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      outcome: { kind: "refused", message: "There is no half-finished join to reset." },
      reload: vi.fn(),
    });
    const alert = q(el, "[data-test=outcome]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("no half-finished join");
    expect(q(el, "[data-test=reset]")).toBeNull();
    expect(q(el, "[data-test=reload]")!.textContent!.trim()).toBe("Reload");
  });

  it("shows the in-flight button and the outcome in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", { busy: true });
    expect(q(el, "[data-test=reset]")!.textContent!.trim()).toBe("Restableciendo…");
    el.outcome = { kind: "resetting", message: "El servidor se está restableciendo." };
    await el.updateComplete;
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restableciendo este servidor");
    expect(q(el, "[data-test=reload]")!.textContent!.trim()).toBe("Recargar");
  });

  it("shows the screen in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restablecer este servidor");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("No se cambia nada en el servidor principal");
    expect(q(el, "[data-test=back]")!.textContent!.trim()).toBe("Volver");
    expect(q(el, "[data-test=reset]")!.textContent!.trim()).toBe("Restablecer este servidor");
  });

  it("redraws in Spanish on a live language switch", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reset this server");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restablecer este servidor");
  });
});
