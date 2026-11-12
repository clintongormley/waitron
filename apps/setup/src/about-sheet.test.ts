import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import "./about-sheet.js";
import type { SetupAboutSheet } from "./about-sheet.js";

type Lit = HTMLElement & LitElement;

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const modalOf = (sheet: SetupAboutSheet) => sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
const closeButton = (sheet: SetupAboutSheet) =>
  sheet.shadowRoot!.querySelector<Lit>('wt-button[slot="footer"]')!;

async function mountOpen(): Promise<SetupAboutSheet> {
  const { el } = await mountWidget<SetupAboutSheet>("setup-about-sheet", { open: true });
  await modalOf(el).updateComplete;
  return el;
}

it("draws nothing to see while closed", async () => {
  const { el } = await mountWidget<SetupAboutSheet>("setup-about-sheet", {});
  expect(modalOf(el).open).toBe(false);
  expect(el.shadowRoot!.querySelector("iframe")).toBeNull();
});

it("frames /legal/declaration under the heading About Waitron while open", async () => {
  const el = await mountOpen();
  const modal = modalOf(el);
  expect(modal.open).toBe(true);
  expect(modal.size).toBe("full");
  expect(modal.getAttribute("aria-label")).toBe(t("shell.about.title"));
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("shell.about.title"));
  const frame = el.shadowRoot!.querySelector("iframe")!;
  expect(frame.getAttribute("src")).toBe("/legal/declaration");
  expect(frame.title).toBe(t("shell.about.title"));
  expect(closeButton(el).textContent!.trim()).toBe(t("shell.about.close"));
});

it("follows a language change while open", async () => {
  const el = await mountOpen();
  const english = t("shell.about.title");
  setLocale("es-ES");
  expect(t("shell.about.title")).not.toBe(english);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("shell.about.title"));
});

it.each([
  [
    "Close",
    (sheet: SetupAboutSheet) =>
      userEvent.click(closeButton(sheet).shadowRoot!.querySelector("button")!),
  ],
  ["Escape", () => userEvent.keyboard("{Escape}")],
] as const)("%s asks its owner to close it with about-close", async (_name, close) => {
  const el = await mountOpen();
  const closed = new Promise<Event>((resolve) =>
    el.addEventListener("about-close", resolve, { once: true }),
  );
  await close(el);
  const event = await closed;
  expect(event.bubbles).toBe(true);
  expect(event.composed).toBe(true);
});
