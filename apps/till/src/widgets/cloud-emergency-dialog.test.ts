import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { WtDialog } from "@waitron/ui";
import { BUILT_IN_ROLE_NAMES } from "@waitron/shared";
import { TillCloudEmergencyDialog } from "./cloud-emergency-dialog.js";

let locale = currentLocale();
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const entrance = {
  address: "https://emergency.example.test",
  roles: [
    { builtInKey: "admin" as const, name: null },
    { builtInKey: null, name: "Night lead" },
  ],
};

it("shows the emergency address, requirements, roles and QR without offering an activation", async () => {
  const { el } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance,
  });
  const text = el.shadowRoot?.textContent ?? "";
  expect(text).toContain(entrance.address);
  expect(text).toContain("emergency code");
  expect(text).toContain("password");
  expect(text).toContain("authenticator");
  expect(text).toContain("recovery code");
  expect(text).toContain("Admin");
  expect(text).toContain("Night lead");
  expect(el.shadowRoot!.querySelector("[data-emergency-qr] svg")).not.toBeNull();
  const frame = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await frame.updateComplete;
  const native = frame.shadowRoot!.querySelector("dialog")!;
  await vi.waitFor(() => expect(native.open).toBe(true));
  expect(native.matches(":focus-within")).toBe(true);
});

it("translates built-in roles, keeps custom names and sends Open here to its owner", async () => {
  setLocale("es");
  const { el, host } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance,
  });
  expect(el.shadowRoot?.textContent).toContain(BUILT_IN_ROLE_NAMES.admin.es);
  expect(el.shadowRoot!.textContent).toContain("Night lead");
  const opened = vi.fn();
  host.addEventListener("open-cloud-emergency", opened);
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-here]")!.click();
  expect(opened).toHaveBeenCalledOnce();
});

it("closes through the shared dialog and does not list roles when none were sent", async () => {
  const { el, host } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance: { ...entrance, roles: [] },
  });
  expect(el.shadowRoot?.querySelector("[data-emergency-roles]")).toBeNull();
  const closed = new Promise<Event>((resolve) =>
    host.addEventListener("close-cloud-emergency", resolve, { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await closed;
  expect(el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.open).toBe(false);
});
