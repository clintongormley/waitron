import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { BucketRestoreRequestDetail } from "../events.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreBucketScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

function paste(el: SetupRestoreBucketScreen, text: string): void {
  const area = q(el, "[data-test=kit]")!.shadowRoot!.querySelector("textarea")!;
  area.value = text;
  area.dispatchEvent(new Event("input"));
}
function tick(el: SetupRestoreBucketScreen, selector: string): void {
  const box = q<HTMLInputElement>(el, selector)!;
  box.checked = true;
  box.dispatchEvent(new Event("change"));
}
function requested(host: HTMLElement): Promise<BucketRestoreRequestDetail> {
  return new Promise((resolve) =>
    host.addEventListener("bucket-restore-requested", (event: Event) =>
      resolve((event as CustomEvent<{ request: BucketRestoreRequestDetail }>).detail.request),
    ),
  );
}
/** The one message `wt-form-actions` shows above Restore; "" when there is none. */
async function bottomOf(el: SetupRestoreBucketScreen): Promise<string> {
  const actions = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}
/** The messages shown under the fields, in page order: the screen's own paragraphs, and each
 * shared field's `error`. */
function fieldMessages(el: SetupRestoreBucketScreen): string[] {
  return [
    ...el.shadowRoot!.querySelectorAll<HTMLElement & { error?: string }>(
      "p.error[id$='-error'], wt-textarea, wt-combobox",
    ),
  ]
    .map((node) => (node instanceof HTMLParagraphElement ? node.textContent! : node.error!).trim())
    .filter((message) => message !== "");
}
/** The shared field's own control, which carries its invalid state. */
function controlOf(el: SetupRestoreBucketScreen, field: "kit" | "environment"): HTMLElement {
  return q(el, `[data-test=${field}]`)!.shadowRoot!.querySelector<HTMLElement>(
    field === "kit" ? "textarea" : ".trigger",
  )!;
}
const FIX_FIELDS = "Correct the highlighted fields to continue.";

/** The kit and environment are shared fields, whose invalid marking is inside their own shadow roots,
 * where a `[aria-invalid=true]` query of the screen cannot see it. */
async function expectSharedFieldsUnmarked(el: SetupRestoreBucketScreen): Promise<void> {
  for (const field of ["kit", "environment"] as const) {
    const box = q<
      HTMLElement & { error: string; invalid: boolean; updateComplete: Promise<unknown> }
    >(el, `[data-test=${field}]`)!;
    await box.updateComplete;
    expect({ field, error: box.error, invalid: box.invalid }).toEqual({
      field,
      error: "",
      invalid: false,
    });
    expect(controlOf(el, field).getAttribute("aria-invalid")).toBe("false");
  }
}

const VENUE = { legalName: "Waitron SL", taxId: "89890001K", locationName: "Local" };

describe("SetupRestoreBucketScreen", () => {
  it("marks the kit and the confirmation required and sends nothing when blank", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(el.shadowRoot!.querySelectorAll("[required]")).toHaveLength(3); // kit, environment, confirmation
    expect(fieldMessages(el)).toEqual([
      "Upload or paste the recovery kit.",
      "Confirm that no other running server has newer data.",
    ]);
    expect((q(el, "[data-test=kit]") as unknown as { error: string }).error).toBe(
      "Upload or paste the recovery kit.",
    );
    expect(q(el, "#acknowledge-error")!.textContent).toBe(
      "Confirm that no other running server has newer data.",
    );
  });

  it("says the kit is as sensitive as the recovery key", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    expect(q(el, "[data-test=kit-sensitive]")!.textContent).toContain(
      "as sensitive as the recovery key",
    );
    // Browsers may send spell-checked text to an outside service.
    expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.spellcheck).toBe(false);
  });

  it("sends the pasted kit, the environment and no old-box confirmation", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    paste(el, "WAITRON-RECOVERY-KIT-1:abc");
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      kit: "WAITRON-RECOVERY-KIT-1:abc",
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: null,
    });
  });

  it("takes the kit in the shared multi-line field, in the monospace font and never spell-checked", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    host.style.setProperty("--wt-font-family-mono", "fantasy");
    host.style.setProperty("--wt-font-size-sm", "11px");
    const kit = q<HTMLElement & { label: string; required: boolean; rows: number }>(
      el,
      'wt-textarea[name="recovery-kit"]',
    );
    expect(kit).not.toBeNull();
    expect({ label: kit!.label, required: kit!.required, rows: kit!.rows }).toEqual({
      label: "Recovery kit",
      required: true,
      rows: 6,
    });
    const control = kit!.shadowRoot!.querySelector("textarea")!;
    expect({
      spellcheck: control.spellcheck,
      autocapitalize: control.getAttribute("autocapitalize"),
      font: getComputedStyle(control).fontFamily,
      size: getComputedStyle(control).fontSize,
    }).toEqual({ spellcheck: false, autocapitalize: "off", font: "fantasy", size: "11px" });
    expect(kit!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label")).toBe(
      "Help with the recovery kit",
    );
  });

  it("picks the environment from the shared dropdown, with its help beside the box", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
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
      label: "Environment",
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
    ).toBe("Help with environment");
    paste(el, "k");
    tick(el, "[data-test=acknowledge]");
    await chooseOption(environment!, "preproduction");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ environment: "preproduction" });
  });

  it("sends the environment the owner picks", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    paste(el, "k");
    tick(el, "[data-test=acknowledge]");
    await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ environment: "preproduction" });
  });

  // #646: the restored copy's names, and nothing is sent until the owner confirms them.
  it("shows whose copy the bucket holds and sends its tax id only once the owner confirms it", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      { venue: VENUE },
    );
    const shown = q(el, "[data-test=venue]")!.textContent!;
    for (const part of ["Waitron SL", "89890001K", "Local"]) expect(shown).toContain(part);
    paste(el, "k");
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual(["Confirm that this is your business."]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "#venue-confirmed-error")!.textContent).toBe(
      "Confirm that this is your business.",
    );
    tick(el, "[data-test=venue-confirmed]");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ venueConfirmed: "89890001K" });
  });

  it("asks the old-box question when whether it is still writing could not be checked", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      liveUnknown: true,
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("could not be checked");
    expect(q(el, "[data-test=old-box-gone]")).not.toBeNull();
  });

  it("reads an uploaded kit file into the kit field", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    const file = q<HTMLInputElement>(el, "[data-test=kit-file]")!;
    Object.defineProperty(file, "files", {
      value: [new File(["WAITRON-RECOVERY-KIT-1:fromfile\n"], "kit.txt")],
    });
    file.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.value).toBe(
        "WAITRON-RECOVERY-KIT-1:fromfile\n",
      ),
    );
  });

  it("when the old box looks alive, says when it last wrote and requires confirming it is gone", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      { liveSince: "2026-09-23T11:58:00.000Z" },
    );
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("2026-09-23T11:58:00.000Z");
    paste(el, "k");
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual(["Confirm that the old server is switched off for good."]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=old-box-gone]")!.getAttribute("aria-invalid")).toBe("true");
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirm that the old server is switched off for good.",
    );
    tick(el, "[data-test=old-box-gone]");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ oldBoxGone: true });
  });

  it("shows a time it cannot read as the server gave it", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      liveSince: "not a time",
    });
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("at not a time.");
    expect(q(el, "[data-test=live-warning] time")).toBeNull();
  });

  it("shows a readable time with the exact one beside it", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      liveSince: "2026-09-23T11:58:00.000Z",
    });
    const time = q(el, "[data-test=live-warning] time")!;
    expect(time.getAttribute("datetime")).toBe("2026-09-23T11:58:00.000Z");
    expect(time.textContent).toContain("2026");
  });

  it("keeps the kit already entered when the file choice is cancelled", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    paste(el, "WAITRON-RECOVERY-KIT-1:pasted");
    const file = q<HTMLInputElement>(el, "[data-test=kit-file]")!;
    Object.defineProperty(file, "files", { value: [] });
    file.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.value).toBe(
      "WAITRON-RECOVERY-KIT-1:pasted",
    );
  });

  // A refusal the owner answers (the old-server question, whose copy it is) is sent again with the
  // same kit; the shell hands the last request back so nothing has to be pasted twice.
  it("comes back from a refusal with the owner's entries kept", async () => {
    const request: BucketRestoreRequestDetail = {
      kit: "WAITRON-RECOVERY-KIT-1:abc",
      environment: "preproduction",
      oldBoxGone: true,
      venueConfirmed: null,
    };
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      { request, liveSince: "2026-09-23T11:58:00.000Z", venue: VENUE },
    );
    expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.value).toBe(request.kit);
    expect(q<HTMLSelectElement>(el, "[data-test=environment]")!.value).toBe("preproduction");
    expect(q<HTMLInputElement>(el, "[data-test=acknowledge]")!.checked).toBe(true);
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(true);
    expect(q<HTMLInputElement>(el, "[data-test=venue-confirmed]")!.checked).toBe(false);
    tick(el, "[data-test=venue-confirmed]");
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({ ...request, venueConfirmed: "89890001K" });
  });

  // The server checked the old server and named the copy for the kit it was sent. A different kit is
  // a different copy, so an answer given for the first must not travel with the second.
  it.each(["pasted", "read from a file"])(
    "drops the old-server and venue answers when a different kit is %s",
    async (how) => {
      const request: BucketRestoreRequestDetail = {
        kit: "WAITRON-RECOVERY-KIT-1:first",
        environment: "production",
        oldBoxGone: true,
        venueConfirmed: null,
      };
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { request, liveSince: "2026-09-23T11:58:00.000Z", venue: VENUE },
      );
      tick(el, "[data-test=venue-confirmed]");
      await el.updateComplete;
      if (how === "pasted") {
        paste(el, "WAITRON-RECOVERY-KIT-1:second");
      } else {
        const file = q<HTMLInputElement>(el, "[data-test=kit-file]")!;
        Object.defineProperty(file, "files", {
          value: [new File(["WAITRON-RECOVERY-KIT-1:second"], "kit.txt")],
        });
        file.dispatchEvent(new Event("change"));
      }
      await vi.waitFor(() =>
        expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.value).toBe(
          "WAITRON-RECOVERY-KIT-1:second",
        ),
      );
      await el.updateComplete;
      expect(q(el, "[data-test=live-warning]")).toBeNull();
      expect(q(el, "[data-test=venue]")).toBeNull();
      const outcome = requested(host);
      q(el, "[data-test=restore]")!.click();
      await expect(outcome).resolves.toEqual({
        kit: "WAITRON-RECOVERY-KIT-1:second",
        environment: "production",
        oldBoxGone: false,
        venueConfirmed: null,
      });
    },
  );

  it("asks again when the kit is changed and then changed back", async () => {
    const request: BucketRestoreRequestDetail = {
      kit: "WAITRON-RECOVERY-KIT-1:first",
      environment: "production",
      oldBoxGone: true,
      venueConfirmed: "89890001K",
    };
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      request,
      liveUnknown: true,
      venue: VENUE,
    });
    paste(el, "WAITRON-RECOVERY-KIT-1:second");
    await el.updateComplete;
    paste(el, request.kit);
    await el.updateComplete;
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(false);
    expect(q<HTMLInputElement>(el, "[data-test=venue-confirmed]")!.checked).toBe(false);
  });

  it("steps back to the role screen", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    q(el, "[data-test=back]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "role",
    ]);
  });

  it("shows the server's refusal above Restore and leaves Restore working", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      errorMessage: "The bucket in this kit holds no copy of this restaurant.",
    });
    expect(await bottomOf(el)).toBe("The bucket in this kit holds no copy of this restaurant.");
    expect(q(el, "[data-test=server-error]")).toBeNull();
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  describe("a refusal about one field", () => {
    const REQUEST: BucketRestoreRequestDetail = {
      kit: "WAITRON-RECOVERY-KIT-1:abc",
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: null,
    };
    const REFUSAL =
      "This is not a Waitron recovery kit. Upload the kit file, or paste the whole kit.";

    it("shows it under that field and focuses it, leaving Restore working", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        request: REQUEST,
        errorMessage: REFUSAL,
        invalidField: "kit",
      });
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=kit]")));
      expect(fieldMessages(el)).toEqual([REFUSAL]);
      expect(controlOf(el, "kit").getAttribute("aria-invalid")).toBe("true");
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!.disabled).toBe(
        false,
      );

      paste(el, "WAITRON-RECOVERY-KIT-1:def");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
    });

    it("marks the environment when it names the environment, and drops it when that changes", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        request: REQUEST,
        errorMessage:
          "The copy comes from the other environment. Choose the environment it came from.",
        invalidField: "environment",
      });
      const environment = q<HTMLElement & { updateComplete: Promise<unknown> }>(
        el,
        "[data-test=environment]",
      )!;
      expect(controlOf(el, "environment").getAttribute("aria-invalid")).toBe("true");
      expect(fieldMessages(el)).toEqual([
        "The copy comes from the other environment. Choose the environment it came from.",
      ]);
      await chooseOption(environment, "preproduction");
      await el.updateComplete;
      await environment.updateComplete;
      expect(controlOf(el, "environment").getAttribute("aria-invalid")).toBe("false");
      expect(fieldMessages(el)).toEqual([]);
    });

    it("outlines the environment dropdown it names in the danger colour", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        {
          request: REQUEST,
          errorMessage:
            "The copy comes from the other environment. Choose the environment it came from.",
          invalidField: "environment",
        },
      );
      host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");
      const box = q(el, "[data-test=environment]")!.shadowRoot!.querySelector("[part=field]")!;
      expect(getComputedStyle(box).boxShadow).toContain("rgb(4, 5, 6)");
    });

    it("drops it on the next press and sends the request again", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { request: REQUEST, errorMessage: REFUSAL, invalidField: "kit" },
      );
      const sent = requested(host);
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect((await sent).kit).toBe(REQUEST.kit);
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
    });

    const TICK_BOXES = [
      [
        "oldBoxGone",
        { liveSince: "2026-09-23T11:58:00.000Z" },
        "old-box-gone",
        "Check your answer about the old server.",
      ],
      [
        "venueConfirmed",
        { venue: VENUE },
        "venue-confirmed",
        "Check the confirmation that this is your business.",
      ],
    ] as const;

    it.each(TICK_BOXES)(
      "keeps the %s tick box's dismissed refusal away from Restore once another kit hides the box",
      async (field, question, box, message) => {
        const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          request: REQUEST,
          errorMessage: message,
          invalidField: field,
          ...question,
        });
        tick(el, `[data-test=${box}]`);
        await el.updateComplete;
        expect(fieldMessages(el)).toEqual([]);
        paste(el, "WAITRON-RECOVERY-KIT-1:def");
        await el.updateComplete;
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(await bottomOf(el)).toBe("");
        expect(q(el, "[aria-invalid=true]")).toBeNull();
        await expectSharedFieldsUnmarked(el);
      },
    );

    it.each(TICK_BOXES)(
      "drops the %s tick box's refusal when another kit hides the box",
      async (field, question, box, message) => {
        const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          request: REQUEST,
          errorMessage: message,
          invalidField: field,
          ...question,
        });
        expect(q(el, `[data-test=${box}]`)!.getAttribute("aria-invalid")).toBe("true");
        expect(fieldMessages(el)).toEqual([message]);
        paste(el, "WAITRON-RECOVERY-KIT-1:def");
        await el.updateComplete;
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(fieldMessages(el)).toEqual([]);
        expect(await bottomOf(el)).toBe("");
        expect(q(el, "[aria-invalid=true]")).toBeNull();
        await expectSharedFieldsUnmarked(el);
      },
    );

    it.each(TICK_BOXES)(
      "shows the %s refusal above Restore while its tick box is not on screen, and drops it when another kit is pasted",
      async (field, _question, box, message) => {
        const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          request: REQUEST,
          errorMessage: message,
          invalidField: field,
        });
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(await bottomOf(el)).toBe(message);
        paste(el, "WAITRON-RECOVERY-KIT-1:def");
        await el.updateComplete;
        expect(await bottomOf(el)).toBe("");
        expect(q(el, "[aria-invalid=true]")).toBeNull();
        await expectSharedFieldsUnmarked(el);
      },
    );
  });

  describe("messages above Restore (design-system.md, Forms)", () => {
    it("says nothing and leaves Restore working before the first press", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        venue: VENUE,
        liveUnknown: true,
      });
      expect(await bottomOf(el)).toBe("");
      expect(fieldMessages(el)).toEqual([]);
      expect(q(el, "wt-form-error-summary")).toBeNull();
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    });

    it("focuses the first marked field and holds Restore after a press with fields missing", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(true);
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=kit]")));
    });

    it("clears each message as it is answered, marks one undone again, and gives Restore back at the end", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      paste(el, "k");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual(["Confirm that no other running server has newer data."]);
      paste(el, " ");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([
        "Upload or paste the recovery kit.",
        "Confirm that no other running server has newer data.",
      ]);
      paste(el, "k");
      tick(el, "[data-test=acknowledge]");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    });

    it("drops the server's refusal on the next press", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        errorMessage: "The bucket in this kit holds no copy of this restaurant.",
      });
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
    });
  });
});

describe("SetupRestoreBucketScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("asks for the kit and the confirmations in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      venue: VENUE,
    });
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde mi bucket");
    expect(q(el, "[data-test=kit-sensitive]")!.textContent).toContain(
      "tan delicado como la clave de recuperación",
    );
    expect(q(el, "[data-test=venue]")!.textContent).toContain("(NIF 89890001K), local Local.");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([
      "Sube o pega el kit de recuperación.",
      "Confirma que ningún otro servidor en funcionamiento tiene datos más recientes.",
      "Confirma que este es tu negocio.",
    ]);
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  });

  it("switches language live, keeping the kit already pasted", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    paste(el, "WAITRON-RECOVERY-KIT-1:abc");
    await el.updateComplete;
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde mi bucket");
    expect(q<HTMLTextAreaElement>(el, "[data-test=kit]")!.value).toBe("WAITRON-RECOVERY-KIT-1:abc");
  });
});
