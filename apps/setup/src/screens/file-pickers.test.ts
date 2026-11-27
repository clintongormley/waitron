import { afterEach, expect, it } from "vitest";
import type { LitElement } from "lit";
import { setLocale, t } from "../i18n/t.js";
import { chooseFiles } from "@waitron/ui/src/test-helpers.js";
import type { WtMasterKeyInput } from "@waitron/ui";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import "./restore-screen.js";
import "./restore-bucket-screen.js";
import "./live-source-screen.js";

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

it.each(["setup-cert-screen", "setup-restore-screen", "setup-live-source-screen"])(
  "%s's file picker speaks the chooser's language, not the browser's",
  async (tag) => {
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
  },
);

it.each(["setup-cert-screen", "setup-restore-screen", "setup-live-source-screen"])(
  "%s's file picker writes the chosen file's size in the chooser's language",
  async (tag) => {
    setLocale("es-ES");
    const { el } = await mountWidget<LitElement>(tag, {});
    const picker = el.shadowRoot!.querySelector<LitElement>("wt-file-input")!;
    chooseFiles(picker, new File([new Uint8Array(48_200)], "chosen.bin"));
    await el.updateComplete;
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent!).toContain("48,2 kB");
  },
);

it("shows the bucket recovery pack chooser and its refusal in the setup language", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<LitElement>("setup-restore-bucket-screen", {});
  setLocale("es-ES");
  await el.updateComplete;
  const key = el.shadowRoot!.querySelector<WtMasterKeyInput>("wt-master-key-input")!;
  await key.updateComplete;
  const button = key.shadowRoot!.querySelector(".choose")!;
  expect(button.textContent!.trim()).toBe(MASTER_KEY_FIELD_WORDS.es.button);
  const file = key.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  expect(file.accept).toBe("application/pdf,.pdf");
  chooseFiles(key, new File(["invalid PDF"], "chosen.pdf", { type: "application/pdf" }));
  await key.pdfRead;
  const field = key.shadowRoot!.querySelector("wt-input")!;
  expect(field.shadowRoot!.textContent).toContain(MASTER_KEY_FIELD_WORDS.es.notPack);
});
