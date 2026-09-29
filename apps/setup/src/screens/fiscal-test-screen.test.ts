import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupFiscalTestScreen } from "./fiscal-test-screen.js";

afterEach(cleanupWidgets);

describe("SetupFiscalTestScreen", () => {
  it("explains the AEAT test submission and requests it explicitly", async () => {
    const { el, host } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {});
    const requested = vi.fn();
    host.addEventListener("fiscal-test-requested", requested);
    expect(el.shadowRoot!.textContent).toContain("AEAT test service");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=run]")!.click();
    expect(requested).toHaveBeenCalledOnce();
  });

  it("only offers Continue after an accepted submission", async () => {
    const pending = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      status: "uncertain",
    });
    expect(pending.el.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();
    const accepted = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      status: "accepted",
    });
    expect(accepted.el.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
  });

  it("continues to review after an accepted submission", async () => {
    const { el, host } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      status: "accepted",
    });
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "review",
    ]);
  });

  it("steps back to the certificate screen", async () => {
    const { el, host } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {});
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>(".actions wt-button[variant=ghost]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "cert",
    ]);
  });

  it("announces a request failure when there is no AEAT result", async () => {
    const { el } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      errorMessage: "The fiscal test could not be started.",
    });
    const alert = el.shadowRoot!.querySelector("[role=alert]");
    expect(alert?.textContent).toBe("The fiscal test could not be started.");
  });
});

describe("SetupFiscalTestScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("explains the test and its outcome in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      status: "rejected",
    });
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Comprueba la preparación fiscal");
    expect(el.shadowRoot!.textContent).toContain("servicio de pruebas de la AEAT");
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      "La AEAT ha rechazado el envío de prueba.",
    );
    expect(el.shadowRoot!.querySelector("[data-test=run]")?.textContent).toBe(
      "Hacer la prueba fiscal",
    );
  });

  it("switches language live", async () => {
    const { el } = await mountWidget<SetupFiscalTestScreen>("setup-fiscal-test-screen", {
      running: true,
    });
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=run]")?.textContent).toBe(
      "Haciendo la prueba…",
    );
  });
});
