import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, RecoveryPackStatus } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { RecoveryPackCard } from "./recovery-pack-card.js";
import "./recovery-pack-card.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const MADE_AT = "2026-10-12T10:00:00.000Z";
const BASE: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  timeZone: "Europe/Madrid",
};
const LATEST: NonNullable<RecoveryPackStatus["latest"]> = {
  number: 3,
  madeAt: MADE_AT,
  madeByName: "Marta Puig",
  received: true,
  parts: [
    { part: "bucket", state: "included" },
    { part: "archives", state: "included" },
    { part: "server-key", state: "included" },
  ],
};

const STATES: Record<string, RecoveryPackStatus> = {
  none: BASE,
  "up to date": { ...BASE, latest: LATEST, upToDate: true },
  "out of date": {
    ...BASE,
    latest: LATEST,
    reasons: [{ part: "bucket", kind: "key_changed", at: "2026-10-20T10:00:00.000Z" }],
    keep: [
      { number: 1, madeAt: "2026-09-02T10:00:00.000Z", until: null, why: "server_key" },
      { number: 3, madeAt: MADE_AT, until: "2026-11-19T10:00:00.000Z", why: "backup_key" },
    ],
    backupsUseOlderKey: true,
  },
  incomplete: {
    ...BASE,
    latest: { ...LATEST, parts: [{ part: "archives", state: "failed" }] },
    incomplete: true,
  },
  unreceived: {
    ...BASE,
    latest: { ...LATEST, number: 4, received: false },
    unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
  },
};

describe.each(["light", "dark"] as const)("recovery pack card accessibility (%s)", (theme) => {
  it.each(
    Object.keys(STATES).flatMap((state) => [
      { state, locale: "en-GB" },
      { state, locale: "es-ES" },
    ]),
  )("draws $state in $locale", async ({ state, locale }) => {
    setLocale(locale);
    const api = {
      getRecoveryPackStatus: vi.fn().mockResolvedValue(STATES[state]),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<RecoveryPackCard>(
      "dashboard-recovery-pack-card",
      { api, canManage: true },
      theme,
    );
    await expect.poll(() => el.shadowRoot!.querySelector("dl")).not.toBeNull();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("draws a read failure and a made pack's links", async () => {
    const api = {
      getRecoveryPackStatus: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<RecoveryPackCard>(
      "dashboard-recovery-pack-card",
      { api, canManage: true },
      theme,
    );
    el.shadowRoot!.querySelector("dashboard-recovery-pack-dialog")!.dispatchEvent(
      new CustomEvent("recovery-pack-made", {
        detail: {
          pdf: new Blob(["%PDF"], { type: "application/pdf" }),
          number: 4,
          key: "unchanged",
          received: true,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=pack-load-failed]"))
      .not.toBeNull();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=download-pack]"))
      .not.toBeNull();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
