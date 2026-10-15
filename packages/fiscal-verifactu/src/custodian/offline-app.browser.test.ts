import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { OfflineCustodyApp } from "./offline-app.js";
import { custodyRequest } from "../testing/custodian-fixture.js";
import { custodyPassphrase } from "../testing/custodian-fixture.js";
import { restoreSecretPaper } from "./paper-codec.js";
import { checkCustodyChallenge } from "./challenge.js";
import type { KitCheckRequest } from "./custody-state.js";
import axe from "axe-core";

let app: OfflineCustodyApp | undefined;
afterEach(() => {
  app?.remove();
  document.querySelector("#custody-print")?.remove();
  vi.restoreAllMocks();
});

async function mount() {
  app = new OfflineCustodyApp();
  document.body.append(app);
  await app.updateComplete;
  return app;
}
async function upload(el: Element, name: string, value: unknown) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const files = new DataTransfer();
  files.items.add(new File([JSON.stringify(value)], `${name}.json`, { type: "application/json" }));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function uploadRaw(el: Element, name: string, value: string) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const files = new DataTransfer();
  files.items.add(new File([value], `${name}.json`));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function fill(el: Element, name: string, value: string) {
  const field = el.shadowRoot!.querySelector(
    `wt-input[name="${name}"], wt-textarea[name="${name}"]`,
  )!;
  await userEvent.fill(
    field.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!,
    value,
  );
}

it("uses actual file selection, asks about an existing master first and offers no replacement creation", async () => {
  const el = await mount();
  await userEvent.click(page.getByRole("button", { name: "New kit", exact: true }));
  expect(
    el.shadowRoot!.querySelector('[role="status"]')!.textContent!.replace(/\s+/g, " ").trim(),
  ).toBe("Progress: Not checked");
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="host-request"]')!.required,
  ).toBe(true);
  await upload(el, "host-request", await custodyRequest());
  await userEvent.click(page.getByRole("button", { name: "Load setup request", exact: true }));
  await expect
    .element(page.getByText("Does this scope already have a current master?", { exact: true }))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Yes — use its custodian", exact: true }));
  await expect
    .element(
      page.getByText("Use the existing custodian’s current original and signing path.", {
        exact: false,
      }),
    )
    .toBeVisible();
  expect(el.shadowRoot!.querySelector('[data-action="create"]')).toBeNull();
  await expect
    .element(page.getByRole("button", { name: "Sign consumed assignment", exact: true }))
    .toBeDisabled();
});

it("shows field and bottom errors for a missing custodian; unsupported crypto refuses without a key", async () => {
  const el = await mount();
  await userEvent.click(page.getByRole("button", { name: "New kit", exact: true }));
  await upload(el, "host-request", await custodyRequest());
  await userEvent.click(page.getByRole("button", { name: "Load setup request", exact: true }));
  await userEvent.click(
    page.getByRole("button", { name: "No — create the first kit", exact: true }),
  );
  await userEvent.click(page.getByRole("button", { name: "Create key", exact: true }));
  const field = el.shadowRoot!.querySelector('wt-input[name="custodian"]') as HTMLElement & {
    error: string;
  };
  expect(field.error).toBe("Complete this field.");
  await vi.waitFor(() =>
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input")),
  );
  await expect
    .element(page.getByText("Correct the highlighted fields.", { exact: true }))
    .toBeVisible();
  await userEvent.fill(page.getByRole("textbox", { name: "Custodian", exact: false }), " ");
  expect(field.error).toBe("Check this field.");
  await expect
    .element(page.getByRole("button", { name: "Create key", exact: true }))
    .toBeDisabled();
  await userEvent.fill(page.getByRole("textbox", { name: "Custodian", exact: false }), "Elena");
  vi.spyOn(crypto.subtle, "generateKey").mockRejectedValue(new Error("unsupported"));
  field
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toContain("Crypto is unavailable."),
  );
  await expect.element(page.getByText("Crypto is unavailable.", { exact: false })).toBeVisible();
  expect(el.shadowRoot!.querySelector('[data-action="save-key"]')).toBeNull();
});

it("clears a secret transcription on refusal/close and never writes browser storage", async () => {
  const store = vi.spyOn(Storage.prototype, "setItem");
  const el = await mount();
  await userEvent.click(page.getByRole("button", { name: "Check secret paper", exact: true }));
  await userEvent.fill(
    page.getByRole("textbox", { name: "Transcribe the physical recovery sheet", exact: false }),
    "PRIVATE-TRANSCRIPTION-SENTINEL",
  );
  await userEvent.click(page.getByRole("button", { name: "Close and clear", exact: true }));
  expect(el.shadowRoot!.textContent).not.toContain("PRIVATE-TRANSCRIPTION-SENTINEL");
  expect(store).not.toHaveBeenCalled();
});

it("a refused native original print clears its DOM, locks reissue and allows only explicit spoiled reconciliation", async () => {
  vi.spyOn(window, "print").mockImplementation(() => {
    throw new Error("printer unavailable");
  });
  const el = await mount();
  await userEvent.click(page.getByRole("button", { name: "New kit", exact: true }));
  await upload(el, "host-request", await custodyRequest());
  await userEvent.click(page.getByRole("button", { name: "Load setup request", exact: true }));
  await userEvent.click(
    page.getByRole("button", { name: "No — create the first kit", exact: true }),
  );
  await fill(el, "custodian", "Elena");
  await userEvent.click(page.getByRole("button", { name: "Create key", exact: true }));
  await userEvent.click(
    page.getByRole("button", { name: "Print the one public original", exact: true }),
  );
  expect(document.querySelector("#custody-print")).toBeNull();
  await expect
    .element(page.getByRole("button", { name: "Print the one public original", exact: true }))
    .toBeDisabled();
  await fill(el, "incident", "failed original reconciled as spoiled");
  await userEvent.click(
    page.getByRole("button", { name: "Print failed / spoiled / uncertain", exact: true }),
  );
  await expect
    .element(page.getByText("Progress: Assignments stopped", { exact: true }))
    .toBeVisible();
});

for (const theme of ["light", "dark"] as const)
  it(`guides real controls in ${theme} through new/file/paper/resume/reserve/sign/handover/stopped states; source UI checks use synthetic paper, not physical acceptance`, async () => {
    const blobs: Blob[] = [],
      documents: string[] = [];
    const createUrl = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return createUrl(blob);
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(window, "print").mockImplementation(() => {
      documents.push(document.querySelector("#custody-print")!.innerHTML);
      window.dispatchEvent(new Event("afterprint"));
    });
    const store = vi.spyOn(Storage.prototype, "setItem");
    const click = (name: string) =>
      userEvent.click(page.getByRole("button", { name, exact: true }));
    const audit = async (state: string) => {
      const labels: Record<string, [string, string]> = {
        "file-saved-unchecked": ["Check the saved file", "Comprueba el archivo guardado"],
        "paper-check-pending": ["Check the printed paper", "Comprueba el papel impreso"],
        "paper-key-checked": ["Paper key checked", "Clave del papel comprobada"],
        "file-checked": ["Recovery checks verified", "Recuperaciones verificadas"],
        ready: ["Ready to reserve", "Listo para reservar"],
        handover: ["Assignments paused for handover", "Asignaciones detenidas por relevo"],
        stopped: ["Assignments stopped", "Asignaciones detenidas"],
      };
      await expect
        .element(page.getByText(`Progress: ${labels[state]![0]}`, { exact: true }))
        .toBeVisible();
      const result = await axe.run(app!);
      expect(
        result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      await click("ES");
      await expect
        .element(page.getByText(`Estado: ${labels[state]![1]}`, { exact: true }))
        .toBeVisible();
      if (state === "ready")
        expect(app!.shadowRoot!.textContent).toContain("A-S000001 / Ordinarias");
      const spanish = await axe.run(app!);
      expect(
        spanish.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      expect(getComputedStyle(app!).backgroundColor).toBe(
        theme === "light" ? "rgb(247, 247, 248)" : "rgb(16, 18, 22)",
      );
      await click("EN");
    };
    const downloaded = async () => {
      await vi.waitFor(() => expect(blobs.length).toBeGreaterThan(0));
      return blobs.pop()!.text();
    };
    const enter = (name: string) => {
      const field = app!.shadowRoot!.querySelector(`wt-input[name="${name}"]`)!;
      field
        .shadowRoot!.querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
        );
    };
    const request = await custodyRequest();
    let el = await mount();
    if (theme === "dark") await click("Dark");
    await click("New kit");
    await upload(el, "host-request", { ...request, privateKey: "REFUSED-SENTINEL" });
    await click("Load setup request");
    await expect
      .element(
        page.getByText(
          "Check the selected input and the current original. Nothing was confirmed.",
          {
            exact: true,
          },
        ),
      )
      .toBeVisible();
    await upload(el, "host-request", request);
    await click("Load setup request");
    await expect
      .element(page.getByRole("heading", { name: "This setup", exact: true }))
      .toBeVisible();
    expect(el.shadowRoot!.textContent).toContain("event-1");
    expect(el.shadowRoot!.textContent).toContain("node-1");
    expect(el.shadowRoot!.textContent).toContain("administrator-1");
    await click("No — create the first kit");
    await fill(el, "custodian", "Elena <script>not executable</script>");
    await click("Create key");
    await click("Save public check request");
    const publicKit = JSON.parse(await downloaded()) as KitCheckRequest;
    await click("Save public key");
    const trust = JSON.parse(await downloaded()) as { fingerprint: string };
    expect(trust.fingerprint).toBe(publicKit.public.fingerprint);
    await fill(el, "passphrase", custodyPassphrase);
    await fill(el, "confirmation", "mismatch");
    await click("Save protected key");
    await expect
      .element(page.getByText("Correct the highlighted fields.", { exact: true }))
      .toBeVisible();
    expect(
      (
        el.shadowRoot!.querySelector('wt-input[name="confirmation"]') as HTMLElement & {
          error: string;
        }
      ).error,
    ).toBe("Check this field.");
    await fill(el, "passphrase", custodyPassphrase);
    await fill(el, "confirmation", custodyPassphrase);
    await click("Save protected key");
    const file = await downloaded();
    await audit("file-saved-unchecked");
    await click("Print secret recovery sheet");
    const paper = new DOMParser()
      .parseFromString(documents[0]!, "text/html")
      .querySelector("pre")!.textContent!;
    expect(documents[0]).toContain("Whoever holds this paper can sign.");
    await click("Print the one public original");
    expect(documents[1]).toContain("UNASSIGNED");
    expect(documents[1]).toContain("&lt;script&gt;");
    expect(documents[1]).not.toContain("<script>");
    expect(documents[1]).not.toContain(paper.split("\n")[7]!);
    await fill(el, "incident", "one usable original kept");
    await click("I checked and kept the one usable original");
    await click("Check saved file");
    await uploadRaw(el, "saved-file", file);
    await fill(el, "passphrase", custodyPassphrase);
    enter("passphrase");
    await audit("paper-check-pending");
    await click("Save check receipt");
    expect(JSON.parse(await downloaded()).kind).toBe("saved-file");
    await click("Close and clear");
    el.remove();

    el = await mount();
    if (theme === "dark") await click("Dark");
    await click("Check secret paper");
    await upload(el, "kit-request", publicKit);
    await click("Load check request");
    await fill(el, "paper", paper);
    await fill(el, "fingerprint", "0".repeat(64));
    enter("fingerprint");
    await expect
      .element(
        page.getByText(
          "Check the selected input and the current original. Nothing was confirmed.",
          {
            exact: true,
          },
        ),
      )
      .toBeVisible();
    const paperInput = el.shadowRoot!.querySelector('wt-textarea[name="paper"]') as HTMLElement & {
      value: string;
    };
    expect(paperInput.value).toBe("");
    await fill(el, "paper", paper);
    await fill(el, "fingerprint", publicKit.public.fingerprint);
    enter("fingerprint");
    await click("Save check receipt");
    expect(
      el.shadowRoot!.querySelector('[role="status"]')!.textContent!.replace(/\s+/g, " ").trim(),
    ).toBe("Progress: Paper key checked");
    await audit("paper-key-checked");
    const paperReceipt = JSON.parse(await downloaded()) as unknown;
    await click("Close and clear");
    el.remove();

    el = await mount();
    if (theme === "dark") await click("Dark");
    await click("Reopen / existing kit");
    await upload(el, "host-request", request);
    await click("Load setup request");
    await upload(el, "kit-request", publicKit);
    await click("Load check request");
    await click("Check saved file");
    await uploadRaw(el, "saved-file", file);
    await fill(el, "passphrase", "wrong passphrase");
    enter("passphrase");
    await expect
      .element(
        page.getByText(
          "Check the selected input and the current original. Nothing was confirmed.",
          {
            exact: true,
          },
        ),
      )
      .toBeVisible();
    await uploadRaw(el, "saved-file", file);
    await fill(el, "passphrase", custodyPassphrase);
    enter("passphrase");
    await click("Save check receipt");
    const fileReceipt = JSON.parse(await downloaded()) as unknown;
    await upload(el, "file-receipt", fileReceipt);
    await upload(el, "paper-receipt", paperReceipt);
    await click("Verify both receipts");
    await audit("file-checked");
    await fill(el, "fingerprint", publicKit.public.fingerprint);
    await userEvent.click(page.getByRole("switch", { name: /I checked the actual paper/ }));
    enter("fingerprint");
    await audit("ready");
    await fill(el, "incident", "master page 1 row 1");
    await userEvent.click(page.getByRole("switch", { name: /I consulted the current original/ }));
    await userEvent.click(page.getByRole("switch", { name: /I confirm no former machine/ }));
    enter("incident");
    await click("S000001");
    await userEvent.click(page.getByRole("switch", { name: /I marked this assignment consumed/ }));
    enter("incident");
    await click("Save public allocation");
    const input = JSON.parse(await downloaded()) as {
      allocation: { installationIdentity: string; reservationEvidence: { block: unknown } };
    };
    expect(input.allocation.installationIdentity).toBe("S000001");
    await click("Save signed block");
    expect(JSON.parse(await downloaded())).toEqual(input.allocation.reservationEvidence.block);
    await click("Print snapshot");
    expect(documents.at(-1)).toContain("PUBLIC SNAPSHOT");
    expect(documents.at(-1)).not.toContain("PUBLIC ORIGINAL</h1>");
    await fill(el, "successor", "María");
    enter("successor");
    await audit("handover");
    await expect
      .element(page.getByRole("button", { name: "Sign consumed assignment", exact: true }))
      .toBeDisabled();
    await uploadRaw(el, "saved-file", file);
    await fill(el, "passphrase", custodyPassphrase);
    enter("passphrase");
    await click("Save check receipt");
    const successorFile = JSON.parse(await downloaded()) as unknown;
    const restored = await restoreSecretPaper(paper, publicKit.public);
    const successorPaper = await checkCustodyChallenge(restored, publicKit.public, {
      requestId: publicKit.requestId,
      kind: "secret-paper",
    });
    restored.dispose();
    await upload(el, "file-receipt", successorFile);
    await upload(el, "paper-receipt", successorPaper);
    await click("Verify both receipts");
    await userEvent.click(
      page.getByRole("switch", { name: /The successor has the same original/ }),
    );
    await fill(el, "retained", "Elena’s sealed copy recorded");
    enter("retained");
    await audit("ready");
    await fill(el, "stop-reference", "current master currency disputed");
    enter("stop-reference");
    await audit("stopped");
    await click("Save public history");
    const history = JSON.parse(await downloaded()) as { incidents: { reason: string }[] };
    expect(history.incidents.map((v) => v.reason)).toEqual([
      "custody-attested",
      "reserved-in-ink",
      "consumed",
      "handover-started",
      "handover-complete",
      "uncertain",
    ]);
    expect(JSON.stringify(history)).not.toMatch(/pkcs8|ciphertext|passphrase|PRIVATE/);
    expect(store).not.toHaveBeenCalled();
    await click("Close and clear");
  });
