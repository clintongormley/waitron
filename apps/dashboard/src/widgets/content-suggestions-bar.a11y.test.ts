import { afterEach, describe, it } from "vitest";
import type { SuggestionRunView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./content-suggestions-bar.js";
import type { ContentSuggestionsBar } from "./content-suggestions-bar.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const run = (overrides: Partial<SuggestionRunView>): SuggestionRunView => ({
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

const STATES: [string, Partial<ContentSuggestionsBar>][] = [
  ["not read yet", { service: null }],
  ["not connected", { service: "not_connected" }],
  ["switched off", { service: "off" }],
  ["ready", {}],
  ["waiting fixes without a run", { waitingFixes: 4 }],
  ["waiting fixes while locked", { waitingFixes: 4, reviewDisabled: true }],
  ["sending", { run: run({ state: "sending", progress: 0, done: 0, waiting: 0 }) }],
  ["running", { run: run({ state: "running", progress: 180, done: 180, waiting: 0 }) }],
  ["done", { run: run({}) }],
  ["partly done", { run: run({ state: "partly_done", failed: 88, waiting: 270 }) }],
  [
    "refused for consent",
    {
      run: run({ state: "refused", code: "content.suggestion_consent_required" }),
      cloudOrigin: "https://cloud.example.test",
    },
  ],
  [
    "refused at the cap",
    { run: run({ state: "refused", code: "content.suggestion_limit_reached", fits: 40 }) },
  ],
  ["expired", { run: run({ state: "expired", code: "content.suggestion_expired" }) }],
  ["nothing missing", { nothing: true }],
  ["sending its own request", { busy: true }],
  ["showing a refusal", { error: "Waitron could not reach Cloud or verify its reply. Try again." }],
];

describe.each(["light", "dark"] as const)("Translate all bar accessibility (%s)", (theme) => {
  it.each(STATES)("%s, in both languages", async (_name, props) => {
    for (const locale of ["en-GB", "es-ES"]) {
      cleanupWidgets();
      setLocale(locale);
      const { host } = await mountWidget<ContentSuggestionsBar>(
        "dashboard-content-suggestions-bar",
        {
          service: "on",
          run: null,
          busy: false,
          error: "",
          nothing: false,
          cloudOrigin: null,
          ...props,
        },
        theme,
      );
      await expectNoA11yViolations(host);
    }
  });
});
