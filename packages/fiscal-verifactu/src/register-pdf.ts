import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import type { RegisterDocument } from "./paper-register-protocol.js";
import { encodePosition, encodeNodeKey } from "./paper-register-compact.js";
import { fiscalSetupStrings } from "./setup/strings.js";
import {
  parseRegisterDocument,
  registerDocumentBytes,
  documentScope,
  originalBytes,
  REGISTER_ATTACHMENT,
  MAX_REGISTER_PDF,
  refuseRegister,
} from "./register-document.js";

export async function renderRegisterPdf(
  input: RegisterDocument,
  locale: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await parseRegisterDocument(input);
  if (locale !== "en" && locale !== "es") refuseRegister();
  const response = await fetch(fontUrl);
  if (!response.ok) refuseRegister();
  const fontBytes = new Uint8Array(await response.arrayBuffer());
  const font = create(fontBytes as unknown as Buffer) as Font;
  const safe = (text: string) =>
    Array.from(text, (c) =>
      font.hasGlyphForCodePoint(c.codePointAt(0)!)
        ? c
        : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`,
    ).join("");
  const pdf = new PDFDocument({
    size: "A4",
    margin: 42,
    autoFirstPage: false,
    font: fontBytes as unknown as string,
    info: { Title: locale === "en" ? "Invoice series register" : "Registro de series de facturas" },
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    pdf.on("data", (data: Uint8Array) => {
      length += data.length;
      if (length > MAX_REGISTER_PDF) {
        reject(new Error("Register PDF refused"));
        return;
      }
      chunks.push(data);
    });
    pdf.on("error", () => reject(new Error("Register PDF refused")));
    pdf.on("end", () => {
      if (length > MAX_REGISTER_PDF) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
  });
  pdf.addPage();
  const write = (text: string, size = 10) => {
    pdf.fontSize(size).text(safe(text), { paragraphGap: 5 });
  };
  const title = (text: string) => {
    pdf.moveDown(0.5);
    write(text, 16);
  };
  const scope = documentScope(document);
  title(locale === "en" ? "Invoice series register" : "Registro de series de facturas");
  write(`${scope.taxpayerNif} / ${scope.softwareId} / ${scope.environment}`);
  write(
    locale === "en"
      ? "Keep your current copy. This is not a backup of sales."
      : "Guarda tu copia actual. Este registro no es una copia de seguridad de las ventas.",
  );
  write(
    locale === "en"
      ? "Contains recovery keys. Keep it in your office."
      : "Contiene claves de recuperación. Guárdalo en tu oficina.",
  );
  const paper = document.paper;
  if (paper) {
    title(locale === "en" ? "Continue your paper register" : "Continuar tu registro en papel");
    const last = paper.revisions.at(-1);
    const position = last ?? (paper.mode === "checkpoint" ? paper.checkpoint : null);
    if (!position) refuseRegister();
    const printed = await encodePosition(scope, {
      sHighWater: position.sHighWater,
      pHighWater: position.pHighWater,
    });
    write(`S: ${printed.fields.sPosition}`, 15);
    write(`P: ${printed.fields.pPosition}`, 15);
    write(`${locale === "en" ? "Check" : "Control"}: ${printed.fields.check}`, 15);
    write(
      locale === "en"
        ? "20 characters. Spaces are optional. Confirm this is the current register."
        : "20 caracteres. Los espacios son opcionales. Confirma que es el registro actual.",
    );
    if (paper.mode === "checkpoint")
      write(
        locale === "en"
          ? "Earlier names are unavailable. Earlier allocation details are incomplete."
          : "Los nombres anteriores no están disponibles. El historial anterior está incompleto.",
      );
    title(locale === "en" ? "Paper allocations" : "Asignaciones en papel");
    for (const revision of paper.revisions) {
      write(
        `${locale === "en" ? "Revision" : "Revisión"} ${revision.revision} / ${revision.createdAt}`,
      );
      for (const event of revision.events) {
        if (event.kind === "reserve") {
          write(`${event.allocation.installationIdentity} / ${event.recipientVenueId}`, 12);
          for (const series of event.allocation.series) {
            const t = fiscalSetupStrings[locale];
            const purpose =
              series.purpose === "standard"
                ? t.standard
                : series.purpose === "full"
                  ? t.full
                  : series.purpose === "rectificative"
                    ? t.rectificative
                    : series.purpose;
            write(`${series.code} / ${purpose}`);
          }
          write(
            `${event.allocation.allocationId} / ${event.binding.eventId} / ${event.binding.targetNodeId}`,
          );
        } else if (event.kind === "consume")
          write(
            locale === "en"
              ? `${event.allocationId}: Consumed - never available again. Completion unknown until the box confirms activation.`
              : `${event.allocationId}: Consumida - nunca vuelve a estar disponible. Finalización desconocida hasta que la caja confirme la activación.`,
          );
        else write(`${event.allocationId}: ${event.kind} / ${event.reason}`);
      }
    }
  }
  for (const node of document.nodeKeys) {
    if (pdf.y > 610) pdf.addPage();
    title(locale === "en" ? "Node recovery key" : "Clave de recuperación del nodo");
    write(`${node.name} / ${node.nodeId}`, 12);
    const encoding = /^[A-Za-z0-9_-]{32}$/.test(node.secret) ? "raw192" : "utf8";
    const printed = await encodeNodeKey(node, scope, encoding);
    write(
      locale === "en"
        ? encoding === "raw192"
          ? "Standard key"
          : "Text key"
        : encoding === "raw192"
          ? "Clave estándar"
          : "Clave de texto",
    );
    write(printed.fields.value, 14);
    write(`${locale === "en" ? "Check" : "Control"}: ${printed.fields.check}`, 14);
    write(
      locale === "en"
        ? `${printed.enteredCharacters} characters. Use with a backup naming this node and key.`
        : `${printed.enteredCharacters} caracteres. Úsala con una copia que nombre este nodo y esta clave.`,
    );
  }
  const originals = [...(paper?.originals ?? []), ...document.cloudOriginals];
  if (originals.length) {
    title(locale === "en" ? "Original public records" : "Registros públicos originales");
    for (const original of originals) {
      write(`${original.kind} / ${original.digest}`);
      write(new TextDecoder("utf-8", { fatal: true }).decode(originalBytes(original)), 8);
    }
  }
  pdf.file(registerDocumentBytes(document).buffer, {
    name: REGISTER_ATTACHMENT,
    type: "application/json",
  });
  pdf.end();
  return result;
}
