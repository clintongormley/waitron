import { html, nothing, type TemplateResult } from "lit";
import type { DiscoveredPrinter } from "../api/printing-api.js";
import { fill, t } from "../i18n/t.js";
import type { OfficeRow } from "./discovered-printers.js";

export function discoveredPrinterAgentDetails(
  device: DiscoveredPrinter,
  row: OfficeRow | undefined,
): TemplateResult {
  const move = row?.kind === "repoint" ? row : undefined;
  // A network printer names an agent only when the row offers a move to it.
  return html`
    ${
      device.agentName && (device.transport !== "network_tcp" || move)
        ? html`<div>${fill("printers.discovered_found_by", { agent: device.agentName })}</div>`
        : nothing
    }
    ${
      move
        ? html`<div>
            ${t(move.agentGone ? "printers.page_printer_no_agent" : "printers.page_printer_other_agent")}
          </div>`
        : nothing
    }
  `;
}
