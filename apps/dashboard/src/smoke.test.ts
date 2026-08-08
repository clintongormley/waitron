import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";

describe("dashboard app", () => {
  afterEach(cleanupWidgets);

  it("registers the custom element", () => {
    expect(customElements.get("dashboard-app")).toBeTruthy();
  });

  it("renders its shell into the shadow root", async () => {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {});
    expect(el.shadowRoot!.querySelector("main")).toBeTruthy();
  });
});
