import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  chooseFiles,
  chooseOption,
  drawnFileName,
  fileControl,
} from "@waitron/ui/src/test-helpers.js";
import type { WtFileInput } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { SetupApi } from "../api/client.js";
import { encodeMasterKeyCode } from "@waitron/shared";
import {
  cleanupWidgets,
  mountWidget,
  mountWithLeave,
  REVIEWED_CREDENTIALS,
  REVIEWED_PREVIEW,
  enterRecoveryDetails,
  reviewBackup,
  typeMasterKey,
} from "../widgets/test-helpers.js";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { MAX_PACK_PDF } from "@waitron/recovery-pack/src/pack-file.js";
import { loadRecoveryPackReader } from "@waitron/recovery-pack/src/load-pack-reader.js";
import type { KeptRestoreRequest, RestoreRequestDetail } from "../events.js";
import { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

const BACKUP = new File(["encrypted"], "waitron.backup");

/** A whole master key, as the field prints it; the recovery details `reviewBackup` enters use it too. */
const KEY = REVIEWED_CREDENTIALS.nodeRecoverySecret;
const OTHER_KEY = encodeMasterKeyCode(new Uint8Array(16).fill(3));

/** The master key's own `<input>`, inside the shared field. */
const keyControl = (el: SetupRestoreScreen): HTMLInputElement =>
  q(el, "[data-test=master-key]")!
    .shadowRoot!.querySelector('wt-input[name="master-key"]')!
    .shadowRoot!.querySelector("input")!;

const artifactPicker = (el: SetupRestoreScreen) => q<WtFileInput>(el, "[data-test=artifact]")!;
const chooseBackup = (el: SetupRestoreScreen, backup: File) =>
  chooseFiles(artifactPicker(el), backup);

/** The box `wt-file-input` draws its rings on. */
const fileField = (el: SetupRestoreScreen): Element =>
  artifactPicker(el).shadowRoot!.querySelector("[part=field]")!;

async function typeKey(el: SetupRestoreScreen, value: string): Promise<void> {
  await typeMasterKey(el, value);
  await el.updateComplete;
}

async function fill(
  el: SetupRestoreScreen,
  decisions: { artifact?: boolean; masterKey?: boolean; acknowledge?: boolean },
): Promise<void> {
  if (decisions.artifact) {
    chooseBackup(el, BACKUP);
  }
  if (decisions.masterKey) await typeKey(el, KEY);
  if (decisions.acknowledge) {
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
  }
  await el.updateComplete;
}

/** The one message `wt-form-actions` shows above Restore; "" when there is none. */
async function bottomOf(el: SetupRestoreScreen): Promise<string> {
  const actions = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

/** The messages shown under the fields, in page order: the screen's own paragraphs, and each
 * shared field's `error`. */
function fieldMessages(el: SetupRestoreScreen): string[] {
  return [
    ...el.shadowRoot!.querySelectorAll<HTMLElement & { error?: string }>(
      "p.error[id$='-error'], wt-file-input, wt-master-key-input, wt-input, wt-combobox",
    ),
  ]
    .map((node) => (node instanceof HTMLParagraphElement ? node.textContent! : node.error!).trim())
    .filter((message) => message !== "");
}

function expectDangerRing(box: Element): void {
  expect(getComputedStyle(box).boxShadow).toContain("rgb(4, 5, 6)");
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";
const REVIEW_FIRST =
  "Press Review backup and enter the recovery details it asks for before you restore.";

describe("SetupRestoreScreen", () => {
  it("opens guided Cloud recovery from backup file restore", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const navigation = vi.fn();
    host.addEventListener("setup-goto", navigation);
    q(el, "[data-test=cloud-restore]")!.click();
    expect(navigation.mock.calls[0]?.[0].detail).toEqual({ screen: "cloud-restore" });
  });

  it("marks every required decision and emits nothing when blank", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    const actions = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "wt-form-actions")!;
    await actions.updateComplete;
    expect(actions.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[required]")).toHaveLength(4);
  });

  it.each([
    ["en-GB", "Press Review backup and enter the recovery details it asks for before you restore."],
    [
      "es-ES",
      "Pulsa Revisar copia e introduce los datos de recuperación que pide antes de restaurar.",
    ],
  ] as const)("sends nothing and asks for Review backup first in %s", async (locale, line) => {
    setLocale(locale);
    try {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      const listener = vi.fn();
      host.addEventListener("restore-requested", listener);
      await fill(el, { artifact: true, masterKey: true, acknowledge: true });
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(listener).not.toHaveBeenCalled();
      expect(await bottomOf(el)).toBe(line);
    } finally {
      setLocale("en-GB");
    }
  });

  it("drops the Review backup line, and gives Restore back, when the file it was for is discarded", async () => {
    const { el, discard } = await mountWithLeave<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    const restore = q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!;
    expect(await bottomOf(el)).toBe(REVIEW_FIRST);
    expect(restore.disabled).toBe(true);
    await discard();
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(""));
    expect(restore.disabled).toBe(false);
  });

  it("drops the Review backup line once Review backup answers, and then sends", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(REVIEW_FIRST);
    await reviewBackup(el);
    expect(await bottomOf(el)).toBe("");
    q(el, "[data-test=restore]")!.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("drops the Review backup line when another file is chosen, and shows it again on Restore", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(REVIEW_FIRST);
    chooseBackup(el, new File(["other"], "other.backup"));
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(""));
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(REVIEW_FIRST);
  });

  it("sends nothing after Review backup until its recovery details are entered", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      api: new SetupApi("", async () => Response.json(REVIEWED_PREVIEW)),
    });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    const copy = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "setup-recovery-copy")!;
    await copy.updateComplete;
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(copy.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
    );
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("emits the artifact, master key, environment and acknowledgement", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const artifact = new File(["encrypted"], "waitron.backup");
    chooseBackup(el, artifact);
    await typeKey(el, KEY);
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const outcome = new Promise<RestoreRequestDetail>((resolve) =>
      host.addEventListener("restore-requested", (event: Event) => {
        resolve((event as CustomEvent<{ request: RestoreRequestDetail }>).detail.request);
      }),
    );
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      ...REVIEWED_CREDENTIALS,
      artifact,
      masterKey: KEY,
      environment: "production",
      oldBoxGone: false,
    });
  });

  it("picks the environment from the shared dropdown, with its help beside the box", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const environment = q<
      HTMLElement & {
        options: { value: string; label: string }[];
        value: string;
        required: boolean;
        label: string;
        search: string;
      }
    >(el, 'wt-combobox[name="environment"]');
    expect(environment).not.toBeNull();
    expect({
      label: environment!.label,
      required: environment!.required,
      search: environment!.search,
      value: environment!.value,
      options: environment!.options.map(({ value, label }) => ({ value, label })),
    }).toEqual({
      label: "Backup environment",
      required: true,
      search: "auto",
      value: "production",
      options: [
        { value: "production", label: "Live" },
        { value: "preproduction", label: "Preparation or demo" },
      ],
    });
    expect(
      environment!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label"),
    ).toBe("Help with backup environment");
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    await chooseOption(environment!, "preproduction");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .environment,
    ).toBe("preproduction");
  });

  it("restores a preparation backup when the operator picks that environment", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      {
        ...REVIEWED_CREDENTIALS,
        artifact: BACKUP,
        masterKey: KEY,
        environment: "preproduction",
        oldBoxGone: false,
      },
    ]);
  });

  it.each([
    ["the backup file", { masterKey: true, acknowledge: true }, "Choose a backup file."],
    ["the master key", { artifact: true, acknowledge: true }, "Enter the master key."],
    [
      "the confirmation",
      { artifact: true, masterKey: true },
      "Confirm that no other running box has newer data.",
    ],
  ])("lists only %s when it is the one decision missing", async (_, decisions, message) => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await fill(el, decisions);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual([message]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("asks the old-server question when the old server wrote recently, and sends the answer", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("2026-09-23T11:58:00.000Z");
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual(["Confirm that the old box is switched off for good."]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirm that the old box is switched off for good.",
    );
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .oldBoxGone,
    ).toBe(true);
  });

  it("asks the same question when whether the old server is writing could not be checked", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      liveUnknown: true,
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("could not be checked");
    expect(q(el, "[data-test=old-box-gone]")).not.toBeNull();
  });

  it("sends no old-server answer when it was not asked", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .oldBoxGone,
    ).toBe(false);
  });

  // The old-server question is answered by sending the same backup again; the shell hands the last
  // request back so the file does not have to be chosen and the key typed a second time.
  it("comes back from a refusal with the backup, the key and the answers kept", async () => {
    const request: KeptRestoreRequest = {
      artifact: BACKUP,
      masterKey: KEY,
      environment: "preproduction",
      oldBoxGone: false,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveUnknown: true,
    });
    expect(artifactPicker(el).files[0]).toBe(BACKUP);
    await artifactPicker(el).updateComplete;
    expect(drawnFileName(artifactPicker(el))).toBe("waitron.backup");
    expect(keyControl(el).value).toBe(KEY);
    expect(q<HTMLSelectElement>(el, "[data-test=environment]")!.value).toBe("preproduction");
    expect(q<HTMLInputElement>(el, "[data-test=acknowledge]")!.checked).toBe(true);
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, ...REVIEWED_CREDENTIALS, oldBoxGone: true },
    ]);
  });

  // The old-server check was made on the backup that was sent; another file is another copy.
  it("drops the old-server answer when a different backup file is chosen", async () => {
    const request: KeptRestoreRequest = {
      artifact: BACKUP,
      masterKey: KEY,
      environment: "production",
      oldBoxGone: true,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(true);
    const other = new File(["other"], "other.backup");
    chooseBackup(el, other);
    await el.updateComplete;
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, ...REVIEWED_CREDENTIALS, artifact: other, oldBoxGone: false },
    ]);
  });

  describe("messages above Restore (design-system.md, Forms)", () => {
    it("says nothing and leaves Restore working before the first press", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      expect(await bottomOf(el)).toBe("");
      expect(fieldMessages(el)).toEqual([]);
      expect(q(el, "wt-form-error-summary")).toBeNull();
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    });

    it("marks each missing decision, says one sentence above Restore, focuses the first, and holds Restore", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(fieldMessages(el)).toHaveLength(3);
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q(el, "wt-form-error-summary")).toBeNull();
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=artifact]")),
      );
    });

    it("clears each message as its decision is made, and gives Restore back when the last is", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      await fill(el, { artifact: true, masterKey: true });
      expect(fieldMessages(el)).toEqual(["Confirm that no other running box has newer data."]);
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
      await fill(el, { acknowledge: true });
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    });

    it("marks a decision again when it is undone after the press", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      await fill(el, { artifact: true, acknowledge: true });
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      await fill(el, { masterKey: true });
      expect(fieldMessages(el)).toEqual([]);
      await typeKey(el, "");
      expect(fieldMessages(el)).toEqual(["Enter the master key."]);
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
    });

    it("shows the server's refusal above Restore, leaves Restore working, and drops it on the next press", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        errorMessage: "The backup could not be staged. Check the connection and try again.",
      });
      expect(await bottomOf(el)).toBe(
        "The backup could not be staged. Check the connection and try again.",
      );
      expect(q(el, "[data-test=server-error]")).toBeNull();
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
    });

    it("keeps a field's refusal away once the owner edits the field, through a new message about it", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        errorMessage: "Check the environment.",
        invalidField: "environment",
      });
      expect(fieldMessages(el)).toEqual(["Check the environment."]);
      await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      el.errorMessage = "Still the wrong environment.";
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
    });

    it("keeps a pressed-away refusal away when the server then names a field for it", async () => {
      const refusal = "The backup could not be staged. Check the connection and try again.";
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        errorMessage: refusal,
      });
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      const pressed = fieldMessages(el);
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      el.invalidField = "environment";
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual(pressed);
      expect(fieldMessages(el)).not.toContain(refusal);
    });

    it("rings a missing backup file only after Restore is pressed, and not once one is chosen", async () => {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      const picker = artifactPicker(el);
      expect(getComputedStyle(fileField(el)).boxShadow).not.toContain("rgb(4, 5, 6)");
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      await picker.updateComplete;
      expectDangerRing(fileField(el));
      await fill(el, { artifact: true });
      await picker.updateComplete;
      expect(getComputedStyle(fileField(el)).boxShadow).not.toContain("rgb(4, 5, 6)");
    });

    // The shared field draws no focus ring of its own; its red line stands in while it is invalid
    // (design-system.md, Forms → Focus).
    it("keeps keyboard focus on a missing backup file under the danger ring", async () => {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      await artifactPicker(el).updateComplete;
      const file = fileControl(artifactPicker(el));
      await userEvent.keyboard("{Shift}");
      file.focus();
      expect(file.matches(":focus-visible")).toBe(true);
      expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=artifact]"));
      expectDangerRing(fileField(el));
    });
  });

  describe("a refusal about one field", () => {
    const REQUEST: KeptRestoreRequest = {
      artifact: BACKUP,
      masterKey: KEY,
      environment: "production",
      oldBoxGone: false,
    };
    const REFUSAL = {
      artifact: "Check the backup file.",
      masterKey: "Check the master key.",
      environment: "Check the backup environment.",
    } as const;

    it("shows it under that field and focuses it, leaving Restore working", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.masterKey,
        invalidField: "masterKey",
      });
      await new Promise((resolve) => setTimeout(resolve));
      const key = q<HTMLInputElement>(el, "[data-test=master-key]")!;
      expect(fieldMessages(el)).toEqual([REFUSAL.masterKey]);
      expect(keyControl(el).getAttribute("aria-invalid")).toBe("true");
      expect(el.shadowRoot!.activeElement).toBe(key);
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!.disabled).toBe(
        false,
      );

      await typeKey(el, OTHER_KEY);
      await (key as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(keyControl(el).getAttribute("aria-invalid")).toBe("false");
      expect(await bottomOf(el)).toBe("");
    });

    it.each([
      ["artifact", (el: SetupRestoreScreen) => fileControl(artifactPicker(el))],
      [
        "environment",
        (el: SetupRestoreScreen) =>
          q(el, "[data-test=environment]")!.shadowRoot!.querySelector(".trigger")!,
      ],
    ] as const)("marks the %s field it names", async (field, control) => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL[field],
        invalidField: field,
      });
      expect(control(el).getAttribute("aria-invalid")).toBe("true");
      expect(fieldMessages(el)).toEqual([REFUSAL[field]]);
    });

    it("outlines the environment dropdown it names in the danger colour", async () => {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.environment,
        invalidField: "environment",
      });
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      const box = q(el, "[data-test=environment]")!.shadowRoot!.querySelector("[part=field]")!;
      expect(getComputedStyle(box).boxShadow).toContain("rgb(4, 5, 6)");
    });

    it("rings the backup file it names in the danger colour", async () => {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.artifact,
        invalidField: "artifact",
      });
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      await artifactPicker(el).updateComplete;
      expectDangerRing(fileField(el));
    });

    it("drops it when the named field changes", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.environment,
        invalidField: "environment",
      });
      await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
    });

    it("drops it on the next press and sends the request again", async () => {
      const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.artifact,
        invalidField: "artifact",
      });
      const listener = vi.fn();
      host.addEventListener("restore-requested", listener);
      await reviewBackup(el);
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(listener).toHaveBeenCalledOnce();
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
    });
  });

  it("steps back to the role screen", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    q(el, "[data-test=back]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "role",
    ]);
  });
});

describe("SetupRestoreScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("asks for the backup, the key and the confirmation in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde una copia de seguridad");
    const picker = artifactPicker(el);
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain("Archivo de copia de seguridad");
    expect(q(el, "[data-test=restore]")!.textContent).toBe("Restaurar la copia");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([
      "Elige un archivo de copia de seguridad.",
      "Escribe la clave maestra.",
      "Confirma que ningún otro servidor en funcionamiento tiene datos más recientes.",
    ]);
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  });

  it("asks the old-server question in Spanish, with the time in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    const warning = q(el, "[data-test=live-warning]")!.textContent!;
    expect(warning).toContain("El servidor anterior escribió en su bucket el");
    expect(warning).toContain("Apágalo para siempre antes de continuar.");
    expect(q(el, "[data-test=live-warning] time")!.textContent).toContain("sept");
    await fill(el, { artifact: true, masterKey: true, acknowledge: true });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirma que el servidor anterior está apagado para siempre.",
    );
  });

  it("switches language live, keeping the master key already typed", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { masterKey: true });
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde una copia de seguridad");
    expect(keyControl(el).value).toBe(KEY);
  });
});

describe("SetupRestoreScreen environment from Review backup", () => {
  /** A file preview that refuses any environment but the copy's own, as `restore-gate.ts` does. */
  function previewsAs(copyEnvironment: "production" | "preproduction", refusal?: object) {
    const sent: string[] = [];
    const api = new SetupApi("", async (_input, init) => {
      const environment = new Headers(init!.headers).get("x-waitron-restore-environment")!;
      sent.push(environment);
      if (refusal !== undefined) return Response.json({ error: refusal }, { status: 422 });
      if (environment !== copyEnvironment)
        return Response.json(
          {
            error: {
              code: "restore.environment_mismatch",
              params: { backup: copyEnvironment, target: environment },
            },
          },
          { status: 409 },
        );
      return Response.json({ ...REVIEWED_PREVIEW, environment: copyEnvironment });
    });
    return { api, sent };
  }

  async function mountWith(api: SetupApi) {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", { api });
    await fill(el, { artifact: true, masterKey: true });
    const copy = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "setup-recovery-copy")!;
    await copy.updateComplete;
    return { el, copy };
  }

  const environmentField = (el: SetupRestoreScreen) =>
    q<HTMLElement & { value: string; error: string }>(el, "[data-test=environment]")!;

  it("takes a pre-production copy's environment from one Review press, with no error shown", async () => {
    const { api, sent } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    expect(environmentField(el).value).toBe("production");
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() => expect(copy.shadowRoot!.textContent).toContain("Amber Hill"));
    await el.updateComplete;
    expect(sent).toEqual(["production", "preproduction"]);
    expect(environmentField(el).value).toBe("preproduction");
    expect(environmentField(el).error).toBe("");
    expect(fieldMessages(el)).toEqual([]);
    expect(copy.shadowRoot!.textContent).not.toContain("Check the backup environment.");
  });

  it("leaves the environment alone when Review is refused for another reason", async () => {
    const { api, sent } = previewsAs("preproduction", { code: "promotion.break_glass_invalid" });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() => expect(fieldMessages(el)).toEqual(["Check the master key."]));
    expect(sent).toEqual(["production"]);
    expect(environmentField(el).value).toBe("production");
  });

  it("shows the environment refusal when it does not name the copy's environment", async () => {
    const { api, sent } = previewsAs("preproduction", { code: "restore.environment_mismatch" });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(environmentField(el).error).toBe("Check the backup environment."),
    );
    expect(sent).toEqual(["production"]);
    expect(environmentField(el).value).toBe("production");
  });

  it("switches the environment once per edit, however the refusals disagree", async () => {
    const sent: string[] = [];
    const api = new SetupApi("", async (_input, init) => {
      const environment = new Headers(init!.headers).get("x-waitron-restore-environment")!;
      sent.push(environment);
      const backup = environment === "production" ? "preproduction" : "production";
      return Response.json(
        {
          error: { code: "restore.environment_mismatch", params: { backup, target: environment } },
        },
        { status: 409 },
      );
    });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(environmentField(el).error).toBe("Check the backup environment."),
    );
    expect(sent).toEqual(["production", "preproduction"]);
  });

  const followedNote = (el: SetupRestoreScreen) =>
    q(el, "[data-test=environment-followed]")?.textContent?.trim();

  async function reviewAndWait(el: SetupRestoreScreen, copy: HTMLElement) {
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() => expect(copy.shadowRoot!.textContent).toContain("Amber Hill"));
    await el.updateComplete;
  }

  it("says the environment now matches the copy once it has switched it", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    expect(followedNote(el)).toBe(
      "This backup is from “Preparation or demo”, so Backup environment now matches it.",
    );
    expect(q(el, "[data-test=environment-followed]")!.getAttribute("role")).toBe("status");
    expect(q<HTMLElement>(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  it("says nothing about the environment when the copy already matches it", async () => {
    const { api, sent } = previewsAs("production");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    expect(sent).toEqual(["production"]);
    expect(followedNote(el)).toBeUndefined();
  });

  it("says nothing about the environment when Review is refused for another reason", async () => {
    const { api } = previewsAs("preproduction", { code: "promotion.break_glass_invalid" });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() => expect(fieldMessages(el)).toEqual(["Check the master key."]));
    expect(followedNote(el)).toBeUndefined();
  });

  it("shows no note beside a second environment refusal", async () => {
    const api = new SetupApi("", async (_input, init) => {
      const environment = new Headers(init!.headers).get("x-waitron-restore-environment")!;
      const backup = environment === "production" ? "preproduction" : "production";
      return Response.json(
        {
          error: { code: "restore.environment_mismatch", params: { backup, target: environment } },
        },
        { status: 409 },
      );
    });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(environmentField(el).error).toBe("Check the backup environment."),
    );
    expect(followedNote(el)).toBeUndefined();
  });

  it("keeps the note when the person types a new master key", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    await typeKey(el, OTHER_KEY);
    expect(keyControl(el).value).toBe(OTHER_KEY);
    expect(followedNote(el)).toBe(
      "This backup is from “Preparation or demo”, so Backup environment now matches it.",
    );
  });

  it("drops the note when the person changes the environment", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    await chooseOption(environmentField(el), "production");
    await el.updateComplete;
    expect(followedNote(el)).toBeUndefined();
  });

  it("drops the note and switches again after the person chooses another file", async () => {
    const sent: string[] = [];
    let copyEnvironment = "preproduction";
    const api = new SetupApi("", async (_input, init) => {
      const environment = new Headers(init!.headers).get("x-waitron-restore-environment")!;
      sent.push(environment);
      if (environment !== copyEnvironment)
        return Response.json(
          {
            error: {
              code: "restore.environment_mismatch",
              params: { backup: copyEnvironment, target: environment },
            },
          },
          { status: 409 },
        );
      return Response.json({ ...REVIEWED_PREVIEW, environment: copyEnvironment });
    });
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    expect(environmentField(el).value).toBe("preproduction");

    copyEnvironment = "production";
    chooseBackup(el, new File(["other"], "live.backup"));
    await el.updateComplete;
    await copy.updateComplete;
    expect(followedNote(el)).toBeUndefined();
    await reviewAndWait(el, copy);
    expect(sent).toEqual(["production", "preproduction", "preproduction", "production"]);
    expect(environmentField(el).value).toBe("production");
    expect(environmentField(el).error).toBe("");
    expect(followedNote(el)).toBe(
      "This backup is from “Live”, so Backup environment now matches it.",
    );
  });
});

describe("Restore from backup's master key", () => {
  afterEach(() => setLocale("en-GB"));
  const KEY = REVIEWED_CREDENTIALS.nodeRecoverySecret;
  const KEY_NAME = "2026-11-23 · QZJV";
  type KeyField = HTMLElement & {
    updateComplete: Promise<unknown>;
    copy?: { label: string };
    error: string;
    required: boolean;
    readPack?: unknown;
    maxPdfBytes?: number;
    pdfRead: Promise<void> | null;
  };
  const keyField = (el: SetupRestoreScreen) => q<KeyField>(el, "wt-master-key-input")!;
  /** The text input inside the master-key field, and the shared field drawing it. */
  async function keyText(el: SetupRestoreScreen) {
    await keyField(el).updateComplete;
    const input = keyField(el).shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown>; label: string; hint?: string }
    >('wt-input[name="master-key"]')!;
    await input.updateComplete;
    return { field: input, control: input.shadowRoot!.querySelector("input")! };
  }
  async function acknowledged(el: SetupRestoreScreen) {
    chooseBackup(el, BACKUP);
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await el.updateComplete;
  }
  function requested(host: HTMLElement): Promise<RestoreRequestDetail> {
    return new Promise((resolve) =>
      host.addEventListener("restore-requested", (event: Event) =>
        resolve((event as CustomEvent<{ request: RestoreRequestDetail }>).detail.request),
      ),
    );
  }

  it("asks for the master key in the shared field, with the scan and PDF controls", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const field = keyField(el);
    expect(field).not.toBeNull();
    expect(q(el, 'wt-input[name="recovery-key"]')).toBeNull();
    expect(field.required).toBe(true);
    expect(field.readPack).toBe(loadRecoveryPackReader);
    expect(field.maxPdfBytes).toBe(MAX_PACK_PDF);
    const { field: text } = await keyText(el);
    expect(text.label).toBe("Master key");
    expect(text.getAttribute("hint")).toBeNull();
    expect(
      [...field.shadowRoot!.querySelectorAll("wt-button")].map((button) =>
        button.textContent!.trim(),
      ),
    ).toContain("Choose the recovery pack PDF");
  });

  it("a pack PDF fills the master key", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await acknowledged(el);
    const field = keyField(el);
    field.readPack = async () => async () => ({
      masterKey: KEY,
      masterKeyName: KEY_NAME,
      masterKeyHeldBy: null,
    });
    const chooser = field.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = new DataTransfer();
    files.items.add(new File(["%PDF-1.7"], "pack.pdf", { type: "application/pdf" }));
    chooser.files = files.files;
    chooser.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => field.pdfRead).not.toBeNull();
    await field.pdfRead;
    await el.updateComplete;
    const outcome = requested(host);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect((await outcome).masterKey).toBe(KEY);
  });

  it("the master key typed once opens the backup and authorises recovery", async () => {
    const opened: Array<string | null> = [];
    const api = new SetupApi("", async (_url, init) => {
      opened.push(new Headers(init?.headers).get("x-waitron-master-key"));
      return Response.json(REVIEWED_PREVIEW);
    });
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", { api });
    await acknowledged(el);
    await typeMasterKey(el, KEY);
    await el.updateComplete;
    const copy = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "setup-recovery-copy")!;
    await copy.updateComplete;
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(copy.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
    );
    expect(opened).toEqual([KEY]);
    const allocation = copy.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("setup-recovery-allocation")!;
    await allocation.updateComplete;
    expect(allocation.shadowRoot!.querySelector("wt-master-key-input")).toBeNull();
    await enterRecoveryDetails(allocation);
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    const request = await outcome;
    expect({
      masterKey: request.masterKey,
      nodeRecoverySecret: request.nodeRecoverySecret,
    }).toEqual({ masterKey: KEY, nodeRecoverySecret: KEY });
  });

  it.each([
    ["en-GB", "en"],
    ["es-ES", "es"],
  ] as const)(
    "a wrong master key at Review shows the key to use under the field in %s",
    async (locale, words) => {
      setLocale(locale);
      const api = new SetupApi("", async () =>
        Response.json(
          {
            error: {
              code: "promotion.break_glass_invalid",
              params: { masterKeyId: "key-2", keyNumber: 2, keyName: KEY_NAME },
            },
          },
          { status: 400 },
        ),
      );
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", { api });
      await acknowledged(el);
      await typeMasterKey(el, KEY);
      await el.updateComplete;
      const copy = q<HTMLElement & { updateComplete: Promise<unknown> }>(
        el,
        "setup-recovery-copy",
      )!;
      await copy.updateComplete;
      copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
      const line = MASTER_KEY_FIELD_WORDS[words].wrongKey(KEY_NAME);
      await vi.waitFor(() => expect(keyField(el).error).toBe(line));
      expect(line).toContain(KEY_NAME);
    },
  );

  it("the typed master key survives a refusal and a language switch", async () => {
    const request: KeptRestoreRequest = {
      artifact: BACKUP,
      masterKey: KEY,
      environment: "production",
      oldBoxGone: false,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      errorMessage: "Check the master key.",
      invalidField: "masterKey",
    });
    const shown = async () => (await keyText(el)).control.value.replaceAll(" ", "");
    expect(await shown()).toBe(KEY.replaceAll(" ", ""));
    expect(keyField(el).error).toBe("Check the master key.");
    setLocale("es-ES");
    await el.updateComplete;
    expect(await shown()).toBe(KEY.replaceAll(" ", ""));
    expect((await keyText(el)).field.label).toBe("Clave maestra");
    const outcome = requested(host);
    await reviewBackup(el);
    q(el, "[data-test=restore]")!.click();
    expect((await outcome).masterKey).toBe(KEY);
  });
});
