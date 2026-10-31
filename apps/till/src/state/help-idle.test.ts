import { LitElement, html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentHelpMode, setHelpMode } from "@waitron/ui";
import { HelpIdleController, KITCHEN_HELP_IDLE_MS } from "./help-idle.js";

class IdleHost extends LitElement {
  applies = true;
  onIdle = vi.fn();
  controller?: HelpIdleController;

  override render() {
    return html`<button>Touch</button>`;
  }

  get button(): HTMLButtonElement {
    return this.shadowRoot!.querySelector("button")!;
  }
}
customElements.define("till-test-idle-host", IdleHost);

const hosts: IdleHost[] = [];

async function mounted(options: { applies?: boolean; withOnIdle?: boolean; idleMs?: number } = {}) {
  const host = document.createElement("till-test-idle-host") as IdleHost;
  host.applies = options.applies ?? true;
  host.controller = new HelpIdleController(host, {
    applies: () => host.applies,
    ...(options.withOnIdle === false ? {} : { onIdle: host.onIdle }),
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
  });
  document.body.append(host);
  hosts.push(host);
  await host.updateComplete;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return host;
}

function touch(target: EventTarget, type: "pointerdown" | "keydown" = "pointerdown"): void {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

afterEach(() => {
  setHelpMode(false);
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
});

describe("HelpIdleController", () => {
  it("waits two minutes", () => {
    expect(KITCHEN_HELP_IDLE_MS).toBe(120_000);
  });

  it("help goes off two minutes after it was turned on, with no touch", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
    expect(host.onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
    expect(host.onIdle).toHaveBeenCalledTimes(1);
  });

  it.each(["pointerdown", "keydown"] as const)(
    "a %s inside the host starts the two minutes again",
    async (type) => {
      const host = await mounted();
      setHelpMode(true);
      vi.advanceTimersByTime(100_000);
      touch(host.button, type);
      vi.advanceTimersByTime(119_999);
      expect(currentHelpMode()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(currentHelpMode()).toBe(false);
    },
  );

  it("a touch a child stops from bubbling still counts", async () => {
    const host = await mounted();
    host.button.addEventListener("pointerdown", (event) => event.stopPropagation());
    setHelpMode(true);
    vi.advanceTimersByTime(100_000);
    touch(host.button);
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("a touch outside the host does not count", async () => {
    await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(100_000);
    touch(document.body);
    vi.advanceTimersByTime(20_000);
    expect(currentHelpMode()).toBe(false);
  });

  it("where it does not apply, help stays on", async () => {
    const host = await mounted({ applies: false });
    setHelpMode(true);
    vi.advanceTimersByTime(600_000);
    expect(currentHelpMode()).toBe(true);
    expect(host.onIdle).not.toHaveBeenCalled();
  });

  it("turning help off by hand stops the clock, and on again starts a fresh two minutes", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(60_000);
    setHelpMode(false);
    vi.advanceTimersByTime(600_000);
    expect(host.onIdle).not.toHaveBeenCalled();
    setHelpMode(true);
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
    expect(host.onIdle).toHaveBeenCalledTimes(1);
  });

  it("once the host leaves the page its clock and listeners stop", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(60_000);
    host.remove();
    vi.advanceTimersByTime(600_000);
    expect(currentHelpMode()).toBe(true);
    expect(host.onIdle).not.toHaveBeenCalled();
  });

  it("back in the page with help on, it starts a fresh two minutes", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(60_000);
    host.remove();
    vi.advanceTimersByTime(600_000);
    document.body.append(host);
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("when it starts to apply while help is on, the two minutes start", async () => {
    const host = await mounted({ applies: false });
    setHelpMode(true);
    vi.advanceTimersByTime(600_000);
    host.applies = true;
    host.requestUpdate();
    await host.updateComplete;
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("a host update with no touch does not start the two minutes again", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(100_000);
    host.requestUpdate();
    await host.updateComplete;
    vi.advanceTimersByTime(19_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("when it stops applying, the clock stops", async () => {
    const host = await mounted();
    setHelpMode(true);
    vi.advanceTimersByTime(60_000);
    host.applies = false;
    host.requestUpdate();
    await host.updateComplete;
    vi.advanceTimersByTime(600_000);
    expect(currentHelpMode()).toBe(true);
    expect(host.onIdle).not.toHaveBeenCalled();
  });

  it("after the host leaves the page, turning help on starts no clock", async () => {
    const host = await mounted();
    host.remove();
    setHelpMode(true);
    vi.advanceTimersByTime(600_000);
    expect(currentHelpMode()).toBe(true);
    expect(host.onIdle).not.toHaveBeenCalled();
  });

  it("without onIdle it still turns help off", async () => {
    await mounted({ withOnIdle: false });
    setHelpMode(true);
    vi.advanceTimersByTime(120_000);
    expect(currentHelpMode()).toBe(false);
  });

  it("idleMs sets the wait", async () => {
    await mounted({ idleMs: 5_000 });
    setHelpMode(true);
    vi.advanceTimersByTime(4_999);
    expect(currentHelpMode()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(currentHelpMode()).toBe(false);
  });

  it("a touch while help is off starts no clock", async () => {
    const host = await mounted();
    touch(host.button);
    vi.advanceTimersByTime(600_000);
    setHelpMode(true);
    vi.advanceTimersByTime(119_999);
    expect(currentHelpMode()).toBe(true);
  });
});
