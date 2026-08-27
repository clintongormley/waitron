import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import type { SetupCertScreen } from "./cert-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

/** Collects the two composed events the screen emits UP; both bubble+compose, so the host hears them. */
function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupCertScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** Types `value` into the passphrase wt-input by firing its composed `wt-change`. */
async function typePassphrase(el: SetupCertScreen, value: string): Promise<void> {
  q(el, "[data-test=passphrase]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Picks `value` in the certKind `<select>` and fires its `change`. */
async function pickKind(el: SetupCertScreen, value: string): Promise<void> {
  const select = q(el, "[data-test=certKind]") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** Waits for the async FileReader + the re-render it triggers, by polling for the loaded status. */
async function waitForFileLoaded(el: SetupCertScreen): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await el.updateComplete;
    if (q(el, "[data-test=file-status]")) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("file-status never appeared");
}

/** Selects `source` (raw byte values) as the certificate file via a DataTransfer, then awaits the read. */
async function chooseFile(el: SetupCertScreen, source: number[], name = "cert.pfx"): Promise<void> {
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  const input = q(el, "[data-test=pfx]") as HTMLInputElement;
  const file = new File([bytes], name, { type: "application/x-pkcs12" });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  await waitForFileLoaded(el);
}

/** Raw PFX bytes (values that exercise the high half of the byte range too). */
const PFX_SOURCE = [1, 2, 3, 4, 250, 200, 0, 255];
/** The canonical base64 the browser must produce — with NO `data:…;base64,` prefix. */
const EXPECTED_BASE64 = btoa(String.fromCharCode(...PFX_SOURCE));

afterEach(cleanupWidgets);

describe("setup-cert-screen", () => {
  it("reads the file to canonical base64 with NO data: prefix, and emits the cert patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();

    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            aeatCert: {
              pfxBase64: EXPECTED_BASE64,
              passphrase: "unlock-2026",
              certKind: "sello",
            },
          },
        },
      },
      { kind: "goto", detail: { screen: "review" } },
    ]);
    // The emitted base64 is the canonical payload only — the data-URL prefix and its comma are gone.
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    const pfx = patch.aeatCert?.pfxBase64 ?? "";
    expect(pfx.startsWith("data:")).toBe(false);
    expect(pfx.includes(",")).toBe(false);
  });

  it("carries a changed certKind into the patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    await pickKind(el, "representante");
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert?.certKind).toBe("representante");
  });

  it("shows the chosen file name in the loaded status (never the bytes)", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await chooseFile(el, PFX_SOURCE, "empresa.pfx");
    const status = q(el, "[data-test=file-status]")!;
    expect(status.textContent).toContain("empresa.pfx");
    expect(status.textContent).not.toContain(EXPECTED_BASE64);
  });

  it("clears the loaded file when the picker is emptied", async () => {
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    await chooseFile(el, PFX_SOURCE);
    expect(q(el, "[data-test=file-status]")).not.toBeNull();

    const input = q(el, "[data-test=pfx]") as HTMLInputElement;
    input.files = new DataTransfer().files; // an empty selection
    input.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(q(el, "[data-test=file-status]")).toBeNull();
  });

  // The file guard, proven by deletion: drop the `pfxBase64 === ""` check and a no-file Next would emit.
  it("blocks Next when no file is chosen, marking the file field invalid", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=error]")!.getAttribute("role")).toBe("alert");
    expect(q(el, ".field.file")!.hasAttribute("invalid")).toBe(true);
  });

  it("blocks Next when the passphrase is blank, marking it invalid", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "   "); // whitespace-only counts as blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=passphrase]")!.hasAttribute("invalid")).toBe(true);
  });

  it("clears the banner once a file and passphrase are supplied and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click(); // empty → banner
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await chooseFile(el, PFX_SOURCE);
    await typePassphrase(el, "unlock-2026");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(events.some((e) => e.kind === "goto")).toBe(true);
  });

  it("seeds passphrase, certKind and the loaded status from a draft cert", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: {
        pfxBase64: EXPECTED_BASE64,
        passphrase: "seeded-pass",
        certKind: "representante",
      },
    };
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    expect((q(el, "[data-test=passphrase]") as unknown as { value: string }).value).toBe(
      "seeded-pass",
    );
    expect((q(el, "[data-test=certKind]") as HTMLSelectElement).value).toBe("representante");
    // A cert already in the draft counts as loaded (the file input cannot be re-populated, but the
    // base64 survives), so the loaded status shows without re-choosing the file.
    expect(q(el, "[data-test=file-status]")).not.toBeNull();
  });

  it("emits the seeded cert unchanged when Next is pressed without re-choosing a file", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: { pfxBase64: EXPECTED_BASE64, passphrase: "seeded-pass", certKind: "sello" },
    };
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    const patch = (events[0].detail as { patch: DeepPartial<ProvisionBody> }).patch;
    expect(patch.aeatCert).toEqual({
      pfxBase64: EXPECTED_BASE64,
      passphrase: "seeded-pass",
      certKind: "sello",
    });
  });

  it("seeds only the fields a partial draft cert carries, leaving the rest at their defaults", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      aeatCert: { certKind: "representante" }, // no pfxBase64, no passphrase
    };
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", { draft });
    expect((q(el, "[data-test=certKind]") as HTMLSelectElement).value).toBe("representante");
    expect((q(el, "[data-test=passphrase]") as unknown as { value: string }).value).toBe("");
    // No pfxBase64 in the draft → nothing loaded yet.
    expect(q(el, "[data-test=file-status]")).toBeNull();
  });

  it("steps back to venue without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "venue" } }]);
  });
});
