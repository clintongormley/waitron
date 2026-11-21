import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { DashboardApi, type BoxUpgradeSettings } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  dialogClosed,
  dialogMessageOf,
  expectMessageAboveButtons,
  mountWidget,
} from "../widgets/test-helpers.js";
import "./upgrade-settings-dialog.js";

const SETTINGS: BoxUpgradeSettings = {
  version: 1,
  revision: 7,
  automatic: true,
  start: "03:00",
  end: "05:00",
};
const PATH = "/api/box/upgrade-settings";
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

async function open(
  fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(SETTINGS)),
) {
  const { el, host } = await mountWidget<
    HTMLElementTagNameMap["dashboard-upgrade-settings-dialog"]
  >("dashboard-upgrade-settings-dialog", { api: new DashboardApi("", fetchImpl) });
  const opener = document.createElement("button");
  host.prepend(opener);
  opener.focus();
  await el.show(opener);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  return { dialog, fetchImpl, opener };
}

const save = (dialog: Element) =>
  dialog.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button[data-test=save]")!;
const field = (dialog: Element, name: "start" | "end") =>
  dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${name}]`)!;

async function edit(dialog: Element, name: "start" | "end", value: string) {
  const control = field(dialog, name).shadowRoot!.querySelector("input")!;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

it("pauses automation without changing the hours and returns focus after saving", async () => {
  const { dialog, fetchImpl, opener } = await open();
  expect(fetchImpl.mock.calls[0]?.[0]).toBe(PATH);
  expect(save(dialog).disabled).toBe(true);
  expect(save(dialog).variant).toBe("secondary");

  const automatic = dialog.querySelector("wt-switch")!;
  expect(automatic.checked).toBe(true);
  await userEvent.click(automatic);
  expect(save(dialog).disabled).toBe(false);
  const closed = dialogClosed(dialog);
  await userEvent.click(save(dialog));
  await closed;
  const [path, options] = fetchImpl.mock.calls[1]!;
  expect(path).toBe(PATH);
  expect(options?.method).toBe("POST");
  expect(JSON.parse(String(options?.body))).toEqual({
    revision: 7,
    automatic: false,
    start: "03:00",
    end: "05:00",
  });
  expect(document.activeElement).toBe(opener);
});

it("validates a partial pair and a short window, then saves an explicitly cleared pair", async () => {
  const { dialog, fetchImpl } = await open();
  await edit(dialog, "end", "");
  await userEvent.click(save(dialog));
  await expect.poll(() => field(dialog, "end").error).toBe("Enter an end time.");
  expect(save(dialog).disabled).toBe(true);
  await expectMessageAboveButtons(
    dialog,
    save(dialog),
    "Correct the highlighted fields to continue.",
  );
  await edit(dialog, "end", "03:59");
  await expect.poll(() => field(dialog, "end").error).toBe("Allow at least 60 minutes.");
  expect(save(dialog).disabled).toBe(true);

  await edit(dialog, "end", "");
  await edit(dialog, "start", "");
  await expect.poll(() => save(dialog).disabled).toBe(false);
  expect(dialog.textContent).toContain("The box skips offered installs when both times are empty.");
  const closed = dialogClosed(dialog);
  await userEvent.click(save(dialog));
  await closed;
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
    revision: 7,
    automatic: true,
    start: null,
    end: null,
  });
});

it.each([
  [
    "upgrade.settings_stale",
    409,
    "Someone saved different upgrade settings. Close and reopen this dialog to see them.",
  ],
  ["upgrade.settings_busy", 409, "Another save is in progress. Wait a moment and try again."],
  [
    "upgrade.settings_unavailable",
    503,
    "The box could not confirm the save. Try again, or close and reopen this dialog to check the saved settings.",
  ],
  [
    "node.read_only",
    403,
    "Upgrade settings are read-only on this box. To change the main box’s settings, open its Box status page.",
  ],
] as const)("shows the %s refusal below the draft", async (code, status, sentence) => {
  const { dialog } = await open(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, options) =>
        options?.method === "POST"
          ? Response.json({ error: { code, params: {} } }, { status })
          : Response.json(SETTINGS),
      ),
  );
  await edit(dialog, "start", "23:50");
  await edit(dialog, "end", "00:50");
  await userEvent.click(save(dialog));
  await expect.poll(() => dialogMessageOf(dialog)).toBe(sentence);
  expect(field(dialog, "start").value).toBe("23:50");
  expect(field(dialog, "end").value).toBe("00:50");
  expect(save(dialog).disabled).toBe(false);
});

it("explains a failed open without showing default hours from a different box", async () => {
  const { dialog } = await open(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json(
          { error: { code: "upgrade.settings_unavailable", params: {} } },
          { status: 503 },
        ),
      ),
  );
  expect(await dialogMessageOf(dialog)).toBe(
    "The box could not read upgrade settings. Close and reopen this dialog. If the problem continues, check the upgrade settings at the box console.",
  );
  expect(field(dialog, "start")).toBeNull();
  expect(save(dialog).disabled).toBe(true);
});
