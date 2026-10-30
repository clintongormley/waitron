import { describe, expect, it } from "vitest";
import { shortNodeId } from "@waitron/shared";
import { encodeRecoveryKey } from "./recovery-key-code.js";
import type { RecoveryDocument } from "./recovery-document.js";
import { serverKeyPage } from "./server-key-page.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "production" },
  taxpayerName: "Waitron SL",
  venueName: "Local principal",
  createdAt: "2026-10-18T12:00:00.000Z",
  nodeKey: {
    nodeId: "node-00000000-aaaa-bbbb-cccc-000000000001",
    name: "2026-09-02 · TEST",
    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  },
};
const publicKey = { nodeId: document.nodeKey.nodeId, name: document.nodeKey.name };
const withoutSecret = { ...document, nodeKey: publicKey };
const zone = { timeZone: "Atlantic/Canary" };

describe("serverKeyPage", () => {
  it("prints the new key, its rows and the three warnings in English", () => {
    expect(serverKeyPage(document, { locale: "en", ...zone })).toEqual({
      title: "Server key",
      intro:
        "With this key and its matching backup, the venue's server can be recovered with its own identity.",
      rows: [
        { label: "Legal name", value: "Waitron SL" },
        { label: "NIF", value: "89890001K" },
        { label: "Venue", value: "Local principal" },
        { label: "Environment", value: "Production" },
        { label: "Software ID", value: "W1" },
        { label: "Server ID", value: shortNodeId(document.nodeKey.nodeId) },
        { label: "Key name", value: "2026-09-02 · TEST" },
        { label: "Created", value: "18 October 2026, 13:00 WEST" },
      ],
      secret: { label: "Key", text: encodeRecoveryKey(document.nodeKey.secret), qr: true },
      notes: [
        "Keep this pack in a safe place. Anyone with this key and its matching backup can recover the server.",
        "A backup in Waitron Cloud needs your Cloud login. This pack is not a backup of your sales.",
        "Keep older packs for older backups. A new key does not unlock backups made with an older key.",
      ],
    });
  });

  it("prints the new key, its rows and the three warnings in Spanish", () => {
    expect(serverKeyPage(document, { locale: "es", ...zone })).toEqual({
      title: "Clave del servidor",
      intro:
        "Con esta clave y su copia correspondiente se puede recuperar el servidor del local con su propia identidad.",
      rows: [
        { label: "Razón social", value: "Waitron SL" },
        { label: "NIF", value: "89890001K" },
        { label: "Local", value: "Local principal" },
        { label: "Entorno", value: "Producción" },
        { label: "ID del software", value: "W1" },
        { label: "ID del servidor", value: shortNodeId(document.nodeKey.nodeId) },
        { label: "Nombre de la clave", value: "2026-09-02 · TEST" },
        { label: "Creado", value: "18 de octubre de 2026, 13:00 WEST" },
      ],
      secret: { label: "Clave", text: encodeRecoveryKey(document.nodeKey.secret), qr: true },
      notes: [
        "Guarda este paquete en un lugar seguro. Cualquiera con esta clave y su copia correspondiente puede recuperar el servidor.",
        "Una copia en Waitron Cloud necesita tu acceso a Cloud. Este paquete no es una copia de seguridad de tus ventas.",
        "Guarda los paquetes anteriores para las copias anteriores. Una clave nueva no abre las copias hechas con una clave anterior.",
      ],
    });
  });

  it("does not tell the reader to keep a backup file's password apart, because the pack holds it", () => {
    for (const locale of ["en", "es"] as const) {
      const text = serverKeyPage(document, { locale, ...zone }).notes.join(" ");
      expect(text).not.toMatch(/password|contraseña/i);
    }
  });

  it.each([
    ["en", "Created", "2 September 2026", "Preproduction"],
    ["es", "Creado", "2 de septiembre de 2026", "Preproducción"],
  ] as const)(
    "without a new key (%s) shows the same rows, the key name's day as its creation, no key and only the older-packs note",
    (locale, created, day, environment) => {
      const page = serverKeyPage(
        { ...withoutSecret, scope: { ...withoutSecret.scope, environment: "preproduction" } },
        { locale, ...zone },
      );
      expect(page).not.toHaveProperty("secret");
      expect(page.rows.at(-1)).toEqual({ label: created, value: day });
      expect(page.rows[3]!.value).toBe(environment);
      expect(page.rows).toHaveLength(8);
      expect(page.notes).toEqual([serverKeyPage(document, { locale, ...zone }).notes[2]]);
    },
  );

  it("refuses a key name whose first ten characters are not a day", () => {
    expect(() =>
      serverKeyPage(
        { ...withoutSecret, nodeKey: { ...publicKey, name: "not a day" } },
        { locale: "en", ...zone },
      ),
    ).toThrow("Recovery PDF refused");
  });

  it("refuses an unknown time zone", () => {
    expect(() => serverKeyPage(document, { locale: "en", timeZone: "Nowhere/Never" })).toThrow(
      "Recovery PDF refused",
    );
  });
});
