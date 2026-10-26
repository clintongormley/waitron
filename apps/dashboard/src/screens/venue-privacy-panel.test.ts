import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import type { DashboardApi, VenuePrivacy } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import "./venue-privacy-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-privacy-panel"];
const EMPTY: VenuePrivacy = { privacyNoticeUrl: null, privacyEmail: null };
const STORED: VenuePrivacy = {
  privacyNoticeUrl: "https://example.com/privacy",
  privacyEmail: "privacy@example.com",
};
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Panel, selector: string) => el.shadowRoot!.querySelector(selector);
const rows = (el: Panel) =>
  [...el.shadowRoot!.querySelectorAll("section.settings-card dt")].map(
    (label) => `${text(label)}: ${text(label.nextElementSibling)}`,
  );
const flush = async (el: Panel) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

function rig(stored: VenuePrivacy = EMPTY) {
  const liveData = new LiveData();
  const state = { stored: structuredClone(stored) };
  const api = {
    liveData,
    getVenuePrivacy: vi.fn(async () => structuredClone(state.stored)),
    putVenuePrivacy: vi.fn(async (changes: Partial<Record<keyof VenuePrivacy, string>>) => {
      for (const [key, value] of Object.entries(changes)) {
        state.stored[key as keyof VenuePrivacy] = value.trim() === "" ? null : value.trim();
      }
      return structuredClone(state.stored);
    }),
  };
  return { api: api as typeof api & DashboardApi, liveData, state };
}
async function mount(api: DashboardApi, readOnly = false) {
  const { el } = await mountWidget<Panel>("dashboard-venue-privacy-panel", { api, readOnly });
  await expect.poll(() => q(el, "section.settings-card dl")).toBeTruthy();
  await flush(el);
  return el;
}
const input = (el: Panel, name: string) => q(el, `wt-input[name=${name}]`) as WtInput | null;
const native = (el: Panel, name: string) =>
  input(el, name)!.shadowRoot!.querySelector("input") as HTMLInputElement;
const saveButton = (el: Panel) => q(el, "[data-test=save]") as WtButton;
const cancelButton = (el: Panel) => q(el, "[data-test=cancel]") as WtButton;
const bottom = (el: Panel) =>
  (q(el, "wt-form-actions") as (HTMLElement & { error: string }) | null)?.error ?? "";
async function edit(el: Panel) {
  (q(el, "[data-test=edit]") as HTMLElement).click();
  await el.updateComplete;
  await expect.poll(() => input(el, "privacyNoticeUrl")).toBeTruthy();
  await input(el, "privacyNoticeUrl")!.updateComplete;
  await input(el, "privacyEmail")!.updateComplete;
}
async function type(el: Panel, name: string, value: string) {
  await userEvent.fill(page.elementLocator(native(el, name)), value);
  await el.updateComplete;
}
async function save(el: Panel) {
  saveButton(el).click();
  await flush(el);
}

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

it("shows Not set twice for an empty privacy contact", async () => {
  const el = await mount(rig().api);
  expect(text(q(el, "section.settings-card header > h2"))).toBe("Privacy");
  expect(rows(el)).toEqual(["Privacy notice web page: Not set", "Privacy email: Not set"]);
});

it("shows the two stored values", async () => {
  const el = await mount(rig(STORED).api);
  expect(rows(el)).toEqual([
    "Privacy notice web page: https://example.com/privacy",
    "Privacy email: privacy@example.com",
  ]);
  expect(q(el, "section.settings-card a")).toBeNull();
});

it("read-only shows the values and no Edit", async () => {
  const { api } = rig(STORED);
  const el = await mount(api, true);
  expect(q(el, "[data-test=edit]")).toBeNull();
  expect(q(el, "form")).toBeNull();
  expect(rows(el)).toEqual([
    "Privacy notice web page: https://example.com/privacy",
    "Privacy email: privacy@example.com",
  ]);
});

it("Edit draws the two fields, neither required, with Save quiet and disabled", async () => {
  const el = await mount(rig(STORED).api);
  await edit(el);
  expect(q(el, "[data-test=edit]")).toBeNull();
  const url = input(el, "privacyNoticeUrl")!;
  const email = input(el, "privacyEmail")!;
  expect(url.label).toBe("Privacy notice web page");
  expect(url.type).toBe("url");
  expect(url.placeholder).toBe("https://example.com/privacy");
  expect(url.required).toBe(false);
  expect(url.value).toBe("https://example.com/privacy");
  expect(email.label).toBe("Privacy email");
  expect(email.type).toBe("text");
  expect(email.autocomplete).toBe("off");
  expect(email.placeholder).toBe("privacy@example.com");
  expect(email.required).toBe(false);
  expect(email.value).toBe("privacy@example.com");
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
  expect(cancelButton(el).getAttribute("slot")).toBe("cancel");
});

it("a typed change enables Save, and typing it back quiets it again", async () => {
  const el = await mount(rig(STORED).api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "https://example.com/other");
  expect(saveButton(el).disabled).toBe(false);
  expect(saveButton(el).variant).toBe("primary");
  await type(el, "privacyNoticeUrl", "https://example.com/privacy");
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
});

it("spaces typed around the stored web page keep Save quiet", async () => {
  const el = await mount(rig(STORED).api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "  https://example.com/privacy  ");
  expect(input(el, "privacyNoticeUrl")!.value).toBe("  https://example.com/privacy  ");
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
});

it("Save sends only the changed field, closes the form and shows the answer", async () => {
  const r = rig(STORED);
  r.api.putVenuePrivacy.mockImplementationOnce(async () => ({
    ...STORED,
    privacyNoticeUrl: "https://example.com/answered",
  }));
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "https://example.com/new");
  await save(el);
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenuePrivacy.mock.calls).toEqual([
    [{ privacyNoticeUrl: "https://example.com/new" }],
  ]);
  expect(q(el, "form")).toBeNull();
  expect(rows(el)).toEqual([
    "Privacy notice web page: https://example.com/answered",
    "Privacy email: privacy@example.com",
  ]);
});

it("Save sends a changed field as the draft holds it, surrounding spaces included", async () => {
  const r = rig(STORED);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "  https://example.com/new  ");
  expect(input(el, "privacyNoticeUrl")!.value).toBe("  https://example.com/new  ");
  await save(el);
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenuePrivacy.mock.calls).toEqual([
    [{ privacyNoticeUrl: "  https://example.com/new  " }],
  ]);
});

it("emptying a field sends an empty string and shows Not set", async () => {
  const r = rig(STORED);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "");
  await save(el);
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenuePrivacy.mock.calls).toEqual([[{ privacyEmail: "" }]]);
  expect(rows(el)).toEqual([
    "Privacy notice web page: https://example.com/privacy",
    "Privacy email: Not set",
  ]);
});

it("says nothing before the first Save, then marks a web page without its prefix", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "example.com/privacy");
  expect(input(el, "privacyNoticeUrl")!.error).toBe("");
  expect(bottom(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  native(el, "privacyNoticeUrl").blur();
  await save(el);
  expect(r.api.putVenuePrivacy).not.toHaveBeenCalled();
  expect(input(el, "privacyNoticeUrl")!.error).toBe(t("venue_privacy.web_address_invalid"));
  expect(bottom(el)).toBe(t("form.fix_fields"));
  await expect
    .poll(() => input(el, "privacyNoticeUrl")!.shadowRoot!.activeElement)
    .toBe(native(el, "privacyNoticeUrl"));
});

it("after a failed Save, fixing the field clears both messages and breaking it brings them back", async () => {
  const el = await mount(rig().api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "example.com/privacy");
  await save(el);
  expect(saveButton(el).disabled).toBe(true);
  await type(el, "privacyNoticeUrl", "https://example.com/privacy");
  expect(input(el, "privacyNoticeUrl")!.error).toBe("");
  expect(bottom(el)).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  await type(el, "privacyNoticeUrl", "example.com");
  expect(input(el, "privacyNoticeUrl")!.error).toBe(t("venue_privacy.web_address_invalid"));
  expect(bottom(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(true);
});

it("marks an email without a full domain on Save", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "privacy@example");
  expect(input(el, "privacyEmail")!.error).toBe("");
  native(el, "privacyEmail").blur();
  await save(el);
  expect(r.api.putVenuePrivacy).not.toHaveBeenCalled();
  expect(input(el, "privacyEmail")!.error).toBe(t("venue_privacy.email_invalid"));
  expect(input(el, "privacyNoticeUrl")!.error).toBe("");
  expect(bottom(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(true);
  await expect
    .poll(() => input(el, "privacyEmail")!.shadowRoot!.activeElement)
    .toBe(native(el, "privacyEmail"));
});

it.each([
  ["privacyNoticeUrl", "https://example.com/" + "a".repeat(481), "500"],
  ["privacyEmail", "a@" + "b".repeat(250) + ".es", "254"],
])("a too-long %s is refused with its limit", async (name, value, max) => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await type(el, name, value);
  await save(el);
  expect(r.api.putVenuePrivacy).not.toHaveBeenCalled();
  expect(input(el, name)!.error).toBe(fill("venue_privacy.too_long", { max }));
  expect(bottom(el)).toBe(t("form.fix_fields"));
});

it("a server refusal naming the email goes under that field, and Save stays enabled", async () => {
  const r = rig();
  r.api.putVenuePrivacy.mockRejectedValueOnce({
    code: "venue.detail_invalid",
    params: { field: "privacyEmail", reason: "email" },
  });
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "privacy@example.com");
  await save(el);
  await expect.poll(() => input(el, "privacyEmail")!.error).toBe(t("venue_privacy.email_invalid"));
  expect(input(el, "privacyNoticeUrl")!.error).toBe("");
  expect(bottom(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(false);
  expect(saveButton(el).loading).toBe(false);
});

it("a refusal naming no field goes in the bottom message only, and Save stays enabled", async () => {
  const r = rig();
  r.api.putVenuePrivacy.mockRejectedValueOnce({ code: "authorization.not_permitted" });
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "privacy@example.com");
  await save(el);
  await expect.poll(() => bottom(el)).toBe(codeMessage("authorization.not_permitted"));
  expect(bottom(el)).not.toBe("");
  expect(input(el, "privacyEmail")!.error).toBe("");
  expect(input(el, "privacyNoticeUrl")!.error).toBe("");
  expect(saveButton(el).disabled).toBe(false);
});

it("while the save is in flight Save shows loading and Save and Cancel are disabled", async () => {
  const r = rig();
  let answer!: (value: VenuePrivacy) => void;
  r.api.putVenuePrivacy.mockImplementationOnce(
    () => new Promise<VenuePrivacy>((resolve) => (answer = resolve)),
  );
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "privacy@example.com");
  await save(el);
  expect(saveButton(el).loading).toBe(true);
  expect(saveButton(el).disabled).toBe(true);
  expect(cancelButton(el).disabled).toBe(true);
  answer({ ...EMPTY, privacyEmail: "privacy@example.com" });
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
});

it("Enter in a field saves", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "privacy@example.com");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => r.api.putVenuePrivacy.mock.calls)
    .toEqual([[{ privacyEmail: "privacy@example.com" }]]);
});

it.each([
  ["privacyNoticeUrl", "https://caf\u00e9.example.com/privacy"],
  ["privacyEmail", "privacy@caf\u00e9.example.com"],
])(
  "an accented domain typed into %s reaches the draft and the request unchanged",
  async (name, value) => {
    const r = rig();
    const el = await mount(r.api);
    await edit(el);
    await type(el, name, value);
    expect(input(el, name)!.value).toBe(value);
    await save(el);
    await expect.poll(() => r.api.putVenuePrivacy.mock.calls).toEqual([[{ [name]: value }]]);
  },
);
