import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { RestoreRequestDetail } from "../events.js";
import { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

const BACKUP = new File(["encrypted"], "waitron.backup");

/** The recovery key's own `<input>`, inside the shared field. */
const keyControl = (el: SetupRestoreScreen): HTMLInputElement =>
  q(el, "[data-test=recovery-key]")!.shadowRoot!.querySelector("input")!;

function typeKey(el: SetupRestoreScreen, value: string): void {
  const key = keyControl(el);
  key.value = value;
  key.dispatchEvent(new Event("input"));
}

async function fill(
  el: SetupRestoreScreen,
  decisions: { artifact?: boolean; recoveryKey?: boolean; acknowledge?: boolean },
): Promise<void> {
  if (decisions.artifact) {
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [BACKUP] });
    file.dispatchEvent(new Event("change"));
  }
  if (decisions.recoveryKey) typeKey(el, "recovery-key");
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
      "p.error[id$='-error'], wt-input, wt-combobox",
    ),
  ]
    .map((node) => (node instanceof HTMLParagraphElement ? node.textContent! : node.error!).trim())
    .filter((message) => message !== "");
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

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

  it("emits the artifact, recovery key, environment and acknowledgement", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const artifact = new File(["encrypted"], "waitron.backup");
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [artifact] });
    file.dispatchEvent(new Event("change"));
    typeKey(el, "recovery-key");
    const ack = q<HTMLInputElement>(el, "[data-test=acknowledge]")!;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await el.updateComplete;

    const outcome = new Promise<RestoreRequestDetail>((resolve) =>
      host.addEventListener("restore-requested", (event: Event) => {
        resolve((event as CustomEvent<{ request: RestoreRequestDetail }>).detail.request);
      }),
    );
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      artifact,
      recoveryKey: "recovery-key",
      environment: "production",
      oldBoxGone: false,
    });
  });

  it("asks for the recovery key in the shared field, hidden until the owner reveals it", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    const key = q<HTMLElement & { label: string; required: boolean; type: string }>(
      el,
      'wt-input[name="recovery-key"]',
    );
    expect(key).not.toBeNull();
    expect({ label: key!.label, required: key!.required, type: key!.type }).toEqual({
      label: "Recovery key",
      required: true,
      type: "password",
    });
    expect(key!.shadowRoot!.querySelector("input")!.autocomplete).toBe("off");
    expect(key!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label")).toBe(
      "Help with recovery key",
    );
    const reveal = key!.querySelector<HTMLElement>("wt-button[slot=end]")!;
    expect(reveal.getAttribute("aria-label")).toBe("Show recovery key");
    expect(reveal.querySelector("svg")).not.toBeNull();
    reveal.click();
    await el.updateComplete;
    expect(key!.type).toBe("text");
    expect(reveal.getAttribute("aria-label")).toBe("Hide recovery key");
    reveal.click();
    await el.updateComplete;
    expect(key!.type).toBe("password");
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
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    await chooseOption(environment!, "preproduction");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .environment,
    ).toBe("preproduction");
  });

  it("restores a preparation backup when the operator picks that environment", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      {
        artifact: BACKUP,
        recoveryKey: "recovery-key",
        environment: "preproduction",
        oldBoxGone: false,
      },
    ]);
  });

  it.each([
    ["the backup file", { recoveryKey: true, acknowledge: true }, "Choose a backup file."],
    ["the recovery key", { artifact: true, acknowledge: true }, "Enter the recovery key."],
    [
      "the confirmation",
      { artifact: true, recoveryKey: true },
      "Confirm that no other running server has newer data.",
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
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual(["Confirm that the old server is switched off for good."]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirm that the old server is switched off for good.",
    );
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
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
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ request: RestoreRequestDetail }>).detail.request
        .oldBoxGone,
    ).toBe(false);
  });

  // The old-server question is answered by sending the same backup again; the shell hands the last
  // request back so the file does not have to be chosen and the key typed a second time.
  it("comes back from a refusal with the backup, the key and the answers kept", async () => {
    const request: RestoreRequestDetail = {
      artifact: BACKUP,
      recoveryKey: "recovery-key",
      environment: "preproduction",
      oldBoxGone: false,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveUnknown: true,
    });
    expect(q<HTMLInputElement>(el, "[data-test=artifact]")!.files?.[0]).toBe(BACKUP);
    expect(q<HTMLInputElement>(el, "[data-test=recovery-key]")!.value).toBe("recovery-key");
    expect(q<HTMLSelectElement>(el, "[data-test=environment]")!.value).toBe("preproduction");
    expect(q<HTMLInputElement>(el, "[data-test=acknowledge]")!.checked).toBe(true);
    const box = q<HTMLInputElement>(el, "[data-test=old-box-gone]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, oldBoxGone: true },
    ]);
  });

  // The old-server check was made on the backup that was sent; another file is another copy.
  it("drops the old-server answer when a different backup file is chosen", async () => {
    const request: RestoreRequestDetail = {
      artifact: BACKUP,
      recoveryKey: "recovery-key",
      environment: "production",
      oldBoxGone: true,
    };
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
      request,
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(true);
    const other = new File(["other"], "other.backup");
    const file = q<HTMLInputElement>(el, "[data-test=artifact]")!;
    Object.defineProperty(file, "files", { value: [other] });
    file.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    const listener = vi.fn();
    host.addEventListener("restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail.request)).toEqual([
      { ...request, artifact: other, oldBoxGone: false },
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
      await fill(el, { artifact: true, recoveryKey: true });
      expect(fieldMessages(el)).toEqual(["Confirm that no other running server has newer data."]);
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
      await fill(el, { recoveryKey: true });
      expect(fieldMessages(el)).toEqual([]);
      typeKey(el, "");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual(["Enter the recovery key."]);
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
  });

  describe("a refusal about one field", () => {
    const REQUEST: RestoreRequestDetail = {
      artifact: BACKUP,
      recoveryKey: "recovery-key",
      environment: "production",
      oldBoxGone: false,
    };
    const REFUSAL = {
      artifact: "Check the backup file.",
      recoveryKey: "Check the recovery key.",
      environment: "Check the backup environment.",
    } as const;

    it("shows it under that field and focuses it, leaving Restore working", async () => {
      const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
        request: REQUEST,
        errorMessage: REFUSAL.recoveryKey,
        invalidField: "recoveryKey",
      });
      await new Promise((resolve) => setTimeout(resolve));
      const key = q<HTMLInputElement>(el, "[data-test=recovery-key]")!;
      expect(fieldMessages(el)).toEqual([REFUSAL.recoveryKey]);
      expect(keyControl(el).getAttribute("aria-invalid")).toBe("true");
      expect(el.shadowRoot!.activeElement).toBe(key);
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!.disabled).toBe(
        false,
      );

      typeKey(el, "another-key");
      await el.updateComplete;
      await (key as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(keyControl(el).getAttribute("aria-invalid")).toBe("false");
      expect(await bottomOf(el)).toBe("");
    });

    it.each([
      ["artifact", (el: SetupRestoreScreen) => q(el, "[data-test=artifact]")!],
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
    expect(el.shadowRoot!.textContent).toContain("Archivo de copia de seguridad");
    expect(q(el, "[data-test=restore]")!.textContent).toBe("Restaurar la copia");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([
      "Elige un archivo de copia de seguridad.",
      "Introduce la clave de recuperación.",
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
    await fill(el, { artifact: true, recoveryKey: true, acknowledge: true });
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirma que el servidor anterior está apagado para siempre.",
    );
  });

  it("switches language live, keeping the recovery key already typed", async () => {
    const { el } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {});
    await fill(el, { recoveryKey: true });
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde una copia de seguridad");
    expect(q<HTMLInputElement>(el, "[data-test=recovery-key]")!.value).toBe("recovery-key");
  });
});
