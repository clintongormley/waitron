import type { RecoveryPackPage } from "@waitron/recovery-pack";
import { shortNodeId } from "@waitron/shared";
import { encodeRecoveryKey } from "./recovery-key-code.js";
import {
  refuseRecovery,
  type RecoveryDocument,
  type RecoveryDocumentPublic,
} from "./recovery-document.js";

const words = {
  en: {
    title: "Server key",
    intro:
      "With this key and its matching backup, the venue's server can be recovered with its own identity.",
    legalName: "Legal name",
    venue: "Venue",
    environment: "Environment",
    production: "Production",
    preproduction: "Preproduction",
    softwareId: "Software ID",
    serverId: "Server ID",
    keyName: "Key name",
    created: "Created",
    key: "Key",
    keepSafe:
      "Keep this pack in a safe place. Anyone with this key and its matching backup can recover the server.",
    notABackup:
      "A backup in Waitron Cloud needs your Cloud login. This pack is not a backup of your sales.",
    keepOlder:
      "Keep older packs for older backups. A new key does not unlock backups made with an older key.",
  },
  es: {
    title: "Clave del servidor",
    intro:
      "Con esta clave y su copia correspondiente se puede recuperar el servidor del local con su propia identidad.",
    legalName: "Razón social",
    venue: "Local",
    environment: "Entorno",
    production: "Producción",
    preproduction: "Preproducción",
    softwareId: "ID del software",
    serverId: "ID del servidor",
    keyName: "Nombre de la clave",
    created: "Creado",
    key: "Clave",
    keepSafe:
      "Guarda este paquete en un lugar seguro. Cualquiera con esta clave y su copia correspondiente puede recuperar el servidor.",
    notABackup:
      "Una copia en Waitron Cloud necesita tu acceso a Cloud. Este paquete no es una copia de seguridad de tus ventas.",
    keepOlder:
      "Guarda los paquetes anteriores para las copias anteriores. Una clave nueva no abre las copias hechas con una clave anterior.",
  },
} as const;

function createdWhen(
  document: RecoveryDocument | RecoveryDocumentPublic,
  language: string,
  timeZone: string,
  withTime: boolean,
): string {
  try {
    if (!withTime) {
      const day = document.nodeKey.name.slice(0, 10);
      if (!/^\d{4}-\d\d-\d\d$/.test(day)) refuseRecovery();
      const date = new Date(`${day}T12:00:00.000Z`);
      if (date.toISOString().slice(0, 10) !== day) refuseRecovery();
      return new Intl.DateTimeFormat(language, { timeZone: "UTC", dateStyle: "long" }).format(date);
    }
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
    return `${day}, ${time} ${zone}`;
  } catch {
    refuseRecovery();
  }
}

/** The pack's server-key page; a document without a secret describes the key in force. */
export function serverKeyPage(
  document: RecoveryDocument | RecoveryDocumentPublic,
  options: { readonly locale: "en" | "es"; readonly timeZone: string },
): RecoveryPackPage {
  const w = words[options.locale];
  const secret = "secret" in document.nodeKey ? document.nodeKey.secret : undefined;
  const created = createdWhen(
    document,
    options.locale === "en" ? "en-GB" : "es-ES",
    options.timeZone,
    secret !== undefined,
  );
  const page: RecoveryPackPage = {
    title: w.title,
    intro: w.intro,
    rows: [
      { label: w.legalName, value: document.taxpayerName },
      { label: "NIF", value: document.scope.taxpayerNif },
      { label: w.venue, value: document.venueName },
      { label: w.environment, value: w[document.scope.environment] },
      { label: w.softwareId, value: document.scope.softwareId },
      { label: w.serverId, value: shortNodeId(document.nodeKey.nodeId) },
      { label: w.keyName, value: document.nodeKey.name },
      { label: w.created, value: created },
    ],
    notes: secret === undefined ? [w.keepOlder] : [w.keepSafe, w.notABackup, w.keepOlder],
  };
  if (secret !== undefined)
    page.secret = { label: w.key, text: encodeRecoveryKey(secret), qr: true };
  return page;
}
