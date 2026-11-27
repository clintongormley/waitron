import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { SetupApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { encodeMasterKeyCode } from "@waitron/shared";
import {
  cleanupWidgets,
  enterBucket,
  REVIEWED_BUCKET,
  mountWidget,
  mountWithLeave,
  REVIEWED_CREDENTIALS,
  REVIEWED_PREVIEW,
  reviewBackup,
} from "../widgets/test-helpers.js";
import type { BucketRestoreRequestDetail, KeptBucketRestoreRequest } from "../events.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";
import { recoveryPackPdf } from "../../test/recovery-pack-pdf.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreBucketScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);
function fillBucket(el: SetupRestoreBucketScreen, name = REVIEWED_BUCKET.bucket.bucket): void {
  enterBucket(el, { ...REVIEWED_BUCKET.bucket, bucket: name });
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
/** Presses Review backup, enters its recovery details and confirms the business it names. */
async function reviewed(el: SetupRestoreBucketScreen): Promise<void> {
  await reviewBackup(el);
  tick(el, "[data-test=venue-confirmed]");
  await el.updateComplete;
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
      "p.error[id$='-error'], wt-input, wt-combobox",
    ),
  ]
    .map((node) => (node instanceof HTMLParagraphElement ? node.textContent! : node.error!).trim())
    .filter((message) => message !== "");
}
/** The shared field's own control, which carries its invalid state. */
function controlOf(el: SetupRestoreBucketScreen, field: "bucket" | "environment"): HTMLElement {
  return q(el, `[data-test=${field}]`)!.shadowRoot!.querySelector<HTMLElement>(
    { bucket: "input", environment: ".trigger" }[field],
  )!;
}
const FIX_FIELDS = "Correct the highlighted fields to continue.";

async function expectSharedFieldsUnmarked(el: SetupRestoreBucketScreen): Promise<void> {
  for (const field of ["bucket", "environment"] as const) {
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

const VENUE = { legalName: "Waitron SL", taxId: "89890001K", venueName: "Local" };

describe("SetupRestoreBucketScreen", () => {
  it("marks the bucket and the confirmation required and sends nothing when blank", async () => {
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
    expect(el.shadowRoot!.querySelectorAll("[required]")).toHaveLength(7);
    expect(fieldMessages(el)).toEqual([
      ...Array<string>(4).fill("Check the bucket details."),
      "Confirm that no other running box has newer data.",
    ]);
    expect((q(el, "[data-test=bucket]") as unknown as { error: string }).error).toBe(
      "Check the bucket details.",
    );
    expect(q(el, "#acknowledge-error")!.textContent).toBe(
      "Confirm that no other running box has newer data.",
    );
  });

  it("sends nothing and asks for Review backup first", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(
      "Press Review backup and enter the recovery details it asks for before you restore.",
    );
  });

  it("drops the Review backup line, and gives Restore back, when the bucket it was for is discarded", async () => {
    const { el, discard } = await mountWithLeave<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    const restore = q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!;
    expect(await bottomOf(el)).toBe(
      "Press Review backup and enter the recovery details it asks for before you restore.",
    );
    expect(restore.disabled).toBe(true);
    await discard();
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(""));
    expect(restore.disabled).toBe(false);
  });

  it("sends the bucket details, the environment and no old-box confirmation", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const outcome = requested(host);
    await reviewed(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      ...REVIEWED_BUCKET,
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: "89890001K",
      ...REVIEWED_CREDENTIALS,
    });
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
        { value: "preproduction", label: "Preparation" },
      ],
    });
    expect(
      environment!.querySelector("wt-help-tooltip[slot=help]")!.getAttribute("aria-label"),
    ).toBe("Help with environment");
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await chooseOption(environment!, "preproduction");
    await el.updateComplete;
    const outcome = requested(host);
    await reviewed(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ environment: "preproduction" });
  });

  it("sends the environment the owner picks", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await chooseOption(q(el, "[data-test=environment]")!, "preproduction");
    await el.updateComplete;
    const outcome = requested(host);
    await reviewed(el);
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
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    await reviewBackup(el);
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

  it("opens the bucket with the master key from a pack without a bucket code", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    fillBucket(el);
    const key = el.shadowRoot!.querySelector("wt-master-key-input")!;
    await key.updateComplete;
    const picker = key.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
    const selected = new DataTransfer();
    selected.items.add(await recoveryPackPdf(null));
    picker.files = selected.files;
    picker.dispatchEvent(new Event("change"));
    const packKey = encodeMasterKeyCode(new Uint8Array(16).fill(1));
    const input = key.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    await vi.waitFor(() =>
      expect(input.value.replaceAll(" ", "")).toBe(packKey.replaceAll(" ", "")),
    );
    tick(el, "[data-test=acknowledge]");
    const outcome = requested(host);
    await reviewed(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({
      masterKey: packKey,
      nodeRecoverySecret: packKey,
    });
  });

  it("when the old box looks alive, says when it last wrote and requires confirming it is gone", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      { liveSince: "2026-09-23T11:58:00.000Z" },
    );
    expect(q(el, "[data-test=live-warning]")!.textContent).toContain("2026-09-23T11:58:00.000Z");
    fillBucket(el);
    tick(el, "[data-test=acknowledge]");
    await el.updateComplete;
    const listener = vi.fn();
    host.addEventListener("bucket-restore-requested", listener);
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(fieldMessages(el)).toEqual(["Confirm that the old box is switched off for good."]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=old-box-gone]")!.getAttribute("aria-invalid")).toBe("true");
    expect(q(el, "#old-box-gone-error")!.textContent).toBe(
      "Confirm that the old box is switched off for good.",
    );
    tick(el, "[data-test=old-box-gone]");
    await el.updateComplete;
    const outcome = requested(host);
    await reviewed(el);
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

  it("comes back from a refusal with the owner's entries kept", async () => {
    const request: KeptBucketRestoreRequest = {
      ...REVIEWED_BUCKET,
      environment: "preproduction",
      oldBoxGone: true,
      venueConfirmed: null,
    };
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      { request, liveSince: "2026-09-23T11:58:00.000Z", venue: VENUE },
    );
    expect(q<HTMLInputElement>(el, "[data-test=bucket]")!.value).toBe(request.bucket.bucket);
    expect(q<HTMLSelectElement>(el, "[data-test=environment]")!.value).toBe("preproduction");
    expect(q<HTMLInputElement>(el, "[data-test=acknowledge]")!.checked).toBe(true);
    expect(q<HTMLInputElement>(el, "[data-test=old-box-gone]")!.checked).toBe(true);
    expect(q<HTMLInputElement>(el, "[data-test=venue-confirmed]")!.checked).toBe(false);
    tick(el, "[data-test=venue-confirmed]");
    await el.updateComplete;
    const outcome = requested(host);
    await reviewed(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      ...request,
      ...REVIEWED_CREDENTIALS,
      venueConfirmed: "89890001K",
    });
  });

  it("drops the old-server and venue answers when the bucket changes", async () => {
    const request: KeptBucketRestoreRequest = {
      ...REVIEWED_BUCKET,
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
    fillBucket(el, "other-bucket");
    await vi.waitFor(() =>
      expect(q<HTMLInputElement>(el, "[data-test=bucket]")!.value).toBe("other-bucket"),
    );
    await el.updateComplete;
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    expect(q(el, "[data-test=venue]")).toBeNull();
    const outcome = requested(host);
    await reviewed(el);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toEqual({
      ...REVIEWED_BUCKET,
      bucket: { ...REVIEWED_BUCKET.bucket, bucket: "other-bucket" },
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: "89890001K",
      ...REVIEWED_CREDENTIALS,
    });
  });

  it("asks again when the bucket is changed and then changed back", async () => {
    const request: KeptBucketRestoreRequest = {
      ...REVIEWED_BUCKET,
      environment: "production",
      oldBoxGone: true,
      venueConfirmed: "89890001K",
    };
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      request,
      liveUnknown: true,
      venue: VENUE,
    });
    fillBucket(el, "second");
    await el.updateComplete;
    fillBucket(el, request.bucket.bucket);
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
      errorMessage: "No copy was found here.",
    });
    expect(await bottomOf(el)).toBe("No copy was found here.");
    expect(q(el, "[data-test=server-error]")).toBeNull();
    expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  describe("a refusal about one field", () => {
    const REQUEST: KeptBucketRestoreRequest = {
      ...REVIEWED_BUCKET,
      environment: "production",
      oldBoxGone: false,
      venueConfirmed: null,
    };
    const REFUSAL = "Check the bucket details.";

    it("shows it under that field and focuses it, leaving Restore working", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        request: REQUEST,
        errorMessage: REFUSAL,
        invalidField: "bucket",
      });
      await vi.waitFor(() =>
        expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=bucket]")),
      );
      expect(fieldMessages(el)).toEqual([REFUSAL]);
      expect(controlOf(el, "bucket").getAttribute("aria-invalid")).toBe("true");
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=restore]")!.disabled).toBe(
        false,
      );

      fillBucket(el, "def");
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

    it("keeps a field's refusal away once the owner edits the field, through a new message about it", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        request: REQUEST,
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
      const refusal = "No copy was found here.";
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
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

    it("drops it on the next press and sends the request again", async () => {
      const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
        "setup-restore-bucket-screen",
        { request: REQUEST, errorMessage: REFUSAL, invalidField: "bucket" },
      );
      const sent = requested(host);
      await reviewed(el);
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect((await sent).bucket.bucket).toBe(REQUEST.bucket.bucket);
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
    });

    const TICK_BOXES = [
      [
        "oldBoxGone",
        { liveSince: "2026-09-23T11:58:00.000Z" },
        "old-box-gone",
        "Check your answer about the old box.",
      ],
      [
        "venueConfirmed",
        { venue: VENUE },
        "venue-confirmed",
        "Check the confirmation that this is your business.",
      ],
    ] as const;

    it.each(TICK_BOXES)(
      "keeps the %s tick box's dismissed refusal away from Restore once another bucket hides the box",
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
        fillBucket(el, "def");
        await el.updateComplete;
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(await bottomOf(el)).toBe("");
        expect(q(el, "[aria-invalid=true]")).toBeNull();
        await expectSharedFieldsUnmarked(el);
      },
    );

    it.each(TICK_BOXES)(
      "drops the %s tick box's refusal when another bucket hides the box",
      async (field, question, box, message) => {
        const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          request: REQUEST,
          errorMessage: message,
          invalidField: field,
          ...question,
        });
        expect(q(el, `[data-test=${box}]`)!.getAttribute("aria-invalid")).toBe("true");
        expect(fieldMessages(el)).toEqual([message]);
        fillBucket(el, "def");
        await el.updateComplete;
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(fieldMessages(el)).toEqual([]);
        expect(await bottomOf(el)).toBe("");
        expect(q(el, "[aria-invalid=true]")).toBeNull();
        await expectSharedFieldsUnmarked(el);
      },
    );

    it.each(TICK_BOXES)(
      "shows the %s refusal above Restore while its tick box is not on screen, and drops it when another bucket is entered",
      async (field, _question, box, message) => {
        const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
          request: REQUEST,
          errorMessage: message,
          invalidField: field,
        });
        expect(q(el, `[data-test=${box}]`)).toBeNull();
        expect(await bottomOf(el)).toBe(message);
        fillBucket(el, "def");
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
      await vi.waitFor(() =>
        expect(el.shadowRoot!.activeElement).toBe(q(el, "[data-test=bucket]")),
      );
    });

    it("clears each message as it is answered, marks one undone again, and gives Restore back at the end", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      fillBucket(el);
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual(["Confirm that no other running box has newer data."]);
      fillBucket(el, " ");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([
        "Check the bucket details.",
        "Confirm that no other running box has newer data.",
      ]);
      fillBucket(el);
      tick(el, "[data-test=acknowledge]");
      await el.updateComplete;
      expect(fieldMessages(el)).toEqual([]);
      expect(await bottomOf(el)).toBe("");
      expect(q(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
    });

    it("drops the server's refusal on the next press", async () => {
      const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
        errorMessage: "No copy was found here.",
      });
      q(el, "[data-test=restore]")!.click();
      await el.updateComplete;
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
    });
  });
});

describe("SetupRestoreBucketScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("explains the bucket with a Spanish hint", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    expect(q(el, "[data-test=endpoint]")!.getAttribute("hint")).toBe(
      "Para proveedores distintos de Amazon S3",
    );
  });

  it("asks for the bucket and the confirmations in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      venue: VENUE,
    });
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde mi bucket");
    expect(q(el, "[data-test=secretAccessKey]")!.getAttribute("type")).toBe("password");
    expect(q(el, "[data-test=venue]")!.textContent).toContain("(NIF 89890001K), local Local.");
    q(el, "[data-test=restore]")!.click();
    await el.updateComplete;
    expect(fieldMessages(el)).toEqual([
      ...Array<string>(4).fill("Revisa los datos del bucket."),
      "Confirma que ningún otro servidor en funcionamiento tiene datos más recientes.",
      "Confirma que este es tu negocio.",
    ]);
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  });

  it("switches language live, keeping the bucket already entered", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {});
    fillBucket(el);
    await el.updateComplete;
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent).toBe("Restaurar desde mi bucket");
    expect(q<HTMLInputElement>(el, "[data-test=bucket]")!.value).toBe(
      REVIEWED_BUCKET.bucket.bucket,
    );
  });
});

describe("SetupRestoreBucketScreen environment from Review backup", () => {
  /** A bucket preview that refuses any environment but the copy's own, as `restore-gate.ts` does. */
  function previewsAs(copyEnvironment: "production" | "preproduction", refusal?: object) {
    const sent: string[] = [];
    const api = new SetupApi("", async (_input, init) => {
      const { environment } = JSON.parse(String(init!.body)) as { environment: string };
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
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      api,
    });
    fillBucket(el);
    await el.updateComplete;
    const copy = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "setup-recovery-copy")!;
    await copy.updateComplete;
    return { el, copy };
  }

  const environmentField = (el: SetupRestoreBucketScreen) =>
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
    expect(el.shadowRoot!.textContent).not.toContain("Check the backup environment.");
    expect(copy.shadowRoot!.textContent).not.toContain("Check the backup environment.");
  });

  it("leaves the environment alone when Review is refused for another reason", async () => {
    const { api, sent } = previewsAs("preproduction", {
      code: "setup.request_invalid",
      params: { field: "bucket" },
    });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(q<HTMLElement & { error: string }>(el, "[data-test=bucket]")!.error).toBe(
        "Check the bucket details.",
      ),
    );
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
      const { environment } = JSON.parse(String(init!.body)) as { environment: string };
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

  const followedNote = (el: SetupRestoreBucketScreen) =>
    q(el, "[data-test=environment-followed]")?.textContent?.trim();

  async function reviewAndWait(el: SetupRestoreBucketScreen, copy: HTMLElement) {
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() => expect(copy.shadowRoot!.textContent).toContain("Amber Hill"));
    await el.updateComplete;
  }

  it("says the environment now matches the copy once it has switched it", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    expect(followedNote(el)).toBe(
      "This copy is from “Preparation”, so Environment now matches it.",
    );
    expect(q(el, "[data-test=environment-followed]")!.getAttribute("role")).toBe("status");
    expect(q<HTMLElement>(el, "[data-test=restore]")!.hasAttribute("disabled")).toBe(false);
  });

  it("keeps the note when the person confirms the business the copy names", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    tick(el, "[data-test=venue-confirmed]");
    await el.updateComplete;
    expect(followedNote(el)).toBe(
      "This copy is from “Preparation”, so Environment now matches it.",
    );
  });

  it("says nothing about the environment when the copy already matches it", async () => {
    const { api, sent } = previewsAs("production");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    expect(sent).toEqual(["production"]);
    expect(followedNote(el)).toBeUndefined();
  });

  it("says nothing about the environment when Review is refused for another reason", async () => {
    const { api } = previewsAs("preproduction", {
      code: "setup.request_invalid",
      params: { field: "bucket" },
    });
    const { el, copy } = await mountWith(api);
    copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(q<HTMLElement & { error: string }>(el, "[data-test=bucket]")!.error).toBe(
        "Check the bucket details.",
      ),
    );
    expect(followedNote(el)).toBeUndefined();
  });

  it("shows no note beside a second environment refusal", async () => {
    const api = new SetupApi("", async (_input, init) => {
      const { environment } = JSON.parse(String(init!.body)) as { environment: string };
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

  it("drops the note when the person changes the environment", async () => {
    const { api } = previewsAs("preproduction");
    const { el, copy } = await mountWith(api);
    await reviewAndWait(el, copy);
    await chooseOption(environmentField(el), "production");
    await el.updateComplete;
    expect(followedNote(el)).toBeUndefined();
  });

  it("drops the note and switches again after the person changes the bucket", async () => {
    const sent: string[] = [];
    let copyEnvironment = "preproduction";
    const api = new SetupApi("", async (_input, init) => {
      const { environment } = JSON.parse(String(init!.body)) as { environment: string };
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
    fillBucket(el, "another-bucket");
    await el.updateComplete;
    await copy.updateComplete;
    expect(followedNote(el)).toBeUndefined();
    await reviewAndWait(el, copy);
    expect(sent).toEqual(["production", "preproduction", "preproduction", "production"]);
    expect(environmentField(el).value).toBe("production");
    expect(environmentField(el).error).toBe("");
    expect(followedNote(el)).toBe("This copy is from “Live”, so Environment now matches it.");
  });
});
