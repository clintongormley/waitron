import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TickingClock } from "./ticking-clock.js";

class StubHost {
  updates = 0;
  controllers: { hostConnected?(): void; hostDisconnected?(): void }[] = [];
  addController(c: { hostConnected?(): void; hostDisconnected?(): void }) {
    this.controllers.push(c);
  }
  requestUpdate() {
    this.updates++;
  }
}

/** A real Lit host, because what the constructor has to get right is handing itself to the host:
 * nothing here calls hostConnected, so only a registered controller ever starts ticking. */
class TickingWidget extends LitElement {
  readonly clock = new TickingClock(this, 1000);

  override render() {
    return html`<span>${this.clock.now}</span>`;
  }
}
customElements.define("ticking-clock-widget", TickingWidget);

describe("TickingClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances now and requests an update each interval while connected", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    const first = clock.now;
    vi.advanceTimersByTime(3000);
    expect(clock.now).toBeGreaterThanOrEqual(first);
    expect(host.updates).toBe(3);
  });

  it("stops ticking after disconnect", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    clock.hostDisconnected();
    vi.advanceTimersByTime(5000);
    expect(host.updates).toBe(0);
  });

  it("does not leak a second interval when hostConnected runs twice without a disconnect in between", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    clock.hostConnected(); // reconnect / DOM adoption without an intervening hostDisconnected
    vi.advanceTimersByTime(3000);
    // One interval firing three times, not two intervals firing three times each (6).
    expect(host.updates).toBe(3);
  });

  it("advances a real host's rendering from the moment that host connects", async () => {
    const widget = new TickingWidget();
    const startedAt = Date.now();
    document.body.append(widget);
    try {
      await widget.updateComplete;
      expect(widget.shadowRoot!.textContent).toBe(String(startedAt));

      vi.advanceTimersByTime(1000);
      await widget.updateComplete;

      expect(widget.shadowRoot!.textContent).toBe(String(startedAt + 1000));
    } finally {
      widget.remove();
    }
  });
});
