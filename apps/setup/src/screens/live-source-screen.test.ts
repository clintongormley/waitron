import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupLiveSourceScreen } from "./live-source-screen.js";

afterEach(cleanupWidgets);

describe("SetupLiveSourceScreen", () => {
  it("offers a separate empty production path", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const patch = vi.fn();
    const goto = vi.fn();
    host.addEventListener("setup-patch", patch);
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=empty]")!.click();
    expect((patch.mock.calls[0]![0] as CustomEvent).detail.patch).toEqual({
      configurationImport: false,
    });
    expect((goto.mock.calls[0]![0] as CustomEvent).detail.screen).toBe("admin");
  });

  it("requires the export and a twelve-character passphrase", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const requested = vi.fn();
    host.addEventListener("configuration-requested", requested);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=import]")!.click();
    await el.updateComplete;
    expect(requested).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-test=field-error]")).toHaveLength(2);
    expect(el.shadowRoot!.querySelector("input[type=file]")?.getAttribute("name")).toBe(
      "configuration-export",
    );
  });

  it("lets the operator reveal and hide the export passphrase", async () => {
    const { el } = await mountWidget<SetupLiveSourceScreen>("setup-live-source-screen", {});
    const passphrase = el.shadowRoot!.querySelector("wt-input")!;
    expect(passphrase.getAttribute("type")).toBe("password");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-passphrase]")!.click();
    await el.updateComplete;
    expect(passphrase.getAttribute("type")).toBe("text");
  });
});
