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
  it("USB offers Prepare, Start a new restaurant and Join or recover, sharing rounded edges", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      installationOrigin: "usb",
      environment: "preproduction",
    });
    expect(q(el, "[data-test=choose-demo]")).toBeNull();
    const rows = [...el.shadowRoot!.querySelectorAll(".choices > wt-choice-row")];
    expect(rows.map((row) => row.getAttribute("data-test"))).toEqual([
      "choose-prepare",
      "choose-live",
      "choose-existing",
    ]);
    const [prepare, live, existing] = rows.map(rowBox);
    expect(prepare!.top).not.toEqual(["0px", "0px"]);
    expect(prepare!.bottom).toEqual(["0px", "0px"]);
    expect(live!.top).toEqual(["0px", "0px"]);
    expect(live!.bottom).toEqual(["0px", "0px"]);
    expect(existing!.bottom).toEqual(prepare!.top);
    expect(live!.rect.top).toBe(prepare!.rect.bottom);
    expect(existing!.rect.top).toBe(live!.rect.bottom);
    const events = collect(host);
    q(el, "[data-test=choose-prepare]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "prepare" } } },
      { kind: "goto", detail: { screen: "admin" } },
    ]);
    events.length = 0;
    q(el, "[data-test=choose-existing]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "role" } }]);
  });

  it("USB production still hides Prepare", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      installationOrigin: "usb",
      environment: "production",
    });
    expect(q(el, "[data-test=choose-demo]")).toBeNull();
    expect(q(el, "[data-test=choose-prepare]")).toBeNull();
    expect(q(el, "[data-test=choose-live]")).not.toBeNull();
  });

  it("offers Demo, Prepare, Start a new restaurant and Join or recover as four rows, each a whole-row choice", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(text(q(el, "h1")!)).toBe("Set up this box");
    const rows = [...el.shadowRoot!.querySelectorAll(".choices > wt-choice-row")];
    expect(rows.map((row) => row.getAttribute("data-test"))).toEqual([
      "choose-demo",
      "choose-prepare",
      "choose-live",
      "choose-existing",
    ]);
    expect(rows.map((row) => row.getAttribute("heading"))).toEqual([
      "Demo",
      "Prepare your restaurant",
      "Start a new restaurant",
      "Join or recover a restaurant",
    ]);
    expect(rows.map((row) => text(row))).toEqual([
      "A practice box. Nothing is sent to the tax agency, so it is safe to explore and throw away.",
      "Enter your real menus, staff and layouts, then practise with test payments. Nothing is sent to the tax agency.",
      "Every sale is sent to the tax agency (AEAT). You can't change this later.",
      "Add this box as a spare for a restaurant that's already running, or bring one back from a backup.",
    ]);
  });

  it("draws the four choices as one rounded box with a line between rows", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const [demo, prepare, live, existing] = [
      ...el.shadowRoot!.querySelectorAll(".choices > wt-choice-row"),
    ].map(rowBox);
    expect(prepare!.rect.top).toBe(demo!.rect.bottom);
    expect(live!.rect.top).toBe(prepare!.rect.bottom);
    expect(existing!.rect.top).toBe(live!.rect.bottom);
    expect([prepare!.lineAbove, live!.lineAbove, existing!.lineAbove]).toEqual([
      "1px",
      "1px",
      "1px",
    ]);
    expect(demo!.top).not.toEqual(["0px", "0px"]);
    expect([
      demo!.bottom,
      prepare!.top,
      prepare!.bottom,
      live!.top,
      live!.bottom,
      existing!.top,
    ]).toEqual(Array(6).fill(["0px", "0px"]));
    expect(existing!.bottom).toEqual(demo!.top);
  });

  it("draws no intro paragraph, no section heading and no other-box line when no other box was found", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "production",
    });
    expect(el.shadowRoot!.querySelectorAll("p")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector("h2")).toBeNull();
    expect(q(el, "[data-test=other-box]")).toBeNull();
    expect(el.shadowRoot!.querySelectorAll(".choices")).toHaveLength(1);
  });

  describe("when another box answers the venue's name", () => {
    it("says so, leads with Join it as a spare, then the other choices under their own heading", async () => {
      const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
        environment: "preproduction",
        otherBoxFound: true,
      });
      expect(text(q(el, "h1")!)).toBe("Set up this box");
      expect(text(q(el, "[data-test=other-box]")!)).toBe(
        "Another Waitron box is already running a restaurant on this network.",
      );
      const lists = [...el.shadowRoot!.querySelectorAll(".choices")];
      expect(lists).toHaveLength(2);
      const rowsOf = (list: Element) =>
        [...list.querySelectorAll(":scope > wt-choice-row")].map((row) => ({
          test: row.getAttribute("data-test"),
          heading: row.getAttribute("heading"),
          copy: text(row),
        }));
      expect(rowsOf(lists[0]!)).toEqual([
        {
          test: "choose-join-spare",
          heading: "Join it as a spare",
          copy: "Add this box as a spare for the restaurant that's already running. It can take over if the main box fails.",
        },
      ]);
      expect(rowsOf(lists[1]!).map((row) => row.test)).toEqual([
        "choose-demo",
        "choose-prepare",
        "choose-live",
        "choose-recover",
      ]);
      expect(rowsOf(lists[1]!)[3]).toEqual({
        test: "choose-recover",
        heading: "Recover a restaurant",
        copy: "Bring a restaurant back from a backup.",
      });
      const heading = q(el, "h2")!;
      expect(text(heading)).toBe("Other choices");
      expect(
        lists[0]!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        heading.compareDocumentPosition(lists[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(q(el, "[data-test=choose-existing]")).toBeNull();
    });

    it("a production box offers Join it as a spare, Start a new restaurant and Recover a restaurant only", async () => {
      const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
        environment: "production",
        otherBoxFound: true,
      });
      const tests = [...el.shadowRoot!.querySelectorAll("wt-choice-row")].map((row) =>
        row.getAttribute("data-test"),
      );
      expect(tests).toEqual(["choose-join-spare", "choose-live", "choose-recover"]);
    });

    it("Join it as a spare opens the join page directly, writing no mode", async () => {
      const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
        otherBoxFound: true,
      });
      const events = collect(host);
      q(el, "[data-test=choose-join-spare]")!.click();
      expect(events).toEqual([{ kind: "goto", detail: { screen: "connect" } }]);
    });

    it("Recover a restaurant opens the restore page directly, writing no mode", async () => {
      const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
        otherBoxFound: true,
      });
      const events = collect(host);
      q(el, "[data-test=choose-recover]")!.click();
      expect(events).toEqual([{ kind: "goto", detail: { screen: "restore" } }]);
    });

    it("asks beforeChoice first, as a mode-less choice, and goes nowhere until it proceeds", async () => {
      const asked: { mode: unknown; proceed: () => void }[] = [];
      const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
        otherBoxFound: true,
        beforeChoice: (mode: unknown, proceed: () => void) => asked.push({ mode, proceed }),
      });
      const events = collect(host);
      q(el, "[data-test=choose-join-spare]")!.click();
      q(el, "[data-test=choose-recover]")!.click();
      expect(asked.map((a) => a.mode)).toEqual([undefined, undefined]);
      expect(events).toEqual([]);
      asked[0]!.proceed();
      asked[1]!.proceed();
      expect(events).toEqual([
        { kind: "goto", detail: { screen: "connect" } },
        { kind: "goto", detail: { screen: "restore" } },
      ]);
    });
  });

  it("draws no extra buttons beside the rows", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(el.shadowRoot!.querySelectorAll("wt-button")).toHaveLength(0);
  });

  it("says nothing about certificates", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(q(el, "[data-test=cert-note]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("certificate");
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

  it.each(["production", "preproduction"] as const)(
    "draws no production line: the Start a new restaurant choice says sales go to AEAT (%s)",
    async (environment) => {
      const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", { environment });
      expect(q(el, "[data-test=production-warning]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    },
  );

  it("a production box draws Start a new restaurant and Join or recover a restaurant only", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "production",
    });
    expect(q(el, "[data-test=choose-demo]")).toBeNull();
    expect(q(el, "[data-test=choose-prepare]")).toBeNull();
    expect(q(el, "[data-test=choose-live]")).not.toBeNull();
    expect(q(el, "[data-test=choose-existing]")).not.toBeNull();
  });

  it.each([{ environment: "preproduction" as const }, {}])(
    "a box that is not production draws all four choices (%o)",
    async (props) => {
      const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", props);
      for (const choice of ["demo", "prepare", "live", "existing"]) {
        expect(q(el, `[data-test=choose-${choice}]`)).not.toBeNull();
      }
    },
  );

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
      environment: "production",
    });
    expect(text(q(el, "h1")!)).toBe("Configura este servidor");
    const { el: practice } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "preproduction",
    });
    const rows = [...practice.shadowRoot!.querySelectorAll(".choices > wt-choice-row")];
    expect(rows.map((row) => [row.getAttribute("heading"), text(row)])).toEqual([
      [
        "Demostración",
        "Un servidor de práctica. No se envía nada a la AEAT, así que puedes explorarlo y descartarlo sin riesgo.",
      ],
      [
        "Prepara tu restaurante",
        "Introduce tus cartas, tu personal y tus planos reales, y practica con pagos de prueba. No se envía nada a la AEAT.",
      ],
      [
        "Empezar un restaurante nuevo",
        "Cada venta se envía a la AEAT. No podrás cambiarlo después.",
      ],
      [
        "Unirse a un restaurante o recuperarlo",
        "Añade este servidor como reserva de un restaurante que ya está en marcha, o recupera uno desde una copia de seguridad.",
      ],
    ]);
    const { el: found } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "production",
      otherBoxFound: true,
    });
    expect(text(q(found, "[data-test=other-box]")!)).toBe(
      "Ya hay otro servidor Waitron con un restaurante en marcha en esta red.",
    );
    expect(q(found, "[data-test=choose-join-spare]")!.getAttribute("heading")).toBe(
      "Unirse como reserva",
    );
    expect(text(q(found, "[data-test=choose-join-spare]")!)).toBe(
      "Añade este servidor como reserva del restaurante que ya está en marcha. Puede tomar el relevo si el servidor principal falla.",
    );
    expect(text(q(found, "h2")!)).toBe("Otras opciones");
    expect(q(found, "[data-test=choose-recover]")!.getAttribute("heading")).toBe(
      "Recuperar un restaurante",
    );
    expect(text(q(found, "[data-test=choose-recover]")!)).toBe(
      "Recupera un restaurante desde una copia de seguridad.",
    );
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect(text(q(el, "h2")!)).toBe("Esto es permanente");
    expect(q(el, "[data-test=understand]")!.getAttribute("label")).toBe(
      "Entiendo que no se puede deshacer",
    );
    expect(text(q(el, "[data-test=confirm-live]")!)).toBe("Empezar un restaurante nuevo");
  });

  it("switches language while mounted and keeps the live confirm open", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "h1")!)).toBe("Configura este servidor");
    expect(text(q(el, "[data-test=live-cancel]")!)).toBe("Volver");
  });
});
