import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import { shortNodeId } from "@waitron/shared";
import { encodeRecoveryKey } from "./recovery-key-code.js";
import {
  parseRecoveryDocument,
  recoveryDocumentBytes,
  RECOVERY_ATTACHMENT,
  MAX_RECOVERY_PDF,
  refuseRecovery,
  type RecoveryDocument,
} from "./recovery-document.js";

export async function renderRecoveryPdfWithFont(
  input: RecoveryDocument,
  locale: "en" | "es",
  loadFont: () => Promise<Uint8Array>,
  timeZone: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await parseRecoveryDocument(input);
  if (locale !== "en" && locale !== "es") refuseRecovery();
  if (document.installationCodes.length !== 1) refuseRecovery();
  if (typeof timeZone !== "string" || timeZone === "") refuseRecovery();
  let created: string;
  try {
    const language = locale === "en" ? "en-GB" : "es-ES";
    const date = new Date(document.createdAt);
    const day = new Intl.DateTimeFormat(language, { timeZone, dateStyle: "long" }).format(date);
    const time = new Intl.DateTimeFormat(language, {
      timeZone,
      timeStyle: "short",
      hourCycle: "h23",
    }).format(date);
    const zone = new Intl.DateTimeFormat(language, { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")!.value;
    created = `${day}, ${time} ${zone}`;
  } catch {
    refuseRecovery();
  }
  const fontBytes = await loadFont();
  const font = create(fontBytes as unknown as Buffer) as Font;
  const safe = (text: string) =>
    Array.from(text, (c) =>
      font.hasGlyphForCodePoint(c.codePointAt(0)!)
        ? c
        : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`,
    ).join("");
  const attachment = recoveryDocumentBytes(document);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", attachment));
  const contentDigest =
    "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
  const en = locale === "en";
  const info = {
    Title: en ? "Waitron recovery key" : "Clave de recuperación de Waitron",
    WaitronRecoveryDigest: contentDigest,
  };
  const pdf = new PDFDocument({
    size: "A4",
    margin: 42,
    font: fontBytes as unknown as string,
    info,
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
    pdf.fontSize(size).text(safe(text), 42, pdf.y, { width: pdf.page.width - 84, paragraphGap: 8 });
  const row = (label: string, value: string) => {
    pdf.fontSize(11);
    const left = { width: 150 };
    const right = { width: pdf.page.width - 246 };
    const height = Math.max(
      pdf.heightOfString(safe(label), left),
      pdf.heightOfString(safe(value), right),
    );
    if (pdf.y + height > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();
    const y = pdf.y;
    pdf.text(safe(label), 42, y, left);
    pdf.text(safe(value), 204, y, right);
    pdf.y = y + height + 8;
  };
  write(en ? "Waitron recovery key" : "Clave de recuperación de Waitron", 22);
  pdf.moveDown();
  row(en ? "Legal name" : "Razón social", document.taxpayerName);
  row("NIF", document.scope.taxpayerNif);
  row(en ? "Venue" : "Local", document.venueName);
  row(
    en ? "Environment" : "Entorno",
    document.scope.environment === "production"
      ? en
        ? "Production"
        : "Producción"
      : en
        ? "Preproduction"
        : "Preproducción",
  );
  row(en ? "Software ID" : "ID del software", document.scope.softwareId);
  row(en ? "Node ID" : "ID del nodo", shortNodeId(document.nodeKey.nodeId));
  row(en ? "Key name" : "Nombre de la clave", document.nodeKey.name);
  row(en ? "Installation code" : "Código de instalación", document.installationCodes[0]!);
  row(en ? "Created" : "Creado", created);
  pdf.moveDown();
  if (pdf.y > pdf.page.height - pdf.page.margins.bottom - 120) pdf.addPage();
  const printed = encodeRecoveryKey(document.nodeKey.secret);
  write(`${en ? "Key" : "Clave"}: ${printed}`, 14);
  pdf.moveDown();
  write(
    en
      ? "Keep this sheet in a safe place. Anyone with this key and its matching backup can recover the node."
      : "Guarda esta hoja en un lugar seguro. Cualquiera con esta clave y su copia de seguridad correspondiente puede recuperar el nodo.",
  );
  write(
    en
      ? "A backup in Waitron Cloud needs your Cloud login. A downloaded backup file needs its own password. Keep these separately from this sheet. This sheet is not a backup of your sales."
      : "Una copia en Waitron Cloud necesita tu acceso a Cloud. Un archivo de copia descargado necesita su propia contraseña. Guárdalos separados de esta hoja. Esta hoja no es una copia de seguridad de tus ventas.",
  );
  write(
    en
      ? "Keep older sheets for older backups. A new key does not unlock backups made with an older key."
      : "Guarda las hojas anteriores para copias anteriores. Una clave nueva no abre las copias hechas con una clave anterior.",
  );
  pdf.file(attachment.buffer, {
    name: RECOVERY_ATTACHMENT,
    type: "application/json",
  });
  pdf.end();
  return result;
}
