import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import { RotaView } from "./rota-view.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Rota accessibility (%s)", (theme) => {
  test.each(["draft", "published", "empty", "loading", "error", "picker"])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const client = rotaApi(async (week) => {
      if (state === "loading") return new Promise(() => undefined);
      if (state === "error") throw { code: "connection.failed" };
      const read = rotaWeek(week);
      if (state === "empty") {
        read.areas = [];
        read.people = [];
        read.staffRoles = [];
      }
      if (state === "published")
        read.version = { id: "published", status: "published", changedSincePublished: false };
      return read;
    });
    const el = new RotaView();
    el.api = client.api;
    el.week = "2026-11-30";
    el.canWrite = true;
    el.open = () => undefined;
    host.append(el);
    if (state === "loading")
      await vi.waitFor(() => expect(el.shadowRoot?.textContent).toContain("Loading rota"));
    else if (state === "error")
      await vi.waitFor(() => expect(el.shadowRoot?.querySelector("[role=alert]")).toBeTruthy());
    else if (state === "empty")
      await vi.waitFor(() => expect(el.shadowRoot?.textContent).toContain("No active areas"));
    else await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-area")).toBeTruthy());
    if (state === "picker") {
      const area = el.shadowRoot!.querySelector("rota-by-area")!;
      await (area as import("lit").LitElement).updateComplete;
      area.shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("slot-picker")).toBeTruthy();
    }
    await expectNoA11yViolations(host);
  });
});
