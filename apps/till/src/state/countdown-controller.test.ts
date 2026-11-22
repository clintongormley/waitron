import { afterEach, describe, expect, it, vi } from "vitest";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { CountdownController } from "./countdown-controller.js";

@customElement("countdown-probe")
class CountdownProbe extends LitElement {
  readonly countdown = new CountdownController(this);
  override render() {
    return html`<span>${this.countdown.remaining}</span>`;
  }
}

const shown = (el: CountdownProbe) => el.shadowRoot!.textContent!.trim();

afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
});

describe("CountdownController", () => {
  it("counts whole seconds down to zero, repainting its host at each", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    expect(shown(el)).toBe("0");

    el.countdown.start(3);
    await el.updateComplete;
    expect(shown(el)).toBe("3");

    await vi.advanceTimersByTimeAsync(999);
    await el.updateComplete;
    expect(shown(el)).toBe("3");
    await vi.advanceTimersByTimeAsync(1);
    await el.updateComplete;
    expect(shown(el)).toBe("2");

    await vi.advanceTimersByTimeAsync(2000);
    await el.updateComplete;
    expect(shown(el)).toBe("0");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rounds a part second up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    el.countdown.start(1.2);
    await el.updateComplete;
    expect(shown(el)).toBe("2");
    await vi.advanceTimersByTimeAsync(200);
    await el.updateComplete;
    expect(shown(el)).toBe("1");
    await vi.advanceTimersByTimeAsync(1000);
    await el.updateComplete;
    expect(shown(el)).toBe("0");
  });

  it("reads the clock, so a late timer never stretches the wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 5_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
      el.countdown.start(10);
      now += 7_400;
      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect(shown(el)).toBe("3");
      now += 5_000;
      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect(shown(el)).toBe("0");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("checks again when a timer fires before the second is up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
      el.countdown.start(2);
      now = 990;
      await vi.advanceTimersByTimeAsync(1000);
      await el.updateComplete;
      expect(shown(el)).toBe("2");
      expect(vi.getTimerCount()).toBe(1);
      now = 1000;
      await vi.advanceTimersByTimeAsync(10);
      await el.updateComplete;
      expect(shown(el)).toBe("1");
    } finally {
      clock.mockRestore();
    }
  });

  it("starts nothing for no time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    el.countdown.start(0);
    await el.updateComplete;
    expect(shown(el)).toBe("0");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new start replaces the running count", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    el.countdown.start(3);
    await vi.advanceTimersByTimeAsync(2000);
    el.countdown.start(5);
    await el.updateComplete;
    expect(shown(el)).toBe("5");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stop ends the count at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    el.countdown.start(30);
    await el.updateComplete;
    el.countdown.stop();
    await el.updateComplete;
    expect(shown(el)).toBe("0");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when its host leaves the page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { el } = await mountWidget<CountdownProbe>("countdown-probe", {});
    el.countdown.start(30);
    el.remove();
    expect(el.countdown.remaining).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
