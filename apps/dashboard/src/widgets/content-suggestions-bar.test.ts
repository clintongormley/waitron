import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { SuggestionRunView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./content-suggestions-bar.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const run = (overrides: Partial<SuggestionRunView> = {}): SuggestionRunView => ({
  state: "done",
  total: 358,
  progress: 358,
  done: 358,
  failed: 0,
  code: null,
  fits: null,
  waiting: 358,
  finishedAt: "2026-10-14T10:00:00.000Z",
  opened: false,
  ...overrides,
});
const SENDING = run({ state: "sending", progress: 0, done: 0, waiting: 0, finishedAt: null });
const RUNNING = run({ state: "running", progress: 180, done: 180, waiting: 0, finishedAt: null });
const PARTLY = run({ state: "partly_done", done: 270, failed: 88, waiting: 270 });
const LIMIT = "content.suggestion_limit_reached";
const CONSENT = "content.suggestion_consent_required";
const ABOUT_EN =
  "Waitron Cloud can suggest every missing customer-facing name, in every language. Nothing reaches diners until you save it.";
const ABOUT_ES =
  "Waitron Cloud puede sugerir todos los nombres para clientes que faltan, en todos los idiomas. Nada llega a los clientes hasta que lo guardas.";

function mount(props: Partial<ContentSuggestionsBar> = {}) {
  return mountWidget<ContentSuggestionsBar>("dashboard-content-suggestions-bar", {
    service: "on",
    run: null,
    busy: false,
    error: "",
    nothing: false,
    cloudOrigin: null,
    ...props,
  });
}
const q = (el: ContentSuggestionsBar, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const lines = (el: ContentSuggestionsBar) =>
  [...el.shadowRoot!.querySelectorAll(".lines > p")]
    .map((line) => line.textContent!.replace(/\s+/g, " ").trim())
    .join(" | ");
const button = (el: ContentSuggestionsBar) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=translate-all]")!;

const STATES: {
  name: string;
  props: Partial<ContentSuggestionsBar>;
  en: () => string;
  es: () => string;
}[] = [
  { name: "not read yet", props: { service: null }, en: () => "", es: () => "" },
  {
    name: "not connected",
    props: { service: "not_connected" },
    en: () => `${ABOUT_EN} Connect to Waitron Cloud`,
    es: () => `${ABOUT_ES} Conectar con Waitron Cloud`,
  },
  {
    name: "switched off in Cloud",
    props: { service: "off" },
    en: () => "Translate all is not switched on for this venue in Waitron Cloud.",
    es: () => "Traducir todo no está activado para este local en Waitron Cloud.",
  },
  { name: "ready with no run", props: {}, en: () => ABOUT_EN, es: () => ABOUT_ES },
  {
    name: "sending",
    props: { run: SENDING },
    en: () => "Sending the names to Waitron Cloud…",
    es: () => "Enviando los nombres a Waitron Cloud…",
  },
  {
    name: "running",
    props: { run: RUNNING },
    en: () => "Translating… 180 of 358",
    es: () => "Traduciendo… 180 de 358",
  },
  {
    name: "running after a press that found nothing",
    props: { run: RUNNING, nothing: true },
    en: () => "Translating… 180 of 358",
    es: () => "Traduciendo… 180 de 358",
  },
  {
    name: "done",
    props: { run: run() },
    en: () => "358 suggestions are waiting for review.",
    es: () => "358 sugerencias pendientes de revisar.",
  },
  {
    name: "partly done",
    props: { run: PARTLY },
    en: () =>
      "270 suggestions are waiting for review. | 88 couldn't be done this time. Translate all sends only those.",
    es: () =>
      "270 sugerencias pendientes de revisar. | 88 no se han podido hacer esta vez. Traducir todo envía solo esas.",
  },
  {
    name: "partly done at the spending cap",
    props: { run: { ...PARTLY, code: LIMIT, fits: 0 } },
    en: () => `270 suggestions are waiting for review. | ${codeMessage(LIMIT)}`,
    es: () => `270 sugerencias pendientes de revisar. | ${codeMessage(LIMIT)}`,
  },
  {
    name: "refused at the cap with room left",
    props: { run: run({ state: "refused", code: LIMIT, fits: 40, waiting: 0 }) },
    en: () => `${codeMessage(LIMIT)} 40 more names would fit this month.`,
    es: () => `${codeMessage(LIMIT)} Este mes cabrían 40 nombres más.`,
  },
  {
    name: "refused at the cap with no room",
    props: { run: run({ state: "refused", code: LIMIT, fits: 0, waiting: 0 }) },
    en: () => codeMessage(LIMIT),
    es: () => codeMessage(LIMIT),
  },
  {
    name: "refused for consent",
    props: {
      run: run({ state: "refused", code: CONSENT, waiting: 0 }),
      cloudOrigin: "https://cloud.example.test",
    },
    en: () => `${codeMessage(CONSENT)} Open Waitron Cloud`,
    es: () => `${codeMessage(CONSENT)} Abrir Waitron Cloud`,
  },
  {
    name: "refused for consent with no Cloud origin",
    props: { run: run({ state: "refused", code: CONSENT, waiting: 0 }) },
    en: () => codeMessage(CONSENT),
    es: () => codeMessage(CONSENT),
  },
  {
    name: "failed",
    props: { run: run({ state: "failed", code: "content.suggestion_service_unavailable" }) },
    en: () => codeMessage("content.suggestion_service_unavailable"),
    es: () => codeMessage("content.suggestion_service_unavailable"),
  },
  {
    name: "expired",
    props: { run: run({ state: "expired", code: "content.suggestion_expired" }) },
    en: () => codeMessage("content.suggestion_expired"),
    es: () => codeMessage("content.suggestion_expired"),
  },
  {
    name: "a run that ended with no code to tell",
    props: { run: run({ state: "failed" }) },
    en: () => "",
    es: () => "",
  },
  {
    name: "a press that found nothing",
    props: { run: run(), nothing: true },
    en: () => "Every missing name already has a suggestion.",
    es: () => "Todos los nombres que faltan ya tienen una sugerencia.",
  },
  {
    name: "a refusal",
    props: { error: "Refused." },
    en: () => `${ABOUT_EN} | Refused.`,
    es: () => `${ABOUT_ES} | Refused.`,
  },
];

describe.each([
  ["en-GB", "en"],
  ["es-ES", "es"],
] as const)("the Translate all bar in %s", (locale, column) => {
  it.each(STATES.map((state) => [state.name, state] as const))("shows %s", async (_name, state) => {
    setLocale(locale);
    const { el } = await mount(state.props);
    expect(lines(el)).toBe(state[column]());
    expect(button(el).textContent!.trim()).toBe(
      locale === "en-GB" ? "Translate all" : "Traducir todo",
    );
  });
});

it.each([
  CONSENT,
  LIMIT,
  "content.suggestion_service_unavailable",
  "content.suggestion_expired",
  "content.suggestion_job_running",
])("has its own sentence for %s in both languages", (code) => {
  for (const locale of ["en-GB", "es-ES"]) {
    setLocale(locale);
    expect(codeMessage(code)).not.toBe(codeMessage("no.such_code"));
  }
});

it.each([
  ["it has not read the service yet", { service: null }, true, "secondary", false],
  ["the box is not connected", { service: "not_connected" }, true, "secondary", false],
  ["the service is switched off", { service: "off" }, true, "secondary", false],
  ["it can act", {}, false, "primary", false],
  ["a run is being sent", { run: SENDING }, true, "secondary", false],
  ["a run is running", { run: RUNNING }, true, "secondary", false],
  ["a run is done", { run: run() }, false, "primary", false],
  ["a run is partly done", { run: PARTLY }, false, "primary", false],
  ["a run was refused", { run: run({ state: "refused", code: CONSENT }) }, false, "primary", false],
  ["its own request is being sent", { busy: true }, true, "primary", true],
  ["a refusal is shown", { error: "Refused." }, false, "primary", false],
] as const)("draws the button when %s", async (_name, props, disabled, variant, loading) => {
  const { el } = await mount(props as Partial<ContentSuggestionsBar>);
  expect(button(el).disabled).toBe(disabled);
  expect(button(el).getAttribute("variant")).toBe(variant);
  expect(button(el).loading).toBe(loading);
});

it("asks for Translate all once per press and lets no click escape", async () => {
  const { el, host } = await mount();
  const asked = vi.fn();
  const clicks = vi.fn();
  host.addEventListener("translate-all", asked);
  host.addEventListener("click", clicks);
  await userEvent.click(button(el));
  expect(asked).toHaveBeenCalledOnce();
  expect(clicks).not.toHaveBeenCalled();
  await userEvent.click(button(el));
  expect(asked).toHaveBeenCalledTimes(2);
});

it("asks nothing when its button is clicked while it cannot act", async () => {
  const { el } = await mount({ run: RUNNING });
  const asked = vi.fn();
  el.addEventListener("translate-all", asked);
  // A click on the host reaches the bar's listener even though the inner button is disabled.
  button(el).click();
  await el.updateComplete;
  expect(asked).not.toHaveBeenCalled();
});

it("announces progress and refusals", async () => {
  const { el } = await mount({ run: RUNNING, error: "Refused." });
  expect(q(el, ".lines > p[role=status]")!.textContent).toContain("180");
  expect(q(el, "[data-test=suggestions-error]")!.getAttribute("role")).toBe("alert");
  el.run = SENDING;
  await el.updateComplete;
  expect(q(el, ".lines > p[role=status]")).not.toBeNull();
  el.run = null;
  el.nothing = true;
  await el.updateComplete;
  expect(q(el, ".lines > p[role=status]")).not.toBeNull();
});

it("links a consent refusal to the Cloud account page in a new tab", async () => {
  const { el } = await mount({
    run: run({ state: "refused", code: CONSENT }),
    cloudOrigin: "https://cloud.example.test",
  });
  const link = q(el, "[data-test=suggestions-consent]")!;
  expect(link.getAttribute("href")).toBe("https://cloud.example.test/account");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

it("links a box that is not connected to the Cloud services screen", async () => {
  const { el } = await mount({ service: "not_connected" });
  expect(q(el, "[data-test=suggestions-connect]")!.getAttribute("href")).toBe("/manage/cloud");
  expect(q(el, "[data-test=suggestions-consent]")).toBeNull();
});

it("fits a phone screen without scrolling sideways", async () => {
  const { el, host } = await mount({ service: "not_connected", error: "Refused." });
  host.style.inlineSize = "343px";
  await el.updateComplete;
  const bar = q(el, ".bar")!;
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  expect(button(el).getBoundingClientRect().right).toBeLessThanOrEqual(
    host.getBoundingClientRect().right + 0.5,
  );
});
