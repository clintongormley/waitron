import { describe, expect, it } from "vitest";
import { NODE_LOCAL_MANIFEST } from "./manifest.js";

describe("the node-local manifest", () => {
  it("lists no item twice", () => {
    const items = NODE_LOCAL_MANIFEST.map((row) => row.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it("places and classes every row as the plan's table decides", () => {
    expect(NODE_LOCAL_MANIFEST.map((row) => `${row.item}|${row.where}|${row.class}`)).toEqual([
      "node_mode|node.db|destination-owned",
      "node_mirror_link|node.db|destination-owned",
      "node_primary_key|node.db|destination-owned",
      "node_recovery_key|node.db|destination-owned",
      "node_signing_key|node.db|source-only",
      "node_handover_operations|node.db|destination-owned",
      "node_handover_events|node.db|destination-owned",
      "node_handover_restriction|node.db|destination-owned",
      "join_requests|venue.db|source-only",
      "change_log|venue.db|rebuildable",
      "node_sealed_state|venue.db|source-only",
      "recovery_packs|venue.db|source-only",
      "document_delivery_requests|venue.db|source-only",
      "document_delivery_sequences|venue.db|source-only",
      "device_invoice_save_operations|venue.db|source-only",
      "fiscal_certificate_installs|venue.db|source-only",
      "fiscal_certificate_reminders|venue.db|source-only",
      "tenant_credentials|venue.db|transferred",
      "secrets.env|state|transferred",
      "trading.env|state|destination-owned",
      "tls/ca.crt|state|destination-owned",
      "tls/ca.key|state|destination-owned",
      "tls/server.crt|state|destination-owned",
      "tls/server.key|state|destination-owned",
      "tls/venue-ca.crt|state|destination-owned",
      "tls/venue-ca.key|state|destination-owned",
      "backup.env|state|transferred",
      "modules.json|state|transferred",
      "module-preparation-state.json|state|transferred",
      "module-evidence/<module>/<source>.json|state|source-only",
      ".venue.db-litestream/|venue-folder|rebuildable",
    ]);
  });

  it("names exact file names, a template only for a module's kept file", () => {
    const patterned = NODE_LOCAL_MANIFEST.filter((row) => /[*<]/.test(row.item)).map((r) => r.item);
    expect(patterned).toEqual(["module-evidence/<module>/<source>.json"]);
  });

  it("never sends M1's private signing key, and carries the key ring and the venue's credentials", () => {
    const classOf = (item: string) => NODE_LOCAL_MANIFEST.find((row) => row.item === item)?.class;
    expect(classOf("node_signing_key")).toBe("source-only");
    expect(classOf("secrets.env")).toBe("transferred");
    expect(classOf("tenant_credentials")).toBe("transferred");
    expect(classOf("trading.env")).toBe("destination-owned");
    expect(classOf("change_log")).toBe("rebuildable");
  });

  it("says what M2 does with every item", () => {
    expect(NODE_LOCAL_MANIFEST.filter((row) => row.treatment.trim() === "")).toEqual([]);
  });
});
