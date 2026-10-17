import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { encodeNodeKey } from "./paper-register-compact.js";
import {
  parseRecoveryDocument,
  recoveryDocumentBytes,
  RECOVERY_ATTACHMENT,
  MAX_RECOVERY_PDF,
  refuseRecovery,
  type RecoveryDocument,
} from "./recovery-document.js";

export async function renderRecoveryPdf(
  input: RecoveryDocument,
  locale: "en" | "es",
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await parseRecoveryDocument(input);
  if (locale !== "en" && locale !== "es") refuseRecovery();
  const response = await fetch(fontUrl);
  if (!response.ok) refuseRecovery();
  const fontBytes = new Uint8Array(await response.arrayBuffer());
  const font = create(fontBytes as unknown as Buffer) as Font;
  const safe = (text: string) =>
    Array.from(text, (c) =>
      font.hasGlyphForCodePoint(c.codePointAt(0)!)
        ? c
        : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`,
    ).join("");
  const en = locale === "en";
  const pdf = new PDFDocument({
    size: "A4",
    margin: 42,
    font: fontBytes as unknown as string,
    info: { Title: en ? "Waitron recovery key" : "Clave de recuperación de Waitron" },
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    pdf.on("data", (data: Uint8Array) => {
      length += data.length;
      if (length > MAX_RECOVERY_PDF) {
        reject(new Error("Recovery PDF refused"));
        return;
      }
      chunks.push(data);
    });
    pdf.on("error", () => reject(new Error("Recovery PDF refused")));
    pdf.on("end", () => {
      if (length > MAX_RECOVERY_PDF) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      resolve(bytes);
    });
  });
  const write = (text: string, size = 11) =>
    pdf.fontSize(size).text(safe(text), { paragraphGap: 8 });
  write(en ? "Waitron recovery key" : "Clave de recuperación de Waitron", 22);
  pdf.moveDown();
  write(`${en ? "Legal name" : "Razón social"}: ${document.taxpayerName}`);
  write(`NIF: ${document.scope.taxpayerNif}`);
  write(`${en ? "Venue" : "Local"}: ${document.venueName}`);
  write(
    `${en ? "Environment" : "Entorno"}: ${document.scope.environment === "production" ? (en ? "Production" : "Producción") : en ? "Preproduction" : "Preproducción"}`,
  );
  write(`${en ? "Software ID" : "ID del software"}: ${document.scope.softwareId}`);
  write(`${en ? "Node ID" : "ID del nodo"}: ${document.nodeKey.nodeId}`);
  write(`${en ? "Key name" : "Nombre de la clave"}: ${document.nodeKey.name}`);
  write(`${en ? "Created (UTC)" : "Creado (UTC)"}: ${document.createdAt}`);
  pdf.moveDown();
  write(en ? "Standard key (raw192)" : "Clave estándar (raw192)", 14);
  const printed = await encodeNodeKey(document.nodeKey, document.scope, "raw192");
  write(`${en ? "Key" : "Clave"}: ${printed.fields.value}`, 14);
  write(`${en ? "Check" : "Control"}: ${printed.fields.check}`, 14);
  write(
    en
      ? "47 characters to enter. Spaces are optional."
      : "47 caracteres para introducir. Los espacios son opcionales.",
  );
  pdf.moveDown();
  write(
    en
      ? "Keep this sheet in a safe place. Anyone with this key and its matching backup can recover the node."
      : "Guarda esta hoja en un lugar seguro. Cualquiera con esta clave y su copia de seguridad correspondiente puede recuperar el nodo.",
  );
  write(
    en
      ? "Recovery also needs the matching backup and any separate backup password. This sheet is not a backup of your sales."
      : "La recuperación también necesita la copia de seguridad correspondiente y cualquier contraseña independiente de la copia. Esta hoja no es una copia de seguridad de tus ventas.",
  );
  write(
    en
      ? "Keep older sheets for older backups. A new key does not unlock backups made with an older key."
      : "Guarda las hojas anteriores para copias anteriores. Una clave nueva no abre las copias hechas con una clave anterior.",
  );
  pdf.file(recoveryDocumentBytes(document).buffer, {
    name: RECOVERY_ATTACHMENT,
    type: "application/json",
  });
  pdf.end();
  return result;
}
