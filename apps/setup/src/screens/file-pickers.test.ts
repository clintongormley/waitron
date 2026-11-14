import { afterEach, expect, it } from "vitest";
import type { LitElement } from "lit";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import "./restore-screen.js";
import "./restore-bucket-screen.js";
import "./live-source-screen.js";

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

it.each([
  "setup-cert-screen",
  "setup-restore-screen",
  "setup-restore-bucket-screen",
  "setup-live-source-screen",
])("%s's file picker speaks the chooser's language, not the browser's", async (tag) => {
  setLocale("en-GB");
  const { el } = await mountWidget<LitElement>(tag, {});
  setLocale("es-ES");
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<LitElement>("wt-file-input");
  expect(picker).not.toBeNull();
  await picker!.updateComplete;
  const words = picker!.shadowRoot!.textContent!;
  expect(words).toContain(t("file_input.drop", "es-ES"));
  expect(words).toContain(t("file_input.choose", "es-ES"));
  expect(words).not.toContain(t("file_input.choose", "en-GB"));
});
