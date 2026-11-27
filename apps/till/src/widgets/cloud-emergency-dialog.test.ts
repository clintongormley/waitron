import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import type { WtDialog } from "@waitron/ui";
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
const entrance = { address: "https://emergency.example.test/" };

function shown(el: TillCloudEmergencyDialog) {
  const frame = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const lines = [...el.shadowRoot!.querySelectorAll("p")].map((p) => p.textContent!.trim());
  const buttons = [...el.shadowRoot!.querySelectorAll("wt-button")].map((b) =>
    b.textContent!.trim(),
  );
  return { frame, lines, buttons };
}

it("the till's card shows the heading, the QR code, the link and one line", async () => {
  const { el } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance,
  });
  const { frame, lines, buttons } = shown(el);
  expect(frame.heading).toBe("Start the venue in the cloud");
  expect(el.shadowRoot!.querySelector("[data-emergency-qr] svg")).not.toBeNull();
  expect(lines).toEqual(["You will need a copy of the current master key."]);
  expect(buttons).toEqual(["Close", "Open here"]);
  expect(el.shadowRoot!.textContent).not.toContain(entrance.address);
  await frame.updateComplete;
  const native = frame.shadowRoot!.querySelector("dialog")!;
  await vi.waitFor(() => expect(native.open).toBe(true));
  expect(native.matches(":focus-within")).toBe(true);
});

it("shows the card in Spanish and sends Open here to its owner", async () => {
  setLocale("es");
  const { el, host } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance,
  });
  const { frame, lines, buttons } = shown(el);
  expect(frame.heading).toBe(es["cloud_emergency.start"]);
  expect(lines).toEqual([es["cloud_emergency.master_key"]]);
  expect(buttons).toEqual([es["cloud_emergency.close"], es["cloud_emergency.open"]]);
  const opened = vi.fn();
  host.addEventListener("open-cloud-emergency", opened);
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-here]")!.click();
  expect(opened).toHaveBeenCalledOnce();
});

it("closes through the shared dialog", async () => {
  const { el, host } = await mountWidget<TillCloudEmergencyDialog>("till-cloud-emergency-dialog", {
    entrance,
  });
  const closed = new Promise<Event>((resolve) =>
    host.addEventListener("close-cloud-emergency", resolve, { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await closed;
  expect(el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.open).toBe(false);
});
