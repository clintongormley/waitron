import { afterEach, describe, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { StoreChangeController } from "./store-controller.js";
import { WorkingOrderStore } from "./working-order.js";

@customElement("store-change-probe")
class StoreChangeProbe extends LitElement {
  @property({ attribute: false }) store!: WorkingOrderStore;
  heard: WorkingOrderStore[] = [];

  constructor() {
    super();
    new StoreChangeController(
      this,
      () => this.store,
      "changed",
      () => this.heard.push(this.store),
    );
  }
}

afterEach(() => cleanupWidgets());

describe("StoreChangeController", () => {
  it("follows a store assigned while the host is connected", async () => {
    const first = new WorkingOrderStore();
    const second = new WorkingOrderStore();
    const { el } = await mountWidget<StoreChangeProbe>("store-change-probe", { store: first });
    el.store = second;
    await el.updateComplete;
    first.sending = true;
    expect(el.heard).toEqual([]);
    second.sending = true;
    expect(el.heard).toEqual([second]);
  });

  it("listens to nothing while disconnected, and once to the current store on reconnecting", async () => {
    const first = new WorkingOrderStore();
    const second = new WorkingOrderStore();
    const { el, host } = await mountWidget<StoreChangeProbe>("store-change-probe", {
      store: first,
    });
    el.remove();
    el.store = second;
    await el.updateComplete;
    second.sending = true;
    expect(el.heard).toEqual([]);
    host.appendChild(el);
    await el.updateComplete;
    first.sending = true;
    second.sending = false;
    expect(el.heard).toEqual([second]);
  });

  it("does not subscribe again when the host updates with the same store", async () => {
    const store = new WorkingOrderStore();
    const on = vi.spyOn(store, "on");
    const { el } = await mountWidget<StoreChangeProbe>("store-change-probe", { store });
    el.requestUpdate();
    await el.updateComplete;
    el.store = store;
    el.requestUpdate();
    await el.updateComplete;
    store.sending = true;
    expect(el.heard).toEqual([store]);
    expect(on).toHaveBeenCalledTimes(1);
  });
});
