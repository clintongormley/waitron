import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./role-screen.js";
import type { SetupRoleScreen } from "./role-screen.js";

type Emitted = { kind: "goto"; detail: unknown };

function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupRoleScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("setup-role-screen", () => {
  it("renders every way to join or recover an existing restaurant", async () => {
    const { el } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    expect(q(el, "[data-test=choose-mirror]")).not.toBeNull();
    expect(q(el, "[data-test=choose-restore]")).not.toBeNull();
    expect(q(el, "[data-test=choose-restore-bucket]")).not.toBeNull();
  });

  it("navigates to restore-bucket on the bucket choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-restore-bucket]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "restore-bucket" } }]);
  });

  it("navigates to connect on the mirror choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-mirror]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "connect" } }]);
  });

  it("navigates to restore on the backup choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-restore]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "restore" } }]);
  });

  it("steps back to the mode screen", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "mode" } }]);
  });
});

describe("setup-role-screen in Spanish", () => {
  const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();
  /** The heading the choice row draws in its own shadow root, and the copy slotted into it. */
  const row = (el: SetupRoleScreen, id: string): { heading: string; copy: string } => {
    const choice = q(el, `[data-test=${id}]`)!;
    expect(choice.localName).toBe("wt-choice-row");
    return {
      heading: text(choice.shadowRoot!.querySelector("[part=heading]")!),
      copy: text(choice),
    };
  };

  it("names every choice in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    expect(text(q(el, "h1")!)).toBe("Unirse a un restaurante existente o recuperarlo");
    expect(row(el, "choose-mirror")).toEqual({
      heading: "Añadir un nodo réplica",
      copy: "Añadir una réplica aún no está terminado en esta versión: este servidor puede unirse al principal, pero todavía no recibe los datos del restaurante, así que no puede sustituirlo. Para recuperar un restaurante, elige Restaurar desde una copia de seguridad o Restaurar desde mi bucket.",
    });
    expect(row(el, "choose-restore")).toEqual({
      heading: "Restaurar desde una copia de seguridad",
      copy: "Recupera el restaurante en este servidor nuevo desde una copia de seguridad cifrada de Waitron cuando no haya ningún otro servidor funcionando con datos más recientes del restaurante.",
    });
    expect(row(el, "choose-restore-bucket")).toEqual({
      heading: "Restaurar desde mi bucket",
      copy: "Reconstruye el restaurante en este servidor nuevo a partir de la copia continua de tu propio bucket de almacenamiento, cuando el servidor anterior ya no esté. Necesitas el paquete de recuperación o el archivo del kit.",
    });
    expect(text(q(el, "[data-test=back]")!)).toBe("Volver");
  });

  it("switches language while mounted", async () => {
    const { el } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    expect(text(q(el, "h1")!)).toBe("Join or recover an existing restaurant");
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "h1")!)).toBe("Unirse a un restaurante existente o recuperarlo");
    expect(text(q(el, "[data-test=back]")!)).toBe("Volver");
  });
});
