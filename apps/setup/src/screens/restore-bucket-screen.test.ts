import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { BucketRestoreRequestDetail } from "../events.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";

afterEach(cleanupWidgets);
const q = <T extends HTMLElement>(el: SetupRestoreBucketScreen, selector: string): T | null =>
  el.shadowRoot!.querySelector<T>(selector);

function paste(el: SetupRestoreBucketScreen, text: string): void {
  const area = q<HTMLTextAreaElement>(el, "[data-test=kit]")!;
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
async function summaryItems(el: SetupRestoreBucketScreen): Promise<string[]> {
  const summary = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, "[data-test=error]");
  if (summary === null) return [];
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((li) => li.textContent!.trim());
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
    expect(q(el, "wt-form-error-summary")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[required]")).toHaveLength(3); // kit, environment, confirmation
    expect(await summaryItems(el)).toEqual([
      "Upload or paste the recovery kit.",
      "Confirm that no other running server has newer data.",
    ]);
    expect(q(el, "#kit-error")!.textContent).toBe("Upload or paste the recovery kit.");
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

  it("sends the environment the owner picks", async () => {
    const { el, host } = await mountWidget<SetupRestoreBucketScreen>(
      "setup-restore-bucket-screen",
      {},
    );
    paste(el, "k");
    tick(el, "[data-test=acknowledge]");
    const environment = q<HTMLSelectElement>(el, "[data-test=environment]")!;
    environment.value = "preproduction";
    environment.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const outcome = requested(host);
    q(el, "[data-test=restore]")!.click();
    await expect(outcome).resolves.toMatchObject({ environment: "preproduction" });
  });

  // Reconciliation N26: the restored copy's names, and nothing is sent until the owner confirms them.
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
    expect(await summaryItems(el)).toEqual(["Confirm that this is your business."]);
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
    expect(await summaryItems(el)).toEqual([
      "Confirm that the old server is switched off for good.",
    ]);
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

  it("shows the server's refusal", async () => {
    const { el } = await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", {
      errorMessage: "The bucket in this kit holds no copy of this restaurant.",
    });
    expect(q(el, "[data-test=server-error]")!.textContent).toBe(
      "The bucket in this kit holds no copy of this restaurant.",
    );
  });
});
