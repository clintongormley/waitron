import { invoiceSeries, nodes, stampDeployment, type Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { Endorsement } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { locationId, nodeId } from "@waitron/shared";
import { allocationFixture } from "@waitron/fiscal-verifactu/test/allocation-fixture.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { withTransaction } from "@waitron/db";
import { establishReservedStandbyIdentity, type StandbyIdentity } from "../reserved-identity.js";

export async function establishDormantContract(args: {
  db: Database;
  ring: KeyRing;
  locationId: string;
  sourceId: string;
  taxpayerNif: string;
  standby: StandbyIdentity;
  endorsement: Endorsement;
  modules: readonly WaitronModule[];
  operatorId: string;
  recoveryKey?: boolean;
}) {
  const primary = { nodeId: nodeId(args.sourceId), locationId: locationId(args.locationId) };
  const bases = [
    { code: "FA", purpose: "standard" },
    { code: "FF", purpose: "full" },
  ];
  await stampDeployment(args.db, "production");
  await args.db
    .insert(nodes)
    .values({ id: primary.nodeId, locationId: primary.locationId, name: "Original primary" });
  await args.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
  await withTransaction(args.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: primary.nodeId,
      nif: args.taxpayerNif,
      idSistemaInformatico: "W1",
      numeroInstalacion: "S000001",
    }),
  );
  const fixture = allocationFixture({
    node: { ...primary, nodeId: nodeId(args.standby.nodeId) },
    primary,
    taxpayerNif: args.taxpayerNif,
    bases,
    identity: "P000042",
    environment: "production",
    operatorId: args.operatorId,
    recoveryKey: args.recoveryKey,
  });
  const held = fixture.request("establish");
  const modules = args.modules.map((module) =>
    module.name === "fiscal-verifactu" ? { ...module, operations: held.preparation } : module,
  );
  await fixture.authorised("establish", (operation) =>
    establishReservedStandbyIdentity(
      { ownerDb: args.db, ring: args.ring },
      {
        locationId: args.locationId,
        standby: args.standby,
        nodeName: "cloud",
        filingModule: "verifactu",
        taxModule: "vat",
        modules,
        reserved: {
          modules: { "fiscal-verifactu": fixture.state },
          series: [],
          endorsement: args.endorsement,
        },
        moduleOperations: new Map([["fiscal-verifactu", operation]]),
      },
    ),
  );
  return fixture;
}
