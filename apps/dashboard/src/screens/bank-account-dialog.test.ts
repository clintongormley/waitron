import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { WtButton, WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { fill, setLocale, t } from "../i18n/t.js";
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];
type Account = VenueDetailsModel["bankAccount"];

const STORED = { iban: "ES7620770024003102575766", bankName: "Openbank" };

const withAccount = (bankAccount: Account): VenueDetailsModel => ({
  ...venueDetailsFixture(),
  bankAccount,
});

function stubApi(initial: Account = STORED) {
  let current = withAccount(initial);
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(),
    saveBankAccount: vi.fn(async ({ iban, bankName }: { iban: string; bankName: string }) => {
      current = withAccount(iban === "" ? null : { iban, bankName: bankName || null });
      return { model: structuredClone(current) };
    }),
  };
}
type Api = ReturnType<typeof stubApi>;

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(api: Api, readOnly = false): Promise<Panel> {
  const { el } = await mountWidget<Panel>("dashboard-venue-details-panel", {
    api: api as unknown as DashboardApi,
    readOnly,
  });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=issuer]")).toBeTruthy();
  return el;
}

const button = (panel: Panel) =>
  panel.shadowRoot!.querySelector<WtButton>("[data-test=change-bank-account]");
const dialogHost = (panel: Panel) =>
  panel.shadowRoot!.querySelector("dashboard-bank-account-dialog")!;
const dialog = (panel: Panel) =>
  dialogHost(panel).shadowRoot!.querySelector<WtDialog>(
    "wt-dialog[data-test=bank-account-dialog]",
  )!;
const field = (panel: Panel, name: "iban" | "bankName") =>
  dialog(panel).querySelector<WtInput>(`wt-input[name=${name}]`)!;
const save = (panel: Panel) =>
  dialog(panel).querySelector<WtButton>("wt-button[data-test=save-bank-account]")!;
const actions = (panel: Panel) => dialog(panel).querySelector<WtFormActions>("wt-form-actions")!;

async function open(panel: Panel): Promise<void> {
  button(panel)!.click();
  await dialogHost(panel).updateComplete;
  await expect.poll(() => dialog(panel)?.open).toBe(true);
}

async function type(panel: Panel, name: "iban" | "bankName", value: string): Promise<void> {
  field(panel, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await dialogHost(panel).updateComplete;
}

async function press(panel: Panel): Promise<void> {
  save(panel).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialogHost(panel).updateComplete;
}

it("offers Change bank account in the Business card's header only when the panel can be edited", async () => {
  const editable = await mount(stubApi());
  const shown = button(editable)!;
  expect(shown.textContent!.trim()).toBe(t("venue_details.change_bank_account"));
  expect(shown.closest("header")?.parentElement?.matches("[data-test=issuer]")).toBe(true);
  const readOnly = await mount(stubApi(), true);
  expect(button(readOnly)).toBeNull();
});

it("opens prefilled with the stored account and the note, and keeps Save quiet until it changes", async () => {
  const panel = await mount(stubApi());
  await open(panel);
  expect(field(panel, "iban").value).toBe("ES76 2077 0024 0031 0257 5766");
  expect(field(panel, "bankName").value).toBe(STORED.bankName);
  expect(field(panel, "iban").required).toBe(false);
  expect(dialog(panel).textContent).toContain(t("venue_details.bank_account_note"));
  expect(save(panel).disabled).toBe(true);
  await type(panel, "bankName", "Other bank");
  expect(save(panel).variant).toBe("primary");
  expect(save(panel).disabled).toBe(false);
  await type(panel, "bankName", "Openbank");
  expect(save(panel).disabled).toBe(true);
  await type(panel, "iban", "es76 2077 0024 0031 0257 5766");
  expect(save(panel).disabled).toBe(true);
});

it("a change of bank name alone sends the stored IBAN without spaces as both value and expected", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, "bankName", "CaixaBank");
  const closed = dialogClosed(dialog(panel));
  await press(panel);
  await closed;
  expect(api.saveBankAccount).toHaveBeenCalledWith({
    iban: STORED.iban,
    bankName: "CaixaBank",
    expected: STORED,
  });
});

it("opens empty when no account is stored", async () => {
  const panel = await mount(stubApi(null));
  await open(panel);
  expect(field(panel, "iban").value).toBe("");
  expect(field(panel, "bankName").value).toBe("");
  expect(save(panel).disabled).toBe(true);
});

for (const [iban, key] of [
  ["ES9121000418450200051333", "venue_details.iban_checksum"],
  ["ES91 2100", "venue_details.iban_format"],
] as const) {
  it(`an IBAN failing its ${key} check is marked under the field and blocks Save until fixed`, async () => {
    const api = stubApi();
    const panel = await mount(api);
    await open(panel);
    await type(panel, "iban", iban);
    await press(panel);
    expect(api.saveBankAccount).not.toHaveBeenCalled();
    expect(field(panel, "iban").error).toBe(t(key));
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    expect(save(panel).disabled).toBe(true);
    await type(panel, "iban", "ES9121000418450200051332");
    expect(field(panel, "iban").error).toBe("");
    expect(save(panel).disabled).toBe(false);
  });
}

it("a bank name over 70 characters is marked under the bank name and blocks Save until shortened, in English and Spanish", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    const panel = await mount(api);
    await open(panel);
    await type(panel, "bankName", ` ${"e\u0301".repeat(71)} `);
    await press(panel);
    expect(api.saveBankAccount).not.toHaveBeenCalled();
    expect(field(panel, "bankName").error).toBe(
      fill("venue_details.bank_name_too_long", { max: "70" }),
    );
    expect(field(panel, "iban").error).toBe("");
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    expect(save(panel).disabled).toBe(true);
    await type(panel, "bankName", ` ${"e\u0301".repeat(70)} `);
    expect(field(panel, "bankName").error).toBe("");
    expect(save(panel).disabled).toBe(false);
    cleanupWidgets();
  }
});

it("a server refusal of a too-long bank name shows under the bank name, in English and Spanish", async () => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    const api = stubApi();
    api.saveBankAccount.mockRejectedValue({
      code: "venue.detail_invalid",
      params: { field: "bankName", reason: "too_long" },
    });
    const panel = await mount(api);
    await open(panel);
    await type(panel, "bankName", "Other bank");
    await press(panel);
    expect(field(panel, "bankName").error).toBe(
      fill("venue_details.bank_name_too_long", { max: "70" }),
    );
    expect(field(panel, "iban").error).toBe("");
    expect(actions(panel).error).toBe(t("form.fix_fields"));
    cleanupWidgets();
  }
});

it("a bank name without an IBAN is marked under the IBAN", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, "iban", "");
  await press(panel);
  expect(api.saveBankAccount).not.toHaveBeenCalled();
  expect(field(panel, "iban").error).toBe(t("venue_details.bank_iban_required"));
});

it("a valid change sends the IBAN without spaces, the bank name and both stored values, and shows the new account", async () => {
  const api = stubApi();
  const panel = await mount(api);
  const told: Event[] = [];
  const listen = (event: Event) => told.push(event);
  document.body.addEventListener("venue-identity-changed", listen);
  onTestFinished(() => document.body.removeEventListener("venue-identity-changed", listen));
  await open(panel);
  await type(panel, "iban", "es91 2100 0418 4502 0005 1332");
  await type(panel, "bankName", "  CaixaBank ");
  const closed = dialogClosed(dialog(panel));
  await press(panel);
  await closed;
  expect(api.saveBankAccount).toHaveBeenCalledWith({
    iban: "ES9121000418450200051332",
    bankName: "CaixaBank",
    expected: STORED,
  });
  await panel.updateComplete;
  const row = panel.shadowRoot!.querySelector("[data-test=saved-bankAccount]")!.textContent!;
  expect(row).toContain("ES91 2100 0418 4502 0005 1332");
  expect(row).toContain("CaixaBank");
  expect(told).toHaveLength(1);
});

it("clearing both fields sends an empty IBAN, and with none stored sends empty expected values", async () => {
  const api = stubApi();
  const panel = await mount(api);
  await open(panel);
  await type(panel, "iban", "");
  await type(panel, "bankName", "");
  await press(panel);
  expect(api.saveBankAccount).toHaveBeenCalledWith({
    iban: "",
    bankName: "",
    expected: STORED,
  });
  await panel.updateComplete;
  expect(
    panel.shadowRoot!.querySelector("[data-test=saved-bankAccount]")!.textContent!.trim(),
  ).toBe(t("venue_details.unset"));

  const fresh = stubApi(null);
  const empty = await mount(fresh);
  await open(empty);
  await type(empty, "iban", "ES9121000418450200051332");
  await press(empty);
  expect(fresh.saveBankAccount).toHaveBeenCalledWith({
    iban: "ES9121000418450200051332",
    bankName: "",
    expected: { iban: "", bankName: "" },
  });
});

for (const [reason, key] of [
  ["checksum", "venue_details.iban_checksum"],
  ["format", "venue_details.iban_format"],
  ["required", "venue_details.bank_iban_required"],
  ["unchanged", "venue_details.bank_account_unchanged"],
] as const) {
  it(`a server ${reason} refusal shows under the IBAN, in English and Spanish`, async () => {
    for (const locale of ["en-GB", "es-ES"]) {
      setLocale(locale);
      const api = stubApi();
      api.saveBankAccount.mockRejectedValue({
        code: "venue.detail_invalid",
        params: { field: "iban", reason },
      });
      const panel = await mount(api);
      await open(panel);
      await type(panel, "bankName", "Other bank");
      await press(panel);
      expect(field(panel, "iban").error).toBe(t(key));
      expect(actions(panel).error).toBe(t("form.fix_fields"));
      expect(save(panel).disabled).toBe(false);
      cleanupWidgets();
    }
  });
}

it("an account changed in another session is the bottom message, and Save stays enabled", async () => {
  const api = stubApi();
  api.saveBankAccount.mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "iban" },
  });
  const panel = await mount(api);
  await open(panel);
  await type(panel, "bankName", "Other bank");
  await press(panel);
  expect(actions(panel).error).toBe(t("venue_details.bank_account_changed"));
  expect(field(panel, "iban").error).toBe("");
  expect(save(panel).disabled).toBe(false);
  expect(dialog(panel).open).toBe(true);
});
