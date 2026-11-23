import {
  activityLog,
  incidents,
  orderDrafts,
  outgoingMail,
  printJobs,
  settings,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { jsonFile, type PersonalDataPart } from "@waitron/module";
import { and, eq, ne, or } from "drizzle-orm";
import { readHistory } from "./personal-data-service-actions.js";

const FILE = "staff-actions.json";

async function staffActions(db: Database, personId: string) {
  const billEdits = await readHistory(db, workingOrders, (range) =>
    db
      .select({ orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(and(range, eq(workingOrders.editorId, personId)))
      .all(),
  );
  const ownedDrafts = await readHistory(db, orderDrafts, (range) =>
    db
      .select({ draftId: orderDrafts.id })
      .from(orderDrafts)
      .where(and(range, eq(orderDrafts.ownerId, personId)))
      .all(),
  );
  const creditedLines = await readHistory(db, workingOrderLines, (range) =>
    db
      .select({ lineId: workingOrderLines.id, orderNumber: workingOrders.orderNumber })
      .from(workingOrderLines)
      .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(and(range, eq(workingOrderLines.creditedTo, personId)))
      .all(),
  );
  const acknowledgedAlerts = await readHistory(db, incidents, (range) =>
    db
      .select({ code: incidents.code, at: incidents.acknowledgedAt })
      .from(incidents)
      .where(and(range, eq(incidents.acknowledgedBy, personId)))
      .all(),
  );
  const activity = await readHistory(db, activityLog, (range) =>
    db
      .select({ kind: activityLog.kind, at: activityLog.at })
      .from(activityLog)
      .where(and(range, eq(activityLog.personId, personId)))
      .all(),
  );
  const mail = await readHistory(db, outgoingMail, (range) =>
    db
      .select({
        kind: outgoingMail.kind,
        status: outgoingMail.status,
        at: outgoingMail.queuedAt,
        subject: eq(outgoingMail.personId, personId).mapWith(Boolean),
        requester: eq(outgoingMail.requestedBy, personId).mapWith(Boolean),
        seq: outgoingMail.seq,
      })
      .from(outgoingMail)
      .where(
        and(
          range,
          ne(outgoingMail.kind, "attendance_question"),
          or(eq(outgoingMail.personId, personId), eq(outgoingMail.requestedBy, personId)),
        ),
      )
      .all(),
  );
  const receiptHandovers = await readHistory(db, printJobs, (range) =>
    db
      .select({ jobId: printJobs.id, at: printJobs.handedOverAt })
      .from(printJobs)
      .where(and(range, eq(printJobs.handedOverBy, personId)))
      .all(),
  );
  const savedSettings = await readHistory(db, settings, (range) =>
    db
      .select({ module: settings.module, at: settings.updatedAt })
      .from(settings)
      .where(and(range, eq(settings.updatedBy, personId)))
      .all(),
  );

  return {
    billEdits: billEdits.sort((a, b) => a.orderNumber - b.orderNumber),
    ownedDrafts: ownedDrafts.sort((a, b) => a.draftId.localeCompare(b.draftId)),
    creditedLines: creditedLines.sort(
      (a, b) => a.orderNumber - b.orderNumber || a.lineId.localeCompare(b.lineId),
    ),
    acknowledgedAlerts: acknowledgedAlerts.sort(
      (a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.code.localeCompare(b.code),
    ),
    activity: activity.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || a.kind.localeCompare(b.kind),
    ),
    outgoingMail: mail
      .sort((a, b) => a.seq - b.seq)
      .map(({ kind, status, at, subject, requester }) => ({
        kind,
        status,
        at,
        yourPart: [...(subject ? ["subject"] : []), ...(requester ? ["requester"] : [])],
      })),
    receiptHandovers: receiptHandovers.sort(
      (a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.jobId.localeCompare(b.jobId),
    ),
    savedSettings: savedSettings.sort((a, b) => a.module.localeCompare(b.module)),
  };
}

export function staffActionsPersonalData(db: Database): PersonalDataPart[] {
  return [
    {
      owner: "server",
      part: {
        files: [FILE],
        prepare:
          async (_tx, { personId }) =>
          async () => {
            const data = await staffActions(db, personId);
            return Object.values(data).some((rows) => rows.length > 0)
              ? [jsonFile(FILE, data)]
              : [];
          },
      },
    },
  ];
}
