import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { PDFDocument as Structure, PDFArray, PDFDict, PDFName } from "pdf-lib";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { renderRegisterPdf } from "./register-pdf.js";
import { readRegisterPdf, openRegisterPdf } from "./register-reader.js";
import {
  decodePosition,
  decodeNodeKey,
  encodePosition,
  encodeNodeKey,
} from "./paper-register-compact.js";
import type { RegisterDocument } from "./paper-register-protocol.js";

const scope = { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" as const };
const time = "2026-10-15T08:00:00.000Z";
const key = { nodeId: "node-1", name: "Peña Λάδι 😀", secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX" };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const bytes = (v: unknown) => new TextEncoder().encode(canonical(v));
const hash = async (b: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
function complete(): RegisterDocument {
  const allocation = {
    version: 1 as const,
    allocationId: "allocation-1",
    ...scope,
    installationIdentity: "S000001",
    series: ["A", "B", "FF", "R"].map((code) => ({
      code: `${code}-S000001`,
      purpose: code === "FF" ? "full" : code === "R" ? "rectificative" : "standard",
    })),
    source: "initial-paper" as const,
    issuedAt: time,
  };
  return {
    version: 2,
    kind: "waitron-register-document",
    route: "paper",
    paper: {
      format: "waitron-paper-register",
      version: 2,
      integrity: "owner-declared",
      registerId: "register-1",
      scope,
      mode: "complete",
      originals: [],
      revisions: [
        {
          version: 2,
          registerId: "register-1",
          scope,
          revision: "1",
          previousDigest: "0".repeat(64),
          createdAt: time,
          sHighWater: 1,
          pHighWater: 0,
          events: [
            {
              kind: "reserve",
              allocation,
              recipientVenueId: "Peña Λάδι",
              binding: {
                module: "fiscal-verifactu",
                action: "initial-setup",
                eventId: "event-1",
                sourceId: "attempt-1",
                targetNodeId: key.nodeId,
              },
              reservedAt: time,
            },
          ],
        },
      ],
    },
    cloudOriginals: [],
    nodeKeys: [key],
  };
}
function checkpoint(): RegisterDocument {
  const doc = complete();
  return {
    ...doc,
    paper: {
      ...doc.paper!,
      mode: "checkpoint",
      revisions: [],
      checkpoint: {
        version: 2,
        kind: "declared-burn-checkpoint",
        checkpointId: "checkpoint-1",
        scope,
        sHighWater: 42,
        pHighWater: 7,
        current: {
          currentRegisterConfirmed: true,
          noParallelPaperAllocation: true,
          confirmedAt: time,
        },
        completeHistoryUnavailable: true,
        burnAllPrior: true,
        createdAt: time,
      },
    },
  };
}
async function cloudOriginal() {
  const data = bytes({
    payload: { allocation: { ...scope, installationIdentity: "C000042" } },
    signature: "opaque-retained-receipt",
  });
  return {
    kind: "cloud-receipt" as const,
    bytesBase64url: btoa(String.fromCharCode(...data))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    digest: await hash(data),
  };
}
async function rawPdf(attachments: readonly (readonly [string, Uint8Array])[], form = false) {
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const pdf = new PDFDocument({ font: font as unknown as string, compress: false });
  const output = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    pdf.on("data", (b: Uint8Array) => chunks.push(b));
    pdf.on("error", reject);
    pdf.on("end", () => {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let i = 0;
      for (const c of chunks) {
        out.set(c, i);
        i += c.length;
      }
      resolve(out);
    });
  });
  pdf.text("Visible text is not recovery data");
  for (const [name, data] of attachments) pdf.file(new Uint8Array(data).buffer, { name });
  if (form) {
    pdf.initForm();
    pdf.formText("test-note", 40, 120, 250, 30, { value: "before" });
  }
  pdf.end();
  return output;
}
async function textOf(pdf: Uint8Array) {
  const task = openRegisterPdf(pdf);
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

describe("register PDF", () => {
  for (const mode of ["complete", "checkpoint", "cloud-only", "cloud-plus-paper"] as const)
    it(`round trips exact ${mode} data and named keys`, async () => {
      let document = mode === "checkpoint" ? checkpoint() : complete();
      if (mode.startsWith("cloud"))
        document = {
          ...document,
          route: "cloud",
          paper: mode === "cloud-only" ? null : document.paper,
          cloudOriginals: [await cloudOriginal()],
        };
      const result = await readRegisterPdf(await renderRegisterPdf(document, "en"));
      expect(result.document).toEqual(document);
      expect(result.attachmentBytes).toEqual(bytes(document));
    });
  it("retains the exact displaced public history without completing the checkpoint", async () => {
    const original = bytes(complete().paper);
    const document = checkpoint();
    document.paper = {
      ...document.paper!,
      originals: [
        {
          kind: "declared-paper-history",
          bytesBase64url: btoa(String.fromCharCode(...original))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replace(/=+$/, ""),
          digest: await hash(original),
        },
      ],
    };
    const result = await readRegisterPdf(await renderRegisterPdf(document, "en"));
    expect(result.document.paper?.mode).toBe("checkpoint");
    expect(result.document.paper?.originals).toEqual(document.paper!.originals);
    expect(new TextDecoder().decode(result.attachmentBytes)).not.toContain("custodySeed");
  });
  it("recovers checkpoint positions from the printed fields", async () => {
    const text = await textOf(await renderRegisterPdf(checkpoint(), "en"));
    const fields = {
      sPosition: text.match(/S: (\d{4} \d{2})/)![1]!,
      pPosition: text.match(/P: (\d{4} \d{2})/)![1]!,
      check: text.match(/Check: ([0-9A-Z]{4} [0-9A-Z]{4})/)![1]!,
    };
    expect(await decodePosition(fields, scope)).toEqual({ sHighWater: 42, pHighWater: 7 });
  });
  it("labels each series purpose in Spanish on the Spanish sheet", async () => {
    const text = await textOf(await renderRegisterPdf(complete(), "es"));
    for (const label of [
      "A-S000001 / Simplificada",
      "B-S000001 / Simplificada",
      "FF-S000001 / Factura completa",
      "R-S000001 / Rectificativa",
    ])
      expect(text).toContain(label);
  });
  it.each(["en", "es"] as const)(
    "prints every base, supported glyph and grouped recovery field in %s",
    async (locale) => {
      const document = complete();
      const pdf = await renderRegisterPdf(document, locale);
      const text = await textOf(pdf);
      for (const code of ["A-S000001", "B-S000001", "FF-S000001", "R-S000001"])
        expect(text).toContain(code);
      expect(text).toContain("Peña Λάδι");
      expect(text).toContain("[U+1F600]");
      const pos = await encodePosition(scope, { sHighWater: 1, pHighWater: 0 });
      const node = await encodeNodeKey(key, scope, "raw192");
      for (const field of [...Object.values(pos.fields), node.fields.value, node.fields.check])
        expect(text).toContain(field);
      expect(await decodePosition(pos.fields, scope)).toEqual({ sHighWater: 1, pHighWater: 0 });
      expect(await decodeNodeKey(node.fields, scope, key.nodeId, key.name)).toEqual(key.secret);
      expect(pos.enteredCharacters).toBe(20);
      expect(node.enteredCharacters).toBe(47);
      expect(pos.enteredCharacters + node.enteredCharacters).toBe(67);
      expect(text).toContain(locale === "en" ? "not a backup" : "no es una copia de seguridad");
      expect(text).not.toMatch(/custody|custodian|seed|head.tag/i);
    },
  );
  it.each(
    (
      [
        [],
        [["other.json", bytes(complete())]],
        [["waitron-register-v2.json", new TextEncoder().encode("broken")]],
        [
          ["waitron-register-v2.json", bytes(complete())],
          ["conflict.json", bytes(checkpoint())],
        ],
      ] as const
    ).map((attachments) => ({ attachments })),
  )("refuses a missing, corrupt or ambiguous carrier %#", async ({ attachments }) => {
    await expect(readRegisterPdf(await rawPdf(attachments))).rejects.toThrow(
      "Register PDF refused",
    );
  });
  it("refuses an oversized decoded attachment", async () => {
    await expect(
      readRegisterPdf(
        await rawPdf([["waitron-register-v2.json", new Uint8Array(8 * 1024 * 1024 + 1)]]),
      ),
    ).rejects.toThrow("Register PDF refused");
  });
  it("refuses repeated name-tree entries even when PDF.js would collapse them", async () => {
    const source = await rawPdf([["waitron-register-v2.json", bytes(complete())]]);
    const doc = await Structure.load(source);
    const names = doc.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
      .lookup(PDFName.of("Names"), PDFArray);
    names.push(names.get(0));
    names.push(names.get(1));
    await expect(readRegisterPdf(await doc.save())).rejects.toThrow("Register PDF refused");
  });
  it.each([
    {
      name: "extra field",
      change: (d: unknown) => Object.assign(d as object, { custodySeed: "forbidden" }),
    },
    {
      name: "paper route without history",
      change: (d: unknown) => Object.assign(d as object, { paper: null }),
    },
    {
      name: "bad digest",
      change: (d: unknown) =>
        Object.assign(d as object, {
          cloudOriginals: [
            { kind: "cloud-receipt", bytesBase64url: "e30", digest: "0".repeat(64) },
          ],
        }),
    },
    {
      name: "duplicate node",
      change: (d: unknown) => Object.assign(d as object, { nodeKeys: [key, key] }),
    },
  ])("refuses $name without reading the visible page", async ({ change }) => {
    const doc = complete();
    change(doc);
    await expect(
      readRegisterPdf(await rawPdf([["waitron-register-v2.json", bytes(doc)]])),
    ).rejects.toThrow("Register PDF refused");
  });
  it("refuses a noncanonical or duplicate-key attachment", async () => {
    const json = new TextDecoder().decode(bytes(complete()));
    for (const data of [
      new TextEncoder().encode(` ${json}`),
      new TextEncoder().encode(json.replace('"version":2', '"version":1,"version":2')),
    ]) {
      await expect(
        readRegisterPdf(await rawPdf([["waitron-register-v2.json", data]])),
      ).rejects.toThrow("Register PDF refused");
    }
  });
  it("refuses hidden signing material inside public history", async () => {
    const document = complete();
    Object.assign(document.paper!.revisions[0]!.events[0]!, { custodySeed: "must-not-be-carried" });
    await expect(
      readRegisterPdf(await rawPdf([["waitron-register-v2.json", bytes(document)]])),
    ).rejects.toThrow("Register PDF refused");
  });
  it("freezes the document before waiting for digest verification", async () => {
    const document = complete();
    document.cloudOriginals = [await cloudOriginal()];
    const pending = renderRegisterPdf(document, "en");
    document.nodeKeys = [{ ...key, secret: "changed-after-render-request" }];
    expect((await readRegisterPdf(await pending)).document.nodeKeys).toEqual([key]);
  });
  it("refuses a selected PDF above 64 MiB before parsing", async () => {
    await expect(readRegisterPdf(new Uint8Array(64 * 1024 * 1024 + 1))).rejects.toThrow(
      "Register PDF refused",
    );
  });
  it("keeps attachment bytes through a real changed form resave and unchanged save control", async () => {
    const source = await rawPdf([["waitron-register-v2.json", bytes(complete())]], true);
    const task = openRegisterPdf(source);
    try {
      const doc = await task.promise;
      const unchanged = await doc.saveDocument();
      expect(await hash(unchanged)).toBe(await hash(source));
      const fields = await doc.getFieldObjects();
      const field = [...fields!.values()].flat()[0]! as { id: string };
      doc.annotationStorage.setValue(field.id, { value: "after" });
      const changed = await doc.saveDocument();
      expect(await hash(changed)).not.toBe(await hash(source));
      const reopened = openRegisterPdf(changed);
      try {
        const saved = await (await reopened.promise).getFieldObjects();
        expect([...saved!.values()].flat()).toEqual(
          expect.arrayContaining([expect.objectContaining({ value: "after" })]),
        );
      } finally {
        await reopened.destroy();
      }
      expect((await readRegisterPdf(changed)).attachmentBytes).toEqual(bytes(complete()));
      expect((await readRegisterPdf(unchanged)).attachmentBytes).toEqual(bytes(complete()));
    } finally {
      await task.destroy();
    }
  });
  it("prints consumption as unavailable even while activation completion is unknown", async () => {
    const document = complete();
    const revision = document.paper!.revisions[0]!;
    document.paper = {
      ...document.paper!,
      revisions: [
        {
          ...revision,
          events: [
            ...revision.events,
            {
              kind: "consume",
              allocationId: "allocation-1",
              reservationDigest: await hash(bytes(revision.events[0])),
              eventId: "event-1",
              operatorId: "manager",
              sourceId: "attempt-1",
              targetNodeId: key.nodeId,
              incidentEvidence: "first Live setup",
              consumedAt: time,
            },
          ],
        },
      ],
    };
    for (const locale of ["en", "es"] as const) {
      const text = await textOf(await renderRegisterPdf(document, locale));
      expect(text).toContain(
        locale === "en"
          ? "Consumed - never available again"
          : "Consumida - nunca vuelve a estar disponible",
      );
      expect(text).toContain(locale === "en" ? "Completion unknown" : "Finalización desconocida");
    }
  });
  it("paginates rather than dropping any named node or full history", async () => {
    const document = complete();
    document.nodeKeys = Array.from({ length: 60 }, (_, i) => ({
      ...key,
      nodeId: `node-${i}`,
      name: `Recovery ${i}`,
    }));
    const pdf = await renderRegisterPdf(document, "en");
    const task = openRegisterPdf(pdf);
    try {
      expect((await task.promise).numPages).toBeGreaterThan(2);
    } finally {
      await task.destroy();
    }
    expect((await readRegisterPdf(pdf)).document.nodeKeys).toHaveLength(60);
    const text = await textOf(pdf);
    expect(text).toContain("Recovery 0");
    expect(text).toContain("Recovery 59");
  });
});
