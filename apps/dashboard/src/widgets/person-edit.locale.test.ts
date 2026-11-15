import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi, PersonEditDetails, PersonSummary } from "../api/client.js";
import { PersonEdit } from "./person-edit.js";
import { codeMessage } from "../i18n/codes.js";
useLocale("en-GB");
afterEach(cleanupWidgets);
const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada",
  lastNames: "Lovelace",
  email: "ada@example.test",
  telephone: null,
  roleIds: [],
  status: "active",
  hasPassword: true,
  hasTotp: false,
  locale: null,
};
const metadata = {
  locales: [
    { code: "es-ES", label: "Español" },
    { code: "en-GB", label: "English" },
  ],
  venueDefault: "en-GB",
  loginDefault: "en-GB",
  venueName: "Venue",
};
const picker = (el: PersonEdit) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('wt-combobox[name="locale"]')!;
const save = (el: PersonEdit) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function mount(getLocales = vi.fn().mockResolvedValue(metadata)) {
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
    person,
    open: true,
    api: { getLocales } as unknown as DashboardApi,
  });
  const submitted: PersonEditDetails[] = [];
  el.addEventListener("save-person", (event) =>
    submitted.push((event as CustomEvent<PersonEditDetails>).detail),
  );
  return { el, submitted, getLocales };
}
async function ready(el: PersonEdit) {
  await vi.waitFor(() => expect(picker(el)?.disabled).toBe(false));
  await picker(el).updateComplete;
}
async function pressSave(el: PersonEdit) {
  await save(el).updateComplete;
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!));
}
it("uses the profile choices and preserves an unset preference on a contact save", async () => {
  const { el, submitted } = await mount();
  await ready(el);
  expect(picker(el).label).toBe("Language");
  expect(picker(el).required).toBe(true);
  expect(picker(el).options).toEqual([
    { value: "es-ES", label: "Español" },
    { value: "en-GB", label: "English" },
  ]);
  expect(picker(el).value).toBe("en-GB");
  el.shadowRoot!.querySelector('[data-test="edit-first-names"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Augusta" } }),
  );
  await el.updateComplete;
  await pressSave(el);
  expect(submitted).toEqual([expect.objectContaining({ locale: null, firstNames: "Augusta" })]);
});
it.each(["pointer", "Enter", "Escape"] as const)(
  "stores a deliberate selected-option choice through %s",
  async (method) => {
    const { el, submitted } = await mount();
    await ready(el);
    expect(save(el).disabled).toBe(true);
    const trigger = picker(el).shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
    if (method === "Enter") {
      trigger.focus();
      await userEvent.keyboard("{Enter}");
    } else await userEvent.click(page.elementLocator(trigger));
    if (method === "pointer") {
      await userEvent.click(
        page.elementLocator(
          picker(el).shadowRoot!.querySelector<HTMLElement>(
            '[role="option"][aria-selected="true"]',
          )!,
        ),
      );
    } else await userEvent.keyboard(`{${method}}`);
    await el.updateComplete;
    expect(save(el).disabled).toBe(method === "Escape");
    if (method !== "Escape") {
      await pressSave(el);
      expect(submitted).toEqual([expect.objectContaining({ locale: "en-GB" })]);
    } else expect(submitted).toEqual([]);
  },
);
it("lets contact details save while locale metadata is unavailable, and retries only the chooser", async () => {
  const getLocales = vi
    .fn()
    .mockRejectedValueOnce({ code: "server.internal" })
    .mockResolvedValue(metadata);
  const { el, submitted } = await mount(getLocales);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="locale-retry"]')).not.toBeNull(),
  );
  expect(picker(el).disabled).toBe(true);
  el.shadowRoot!.querySelector('[data-test="edit-first-names"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Augusta" } }),
  );
  await el.updateComplete;
  await pressSave(el);
  expect(submitted).toEqual([expect.objectContaining({ locale: null, firstNames: "Augusta" })]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="locale-retry"]')!.click();
  await ready(el);
  expect(el.shadowRoot!.querySelector('[data-test="edit-first-names"]')!.getAttribute("name")).toBe(
    "given-name",
  );
  await pressSave(el);
  expect(submitted[1]).toMatchObject({ locale: null, firstNames: "Augusta" });
});

it("puts a locale refusal at the chooser and focuses its real control", async () => {
  const { el } = await mount();
  await ready(el);
  el.error = "locale.unsupported";
  await el.updateComplete;
  await vi.waitFor(() => expect(picker(el).error).toBe(codeMessage("locale.unsupported")));
  await vi.waitFor(() => expect(picker(el).shadowRoot!.activeElement?.tagName).toBe("BUTTON"));
});
it("ignores an earlier editor's locale metadata after reopening for another person", async () => {
  let finish!: (value: typeof metadata) => void;
  const old = new Promise<typeof metadata>((resolve) => {
    finish = resolve;
  });
  const getLocales = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockResolvedValue({ ...metadata, venueDefault: "es-ES" });
  const { el } = await mount(getLocales);
  await vi.waitFor(() => expect(getLocales).toHaveBeenCalledTimes(1));
  el.open = false;
  await el.updateComplete;
  el.person = { ...person, personId: "p2", displayName: "Grace" };
  el.open = true;
  await ready(el);
  expect(picker(el).value).toBe("es-ES");
  finish(metadata);
  await old;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(picker(el).value).toBe("es-ES");
});
