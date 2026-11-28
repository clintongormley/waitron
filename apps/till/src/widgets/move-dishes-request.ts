import type { BillSetMenuState } from "@waitron/shared";
import type { TillApi } from "../api/client.js";
import type { BillRevisions, MergeInvoiceChoice } from "../api/floor-api.js";
import type { TabLine } from "../api/kitchen-api.js";
import type { BillEditExpected } from "../api/order-types.js";
import type { MoveDishesDetail } from "../screens/till-table-order-screen.js";
import { writeWithClosedZone, type LateSendPrompt } from "./late-send-prompts.js";
import { otherPartyRead, type SeatedRead } from "./table-targets.js";

interface SourceBill {
  api: Pick<TillApi, "moveDishes">;
  billId: string;
  partyId: string;
  revisions: BillRevisions;
  expectedEdits: BillEditExpected[];
}

export function writeDishMove(
  source: SourceBill,
  { lineIds, toBillId, toTableId }: MoveDishesDetail,
  relocation: { target: SeatedRead; expectedEdits: BillEditExpected[] } | null | undefined,
  choice: MergeInvoiceChoice | undefined,
  { show, current }: { show: (prompt: LateSendPrompt) => void; current: () => boolean },
) {
  const revisions = { ...source.revisions, expectedEdits: source.expectedEdits };
  const invoice = choice === undefined ? ([] as const) : ([choice] as const);
  if (toTableId === undefined || relocation == null)
    return source.api.moveDishes(source.billId, lineIds, toBillId, revisions, ...invoice);
  const tableRevisions = {
    ...revisions,
    ...otherPartyRead(relocation.target, source.partyId),
    expectedEdits: relocation.expectedEdits,
  };
  return writeWithClosedZone(
    (closedZoneId) =>
      source.api.moveDishes(
        source.billId,
        lineIds,
        { toTableId },
        { ...tableRevisions, ...(closedZoneId === undefined ? {} : { closedZoneId }) },
        ...invoice,
      ),
    show,
    current,
  );
}

export function movesEveryDish(
  lineIds: readonly string[],
  lines: readonly TabLine[],
  setMenus: BillSetMenuState | undefined,
): boolean {
  const dishes = lines.filter((line) => line.parentLineNo == null);
  const moved = new Set(lineIds);
  for (const { lineId, setMenuLineId } of setMenus?.dishes ?? [])
    if (moved.has(setMenuLineId)) moved.add(lineId);
  return dishes.length > 0 && dishes.every((line) => moved.has(line.id));
}
