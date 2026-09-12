import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { STRIPE_PANEL } from "./index.js";
import type { StripeConnectForm } from "./stripe-connect-form.js";
import type { StripeAddReader } from "./stripe-add-reader.js";

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

describe("STRIPE_PANEL", () => {
  it("names the stripe provider and registers its strings", () => {
    expect(STRIPE_PANEL.providerId).toBe("stripe");
    expect(STRIPE_PANEL.displayNameKey).toBe("payments.stripe.name");
    expect(STRIPE_PANEL.strings.en["payments.stripe.name"]).toBe("Stripe");
    expect(STRIPE_PANEL.strings.es["payments.stripe.name"]).toBe("Stripe");
  });

  it("renders the connect form wired to the request and onConnected", () => {
    const h = host();
    const request = vi.fn() as unknown as DashboardRequest;
    const onConnected = vi.fn();
    render(STRIPE_PANEL.renderConnectForm({ request, onConnected }), h);
    const form = h.querySelector("stripe-connect-form") as StripeConnectForm;
    expect(form.request).toBe(request);
    expect(form.onConnected).toBe(onConnected);
  });

  it("renders the add-reader dialog wired to the request and callbacks", () => {
    const h = host();
    const request = vi.fn() as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(STRIPE_PANEL.renderAddReader({ request, onAdded, onClose }), h);
    const dialog = h.querySelector("stripe-add-reader") as StripeAddReader;
    expect(dialog.request).toBe(request);
    expect(dialog.onAdded).toBe(onAdded);
    expect(dialog.onClose).toBe(onClose);
  });
});
