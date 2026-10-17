import { describe, expect, it, vi } from "vitest";
import { createRecoveryDelivery } from "./recovery-delivery.js";
import { readRecoveryPdf } from "./recovery-reader.js";
import { recoveryDocumentPublic, type RecoveryDocument } from "./recovery-document.js";
const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
describe("transient recovery delivery session", () => {
  it("reuses exact bytes and URL, confirms only on explicit kept and revokes on disposal", async () => {
    const storage = {
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    };
    const confirm = vi.fn(async () => "host-grant");
    const session = createRecoveryDelivery(document, "en", confirm);
    try {
      const download = await session.download();
      const print = await session.print();
      expect(print).toBe(download);
      const bytes = new Uint8Array(await (await fetch(download)).arrayBuffer());
      expect((await readRecoveryPdf(bytes)).document).toEqual(document);
      const binding = await session.ready();
      expect(binding.statement).toEqual(recoveryDocumentPublic(document));
      expect(binding.bindingDigest).toBe(
        await digest(
          new TextEncoder().encode(
            '{"createdAt":"2026-10-17T12:30:00.000Z","kind":"waitron-recovery-document","nodeKey":{"name":"Caja principal","nodeId":"node-1"},"scope":{"environment":"production","softwareId":"W1","taxpayerNif":"B12345674"},"taxpayerName":"Olivo Restauración SL","venueName":"Olivo Centro","version":1}',
          ),
        ),
      );
      expect(binding.documentDigest).toBe(await digest(bytes));
      expect(JSON.stringify(binding)).not.toContain(document.nodeKey.secret);
      expect(confirm).not.toHaveBeenCalled();
      expect(await session.kept()).toBe("host-grant");
      expect(confirm).toHaveBeenCalledExactlyOnceWith(binding);
      expect(await session.download()).toBe(download);
      session.dispose();
      await expect(fetch(download)).rejects.toThrow();
      await expect(session.print()).rejects.toThrow("Recovery delivery disposed");
      await expect(session.kept()).rejects.toThrow("Recovery delivery disposed");
      expect({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      }).toEqual(storage);
    } finally {
      session.dispose();
    }
  });
  it("rejects render completion after disposal", async () => {
    const session = createRecoveryDelivery(document, "es", async () => true);
    const pending = session.download();
    session.dispose();
    await expect(pending).rejects.toThrow("Recovery delivery disposed");
  });
  it("rejects a confirmation completed after disposal", async () => {
    let done!: (v: string) => void;
    const session = createRecoveryDelivery(
      document,
      "en",
      () =>
        new Promise<string>((resolve) => {
          done = resolve;
        }),
    );
    await session.ready();
    const pending = session.kept();
    await vi.waitFor(() => expect(done).toBeTypeOf("function"));
    session.dispose();
    done("late");
    await expect(pending).rejects.toThrow("Recovery delivery disposed");
  });
  it("freezes caller input and rejects invalid data", async () => {
    const input = structuredClone(document);
    const session = createRecoveryDelivery(input, "en", async () => true);
    Object.assign(input.nodeKey, { secret: "z".repeat(32) });
    try {
      expect(
        (
          await readRecoveryPdf(
            new Uint8Array(await (await fetch(await session.download())).arrayBuffer()),
          )
        ).document,
      ).toEqual(document);
    } finally {
      session.dispose();
    }
    const bad = createRecoveryDelivery({ ...document, venueName: "" }, "en", async () => true);
    try {
      await expect(bad.ready()).rejects.toThrow("Recovery PDF refused");
    } finally {
      bad.dispose();
    }
  });
});
