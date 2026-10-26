import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode, type WtButton, type WtInput } from "@waitron/ui";
import type { DashboardApi, VenuePrivacy } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { guideHref } from "../help-guide.js";
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
  setHelpMode(false);
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
  r.api.putVenuePrivacy.mockImplementationOnce(async () => {
    r.state.stored = { ...STORED, privacyNoticeUrl: "https://example.com/answered" };
    return structuredClone(r.state.stored);
  });
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

const badge = (el: Panel) =>
  input(el, "privacyNoticeUrl")!.querySelector<HTMLElement>("wt-help-tooltip[slot=help]");

it("with help off the web page field's help badge is in the page but not shown", async () => {
  setHelpMode(false);
  const el = await mount(rig().api);
  await edit(el);
  const help = badge(el)!;
  await (help as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(help.hasAttribute("data-help-on")).toBe(false);
  expect(getComputedStyle(help).display).toBe("none");
});

it("with help on the badge follows the help switch and links to the staff notice", async () => {
  setHelpMode(true);
  const el = await mount(rig().api);
  await edit(el);
  const help = badge(el)!;
  await expect.poll(() => help.hasAttribute("data-help-on")).toBe(true);
  expect(help.getAttribute("mode")).toBe("help-mode");
  expect(help.getAttribute("aria-label")).toBe(t("venue_privacy.notice_url_help_label"));
  expect(help.getAttribute("guide-href")).toBe(guideHref("data-protection.staff-notice"));
  expect(help.getAttribute("guide-href")).toBe("/help/en/data-protection#staff-notice");
  expect(help.getAttribute("guide-label")).toBe(t("venue_privacy.notice_url_help_guide"));
  expect(text(help)).toBe(t("venue_privacy.notice_url_help"));
  expect(getComputedStyle(help).display).not.toBe("none");
});

it("in Spanish the badge links to the Spanish guide", async () => {
  setLocale("es-ES");
  setHelpMode(true);
  const el = await mount(rig().api);
  await edit(el);
  const help = badge(el)!;
  expect(help.getAttribute("guide-href")).toBe("/help/es/data-protection#staff-notice");
  expect(help.getAttribute("aria-label")).toBe(es["venue_privacy.notice_url_help_label"]);
  expect(help.getAttribute("guide-label")).toBe(es["venue_privacy.notice_url_help_guide"]);
  expect(text(help)).toBe(es["venue_privacy.notice_url_help"]);
});

it("in Spanish the heading, labels and placeholders are the Spanish words", async () => {
  setLocale("es-ES");
  const el = await mount(rig().api);
  expect(text(q(el, "section.settings-card header > h2"))).toBe(es["venue_settings.card.privacy"]);
  expect(rows(el)).toEqual([
    `${es["venue_privacy.notice_url"]}: ${es["venue_details.unset"]}`,
    `${es["venue_privacy.email"]}: ${es["venue_details.unset"]}`,
  ]);
  await edit(el);
  expect(input(el, "privacyNoticeUrl")!.label).toBe(es["venue_privacy.notice_url"]);
  expect(input(el, "privacyNoticeUrl")!.placeholder).toBe(
    es["venue_privacy.notice_url_placeholder"],
  );
  expect(input(el, "privacyEmail")!.label).toBe(es["venue_privacy.email"]);
  expect(input(el, "privacyEmail")!.placeholder).toBe(es["venue_privacy.email_placeholder"]);
});

it("in Spanish the three refusal messages are the Spanish words", async () => {
  setLocale("es-ES");
  const el = await mount(rig().api);
  await edit(el);
  await type(el, "privacyNoticeUrl", "example.com/privacy");
  await type(el, "privacyEmail", "privacy@example");
  await save(el);
  expect(input(el, "privacyNoticeUrl")!.error).toBe(es["venue_privacy.web_address_invalid"]);
  expect(input(el, "privacyEmail")!.error).toBe(es["venue_privacy.email_invalid"]);
  expect(bottom(el)).toBe(es["form.fix_fields"]);
  await type(el, "privacyEmail", "a@" + "b".repeat(250) + ".es");
  expect(input(el, "privacyEmail")!.error).toBe(
    es["venue_privacy.too_long"].replace("{max}", "254"),
  );
});

it("a live read delivering a new stored pair updates the read view", async () => {
  const r = rig();
  const el = await mount(r.api);
  r.state.stored = { ...STORED };
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect
    .poll(() => rows(el))
    .toEqual([
      "Privacy notice web page: https://example.com/privacy",
      "Privacy email: privacy@example.com",
    ]);
});

it("during an edit an untouched draft follows a live read", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  r.state.stored = { ...STORED };
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => input(el, "privacyNoticeUrl")!.value).toBe("https://example.com/privacy");
  expect(input(el, "privacyEmail")!.value).toBe("privacy@example.com");
  await el.updateComplete;
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
});

it("after an untouched draft follows a live read, Save sends only the field typed next", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  r.state.stored = { ...STORED };
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => input(el, "privacyNoticeUrl")!.value).toBe("https://example.com/privacy");
  await type(el, "privacyEmail", "typed@example.com");
  await save(el);
  await expect
    .poll(() => r.api.putVenuePrivacy.mock.calls)
    .toEqual([[{ privacyEmail: "typed@example.com" }]]);
});

it("during an edit a changed draft keeps what was typed when a live read arrives", async () => {
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "typed@example.com");
  const reads = r.api.getVenuePrivacy.mock.calls.length;
  r.state.stored = { ...STORED };
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => r.api.getVenuePrivacy.mock.calls.length).toBe(reads + 1);
  await flush(el);
  expect(input(el, "privacyEmail")!.value).toBe("typed@example.com");
  expect(input(el, "privacyNoticeUrl")!.value).toBe("");
  expect(saveButton(el).disabled).toBe(false);
  saveButton(el).click();
  await expect
    .poll(() => r.api.putVenuePrivacy.mock.calls)
    .toEqual([[{ privacyEmail: "typed@example.com" }]]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const savedEmail = (el: Panel) => text(q(el, "[data-test=saved-privacyEmail]"));

function withBackground(stored: VenuePrivacy = STORED) {
  const r = rig(stored);
  const background = { getVenuePrivacy: vi.fn(async () => structuredClone(r.state.stored)) };
  Object.assign(r.api, { background });
  return { ...r, background };
}

it("shows a read failure with Retry, and Retry recovers", async () => {
  const r = rig(STORED);
  r.api.getVenuePrivacy.mockRejectedValueOnce({ code: "server.unavailable" });
  const { el } = await mountWidget<Panel>("dashboard-venue-privacy-panel", { api: r.api });
  await expect.poll(() => q(el, "[data-test=read-error]")).toBeTruthy();
  expect(q(el, "[data-test=read-error]")!.getAttribute("role")).toBe("alert");
  expect(text(q(el, "[data-test=read-error]"))).toBe(codeMessage("server.unavailable"));
  expect(q(el, "section.settings-card dl")).toBeNull();
  const retry = q(el, "[data-test=retry]") as HTMLElement;
  expect(text(retry)).toBe("Retry");
  retry.click();
  await expect.poll(() => savedEmail(el)).toBe("privacy@example.com");
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(q(el, "[data-test=retry]")).toBeNull();
});

it("reads through the background client once the card has read before, after reconnecting", async () => {
  const r = withBackground();
  const el = await mount(r.api);
  expect(r.api.getVenuePrivacy).toHaveBeenCalledTimes(1);
  expect(r.background.getVenuePrivacy).not.toHaveBeenCalled();
  const parent = el.parentNode!;
  el.remove();
  parent.appendChild(el);
  await expect.poll(() => r.background.getVenuePrivacy.mock.calls.length).toBe(1);
  expect(r.api.getVenuePrivacy).toHaveBeenCalledTimes(1);
});

it("Retry reads through the background client, as every read after the first does", async () => {
  const r = withBackground();
  r.api.getVenuePrivacy.mockRejectedValueOnce({ code: "server.unavailable" });
  const { el } = await mountWidget<Panel>("dashboard-venue-privacy-panel", { api: r.api });
  await expect.poll(() => q(el, "[data-test=retry]")).toBeTruthy();
  (q(el, "[data-test=retry]") as HTMLElement).click();
  await expect.poll(() => savedEmail(el)).toBe("privacy@example.com");
  expect(r.api.getVenuePrivacy).toHaveBeenCalledTimes(1);
  expect(r.background.getVenuePrivacy).toHaveBeenCalledTimes(1);
});

it("a read begun before a successful save does not put back the old email", async () => {
  const r = rig(STORED);
  const el = await mount(r.api);
  const stale = deferred<VenuePrivacy>();
  r.api.getVenuePrivacy.mockImplementationOnce(() => stale.promise);
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => r.api.getVenuePrivacy.mock.calls.length).toBe(2);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  await save(el);
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(savedEmail(el)).toBe("new@example.com");
  stale.resolve(structuredClone(STORED));
  await stale.promise;
  await frame();
  await flush(el);
  expect(savedEmail(el)).toBe("new@example.com");
});

it("a save answer that arrives after a newer live value ends on the newer value", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "first@example.com");
  await save(el);
  const reads = r.api.getVenuePrivacy.mock.calls.length;
  r.state.stored = { ...STORED, privacyEmail: "second@example.com" };
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => r.api.getVenuePrivacy.mock.calls.length).toBe(reads + 1);
  await frame();
  await flush(el);
  pending.resolve({ ...STORED, privacyEmail: "first@example.com" });
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  await expect.poll(() => savedEmail(el)).toBe("second@example.com");
  expect(q(el, "form")).toBeNull();
  expect(q(el, "[data-test=read-error]")).toBeNull();
});

it("a live read begun during the save that answers after it does not leave the save's answer showing", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "first@example.com");
  await save(el);
  const late = deferred<VenuePrivacy>();
  r.api.getVenuePrivacy.mockImplementationOnce(() => late.promise);
  const reads = r.api.getVenuePrivacy.mock.calls.length;
  r.liveData.invalidate([{ type: "tenants" }]);
  await expect.poll(() => r.api.getVenuePrivacy.mock.calls.length).toBe(reads + 1);
  r.state.stored = { ...STORED, privacyEmail: "second@example.com" };
  pending.resolve({ ...STORED, privacyEmail: "first@example.com" });
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  late.resolve({ ...STORED, privacyEmail: "second@example.com" });
  await late.promise;
  await frame();
  await flush(el);
  await expect.poll(() => savedEmail(el)).toBe("second@example.com");
  expect(q(el, "form")).toBeNull();
});

it("after a successful save the card reads the stored pair again through the background client", async () => {
  const r = withBackground();
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  await save(el);
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  await expect.poll(() => r.background.getVenuePrivacy.mock.calls.length).toBe(1);
  expect(r.api.getVenuePrivacy).toHaveBeenCalledTimes(1);
  expect(savedEmail(el)).toBe("new@example.com");
});

it("a failed read after a successful save is a read failure, and the editor stays closed", async () => {
  const r = withBackground();
  r.background.getVenuePrivacy.mockRejectedValueOnce({ code: "server.unavailable" });
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  await save(el);
  await expect.poll(() => q(el, "[data-test=read-error]")).toBeTruthy();
  expect(text(q(el, "[data-test=read-error]"))).toBe(codeMessage("server.unavailable"));
  expect(q(el, "form")).toBeNull();
  expect(q(el, "[data-test=edit]")).toBeTruthy();
  expect(savedEmail(el)).toBe("new@example.com");
  expect(r.api.putVenuePrivacy).toHaveBeenCalledTimes(1);
  (q(el, "[data-test=retry]") as HTMLElement).click();
  await expect.poll(() => q(el, "[data-test=read-error]")).toBeNull();
  expect(savedEmail(el)).toBe("new@example.com");
});

it("reconnecting while a save is in flight keeps Save disabled, so a second click sends nothing", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  await save(el);
  await reattachAfterDetachedUpdate(el);
  await flush(el);
  expect(saveButton(el).loading).toBe(true);
  expect(saveButton(el).disabled).toBe(true);
  saveButton(el).click();
  await flush(el);
  expect(r.api.putVenuePrivacy).toHaveBeenCalledTimes(1);
  r.state.stored = { ...STORED, privacyEmail: "new@example.com" };
  pending.resolve({ ...STORED, privacyEmail: "new@example.com" });
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(q(el, "form")).toBeNull();
  expect(savedEmail(el)).toBe("new@example.com");
  expect(r.api.putVenuePrivacy).toHaveBeenCalledTimes(1);
});

it("a save in flight when the card turns read-only shows its answer once it succeeds", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  saveButton(el).click();
  await el.updateComplete;
  el.readOnly = true;
  await flush(el);
  expect(q(el, "form")).toBeNull();
  const reread = deferred<VenuePrivacy>();
  r.api.getVenuePrivacy.mockImplementationOnce(() => reread.promise);
  pending.resolve({ ...STORED, privacyEmail: "new@example.com" });
  await pending.promise;
  await frame();
  await flush(el);
  expect(savedEmail(el)).toBe("new@example.com");
  expect(q(el, "form")).toBeNull();
  expect(q(el, "[data-test=edit]")).toBeNull();
  reread.resolve({ ...STORED, privacyEmail: "new@example.com" });
});

it("a save that succeeds after the card turned read-only and back leaves the new clean draft open on its answer", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  saveButton(el).click();
  await el.updateComplete;
  el.readOnly = true;
  await flush(el);
  el.readOnly = false;
  await flush(el);
  await edit(el);
  expect(input(el, "privacyEmail")!.value).toBe("privacy@example.com");
  const reread = deferred<VenuePrivacy>();
  r.api.getVenuePrivacy.mockImplementationOnce(() => reread.promise);
  pending.resolve({ ...STORED, privacyEmail: "new@example.com" });
  await pending.promise;
  await frame();
  await flush(el);
  expect(q(el, "form")).not.toBeNull();
  expect(input(el, "privacyEmail")!.value).toBe("new@example.com");
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).loading).toBe(false);
  reread.resolve({ ...STORED, privacyEmail: "new@example.com" });
});

it("a refusal that arrives after reconnecting during the save goes under its field in the resumed draft", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  await save(el);
  await reattachAfterDetachedUpdate(el);
  pending.reject({
    code: "venue.detail_invalid",
    params: { field: "privacyEmail", reason: "email" },
  });
  await pending.promise.catch(() => {});
  await frame();
  await flush(el);
  expect(input(el, "privacyEmail")!.value).toBe("new@example.com");
  expect(input(el, "privacyEmail")!.error).toBe(t("venue_privacy.email_invalid"));
  expect(saveButton(el).loading).toBe(false);
  expect(saveButton(el).disabled).toBe(false);
});

it("a refusal that arrives after the card turned read-only and back leaves the new draft alone", async () => {
  const r = rig(STORED);
  const pending = deferred<VenuePrivacy>();
  r.api.putVenuePrivacy.mockImplementationOnce(() => pending.promise);
  const el = await mount(r.api);
  await edit(el);
  await type(el, "privacyEmail", "new@example.com");
  saveButton(el).click();
  await el.updateComplete;
  el.readOnly = true;
  await flush(el);
  el.readOnly = false;
  await flush(el);
  await edit(el);
  pending.reject({
    code: "venue.detail_invalid",
    params: { field: "privacyEmail", reason: "email" },
  });
  await pending.promise.catch(() => {});
  await frame();
  await flush(el);
  expect(input(el, "privacyEmail")!.value).toBe("privacy@example.com");
  expect(input(el, "privacyEmail")!.error).toBe("");
  expect(bottom(el)).toBe("");
  expect(saveButton(el).loading).toBe(false);
});
