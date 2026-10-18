import { LitElement, html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HelpModeController,
  currentHelpMode,
  setHelpMode,
  subscribeHelpMode,
} from "./help-mode.js";

class HelpModeProbe extends LitElement {
  readonly #help = new HelpModeController(this);
  renders = 0;
  override render() {
    this.renders += 1;
    return html`<span>${this.#help.on ? "on" : "off"}</span>`;
  }
}
customElements.define("help-mode-probe", HelpModeProbe);

afterEach(() => {
  vi.restoreAllMocks();
  setHelpMode(false);
  for (const probe of document.querySelectorAll("help-mode-probe")) probe.remove();
});

async function mount(): Promise<HelpModeProbe> {
  const probe = document.createElement("help-mode-probe") as HelpModeProbe;
  document.body.append(probe);
  await probe.updateComplete;
  return probe;
}

function shown(probe: HelpModeProbe): string | null | undefined {
  return probe.shadowRoot?.querySelector("span")?.textContent;
}

describe("the help switch", () => {
  it("starts off", () => {
    expect(currentHelpMode()).toBe(false);
  });

  it("turning it on tells every listener once", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeHelpMode(first);
    const stopSecond = subscribeHelpMode(second);
    setHelpMode(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(currentHelpMode()).toBe(true);
    stopFirst();
    stopSecond();
  });

  it("setting the value it already has tells nobody", () => {
    const listener = vi.fn();
    const stop = subscribeHelpMode(listener);
    setHelpMode(false);
    setHelpMode(true);
    setHelpMode(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("an unsubscribed listener hears nothing more", () => {
    const gone = vi.fn();
    const kept = vi.fn();
    const stopGone = subscribeHelpMode(gone);
    const stopKept = subscribeHelpMode(kept);
    stopGone();
    setHelpMode(true);
    setHelpMode(false);
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(2);
    stopKept();
  });

  it("a probe redraws when help changes", async () => {
    const probe = await mount();
    expect(shown(probe)).toBe("off");
    setHelpMode(true);
    await probe.updateComplete;
    expect(shown(probe)).toBe("on");
  });

  it("a probe out of the page is not redrawn, and shows the current state when it comes back", async () => {
    const probe = await mount();
    probe.remove();
    const requestUpdate = vi.spyOn(probe, "requestUpdate");
    setHelpMode(true);
    expect(requestUpdate).not.toHaveBeenCalled();
    requestUpdate.mockRestore();
    document.body.append(probe);
    await probe.updateComplete;
    expect(shown(probe)).toBe("on");
  });

  it("nothing is saved", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setHelpMode(true);
    setHelpMode(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
