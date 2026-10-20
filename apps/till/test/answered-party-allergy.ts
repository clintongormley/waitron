import { vi } from "vitest";
import type { TillTableOrderScreen } from "../src/screens/till-table-order-screen.js";

export function answeredPartyAllergy(el: HTMLElement) {
  const view = async (partyId: string) => {
    const shown =
      el.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen")?.party;
    if (shown?.id !== partyId) throw new Error("The answered party fixture is not open");
    return {
      partyId,
      snapshot: {
        answer: "none" as const,
        guests: [],
        ticks: [],
        changedAt: null,
        changedBy: null,
        revision: shown.revision,
      },
      dishes: [],
    };
  };
  return { readPartyAllergy: vi.fn(view), previewPartyAllergy: vi.fn(view) };
}
