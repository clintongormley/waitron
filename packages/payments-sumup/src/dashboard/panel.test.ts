import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { SUMUP_PANEL } from "./index.js";
import type { SumUpConnectForm } from "./sumup-connect-form.js";
import type { SumUpAddReader } from "./sumup-add-reader.js";

const hosts: HTMLElement[] = [];
function host(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  hosts.push(el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

describe("SUMUP_PANEL", () => {
  it("names the sumup provider and registers its strings", () => {
    expect(SUMUP_PANEL.providerId).toBe("sumup");
    expect(SUMUP_PANEL.displayNameKey).toBe("payments.sumup.name");
    expect(SUMUP_PANEL.strings.en["payments.sumup.name"]).toBe("SumUp");
    expect(SUMUP_PANEL.strings.es["payments.sumup.name"]).toBe("SumUp");
  });

  it("renders the connect form wired to the request and onConnected", () => {
    const h = host();
    const request = vi.fn() as unknown as DashboardRequest;
    const onConnected = vi.fn();
    render(SUMUP_PANEL.renderConnectForm({ request, onConnected }), h);
    const form = h.querySelector("sumup-connect-form") as SumUpConnectForm;
    expect(form.request).toBe(request);
    expect(form.onConnected).toBe(onConnected);
  });

  it("renders the add-reader dialog wired to the request and callbacks", () => {
    const h = host();
    const request = vi.fn() as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(SUMUP_PANEL.renderAddReader({ request, onAdded, onClose }), h);
    const dialog = h.querySelector("sumup-add-reader") as SumUpAddReader;
    expect(dialog.request).toBe(request);
    expect(dialog.onAdded).toBe(onAdded);
    expect(dialog.onClose).toBe(onClose);
  });
});
