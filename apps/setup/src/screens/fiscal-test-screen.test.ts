import { afterEach, describe, expect, it, vi } from "vitest";
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
});
