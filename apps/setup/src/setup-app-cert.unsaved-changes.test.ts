import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type DeepPartial, type Screen } from "./setup-app.js";
import type { ProvisionBody, SetupApi } from "./api/client.js";
import type { SetupCertScreen } from "./screens/cert-screen.js";
import type { WtInput } from "@waitron/ui/src/components/wt-input.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});

type State = { screen: Screen; draft: DeepPartial<ProvisionBody> };
const initialCert = { pfxBase64: "AQID", passphrase: "original-pass", certKind: "sello" as const };
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
const field = (cert: SetupCertScreen, key: string) =>
  cert.shadowRoot!.querySelector<WtInput>(`[data-test=${key}]`)!;
const fileInput = (cert: SetupCertScreen) =>
  cert.shadowRoot!.querySelector<HTMLInputElement>("[data-test=pfx]")!;

async function mount(certDraft = initialCert) {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "preproduction", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    provision: vi.fn(),
  } as unknown as SetupApi;
  const { el, host } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect((el as unknown as State).screen).toBe("mode"));
  Object.assign(el, { draft: { mode: "live", aeatCert: { ...certDraft } }, screen: "cert" });
  await el.updateComplete;
  const cert = el.shadowRoot!.querySelector<SetupCertScreen>("setup-cert-screen")!;
  await cert.updateComplete;
  return { el, cert, host };
}
async function edit(cert: SetupCertScreen, key: string, value: string) {
  field(cert, key).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await cert.updateComplete;
}
function select(cert: SetupCertScreen, file?: File) {
  const files = new DataTransfer();
  if (file) files.items.add(file);
  fileInput(cert).files = files.files;
  fileInput(cert).dispatchEvent(new Event("change"));
}
function back(cert: SetupCertScreen) {
  cert.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
async function choose(el: SetupApp, decision: "keep" | "discard") {
  warning(el).dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

class DeferredFileReader {
  static pending: DeferredFileReader[] = [];
  result: string | null = null;
  error = new Error("read refused");
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    DeferredFileReader.pending.push(this);
  }
  finish(base64: string) {
    this.result = `data:application/x-pkcs12;base64,${base64}`;
    this.onload?.();
  }
}
function deferReads() {
  DeferredFileReader.pending = [];
  vi.stubGlobal("FileReader", DeferredFileReader);
}

describe("setup certificate unsaved changes", () => {
  it("a pending first file remains unsaved after the form reconnects", async () => {
    deferReads();
    const { el, cert, host } = await mount({ ...initialCert, pfxBase64: "" });
    select(cert, new File(["first"], "first.pfx"));
    expect(unload()).toBe(true);
    el.remove();
    host.append(el);
    await el.updateComplete;
    await cert.updateComplete;
    expect(unload()).toBe(true);
    DeferredFileReader.pending[0].finish("BAUG");
    await cert.updateComplete;
    expect(cert.shadowRoot!.querySelector("[data-test=file-status]")).toBeNull();
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    expect(fileInput(cert).files!.length).toBe(0);
  });
  it("removing only the certificate child clears its unload protection", async () => {
    const { cert } = await mount();
    await edit(cert, "passphrase", "edited");
    expect(unload()).toBe(true);
    cert.remove();
    expect(unload()).toBe(false);
  });
  it("native warning Escape retains the certificate and returns focus to Back", async () => {
    const { el, cert } = await mount();
    const input = field(cert, "passphrase").shadowRoot!.querySelector<HTMLInputElement>("input")!;
    await userEvent.fill(page.elementLocator(input), "edited-pass");
    const backButton = cert.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!;
    await userEvent.click(page.elementLocator(backButton));
    await expect.poll(() => warning(el).open).toBe(true);
    const modal = warning(el).shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    const closed = new Promise((resolve) =>
      warning(el)
        .shadowRoot!.querySelector("wt-modal")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await expect.poll(() => warning(el).open).toBe(false);
    expect(input.value).toBe("edited-pass");
    expect((el as unknown as State).screen).toBe("cert");
    await expect.poll(() => cert.shadowRoot!.activeElement).toBe(backButton);
  });
  it("replacing a form cancels the old question and ignores its discard answer", async () => {
    const { el, cert } = await mount();
    await edit(cert, "passphrase", "edited");
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    Object.assign(el, { screen: "venue" });
    await el.updateComplete;
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("venue");
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
  });
  it("accepted file selection is restored in the native input when later input is discarded", async () => {
    deferReads();
    const { el, cert } = await mount();
    select(cert, new File([new Uint8Array([4, 5, 6])], "accepted.pfx"));
    DeferredFileReader.pending[0].finish("BAUG");
    await expect
      .poll(() => cert.shadowRoot!.querySelector("[data-test=file-status]")?.textContent)
      .toContain("accepted.pfx");
    cert.addEventListener(
      "setup-patch",
      () => {
        select(cert, new File([new Uint8Array([7, 8, 9])], "newer.pfx"));
      },
      { once: true },
    );
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("fiscal-test");
    expect(fileInput(cert).files![0].name).toBe("accepted.pfx");
    expect(await fileInput(cert).files![0].text()).toBe("\u0004\u0005\u0006");
    expect((el as unknown as State).draft.aeatCert).toEqual({ ...initialCert, pfxBase64: "BAUG" });
  });
  it("input delivered during Next stays protected against the submitted snapshot", async () => {
    const { el, cert } = await mount();
    await edit(cert, "passphrase", "submitted");
    cert.addEventListener(
      "setup-patch",
      () => {
        field(cert, "passphrase").dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "newer" },
            bubbles: true,
            composed: true,
          }),
        );
      },
      { once: true },
    );
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await expect.poll(() => warning(el).open).toBe(true);
    expect((el as unknown as State).draft.aeatCert?.passphrase).toBe("submitted");
    await choose(el, "keep");
    expect(field(cert, "passphrase").value).toBe("newer");
    expect((el as unknown as State).screen).toBe("cert");
  });
  it("a late first file read cannot replace the second certificate", async () => {
    deferReads();
    const { el, cert } = await mount();
    select(cert, new File(["first"], "first.pfx"));
    select(cert, new File(["second"], "second.pfx"));
    DeferredFileReader.pending[1].finish("BAUG");
    await cert.updateComplete;
    DeferredFileReader.pending[0].finish("BwgJ");
    await cert.updateComplete;
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await expect.poll(() => (el as unknown as State).screen).toBe("fiscal-test");
    expect((el as unknown as State).draft.aeatCert?.pfxBase64).toBe("BAUG");
  });
  it("a failed pending read cannot restore discarded file state", async () => {
    deferReads();
    const { el, cert } = await mount();
    select(cert, new File(["first"], "failed.pfx"));
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    DeferredFileReader.pending[0].onerror?.();
    await cert.updateComplete;
    expect(cert.shadowRoot!.querySelector("[data-test=file-status]")).not.toBeNull();
    expect(fileInput(cert).files!.length).toBe(0);
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
  });
  it.each([
    ["passphrase", " original-pass "],
    ["certKind", "representante"],
  ])("Back protects %s and Discard leaves the staged root unchanged", async (key, value) => {
    const { el, cert } = await mount();
    expect(unload()).toBe(false);
    await edit(cert, key, value);
    expect(unload()).toBe(true);
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(cert, key).value).toBe(value);
    expect((el as unknown as State).screen).toBe("cert");
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
    expect(field(cert, key).value).toBe(initialCert[key as "passphrase" | "certKind"]);
  });
  it("reverted passphrase and presentation-only reveal leave without asking", async () => {
    const { el, cert } = await mount();
    await edit(cert, "passphrase", "changed");
    expect(unload()).toBe(true);
    await edit(cert, "passphrase", "original-pass");
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-passphrase]")!.click();
    await cert.updateComplete;
    expect(unload()).toBe(false);
    back(cert);
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    expect(warning(el).open).toBe(false);
  });
  it("file bytes distinguish identically named certificates and restore the saved bytes", async () => {
    const { el, cert } = await mount();
    select(cert, new File([new Uint8Array([4, 5, 6])], "cert.pfx"));
    await expect
      .poll(() => cert.shadowRoot!.querySelector("[data-test=file-status]")?.textContent)
      .toContain("cert.pfx");
    expect(unload()).toBe(true);
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(fileInput(cert).files![0].name).toBe("cert.pfx");
    select(cert, new File([new Uint8Array([1, 2, 3])], "cert.pfx"));
    await expect.poll(() => unload()).toBe(false);
    back(cert);
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
  });
  it("an emptied file selection stays protected", async () => {
    const { el, cert } = await mount();
    select(cert);
    await cert.updateComplete;
    expect(unload()).toBe(true);
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    expect(cert.shadowRoot!.querySelector("[data-test=file-status]")).not.toBeNull();
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
  });
  it("Next commits the submitted child before navigation while the root remains dirty", async () => {
    const { el, cert } = await mount();
    await edit(cert, "passphrase", "new-pass");
    let dirtyAtGoto: boolean | undefined;
    cert.addEventListener("setup-goto", () => {
      dirtyAtGoto = leaveCoordinatorFor(cert)!.isDirty([cert]);
    });
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    expect(dirtyAtGoto).toBe(false);
    await expect.poll(() => (el as unknown as State).screen).toBe("fiscal-test");
    expect(warning(el).open).toBe(false);
    expect((el as unknown as State).draft.aeatCert).toEqual({
      ...initialCert,
      passphrase: "new-pass",
    });
    expect(unload()).toBe(true);
  });
  it("reconnecting the same form retains its original baseline", async () => {
    const { el, cert, host } = await mount();
    await edit(cert, "passphrase", "edited");
    el.remove();
    expect(unload()).toBe(false);
    host.appendChild(el);
    await el.updateComplete;
    await cert.updateComplete;
    expect(unload()).toBe(true);
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "keep");
    expect(field(cert, "passphrase").value).toBe("edited");
  });
  it("changing a value makes an old discard answer inert", async () => {
    const { el, cert } = await mount();
    await edit(cert, "passphrase", "first");
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await edit(cert, "passphrase", "second");
    await expect.poll(() => warning(el).open).toBe(false);
    await choose(el, "discard");
    expect((el as unknown as State).screen).toBe("cert");
    expect(field(cert, "passphrase").value).toBe("second");
  });
  it("pending file selection is protected before its read finishes", async () => {
    deferReads();
    const { el, cert } = await mount();
    select(cert, new File(["new"], "pending.pfx"));
    expect(unload()).toBe(true);
    back(cert);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => (el as unknown as State).screen).toBe("venue");
    DeferredFileReader.pending[0].finish("BAUG");
    await cert.updateComplete;
    expect(cert.shadowRoot!.querySelector("[data-test=file-status]")?.textContent).not.toContain(
      "pending.pfx",
    );
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
  });
  it("Next cannot submit the previous certificate while the replacement is still reading", async () => {
    deferReads();
    const { el, cert } = await mount();
    select(cert, new File(["new"], "pending.pfx"));
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    expect((el as unknown as State).screen).toBe("cert");
    expect((el as unknown as State).draft.aeatCert).toEqual(initialCert);
    DeferredFileReader.pending[0].finish("BAUG");
    await cert.updateComplete;
    cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await expect.poll(() => (el as unknown as State).screen).toBe("fiscal-test");
    expect((el as unknown as State).draft.aeatCert?.pfxBase64).toBe("BAUG");
  });
});
