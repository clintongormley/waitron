import type { PaperBlock, SignedPaperValue } from "../paper-protocol.js";
import type { CustodyKey, CustodyPublic } from "./key-codec.js";
import { encodeSecretPaper } from "./paper-codec.js";
import { custodyStrings, custodyValueLabel, type CustodyLocale } from "./strings.js";

export interface MasterContext {
  readonly attemptId: string;
  readonly requestId: string;
  readonly locale: CustodyLocale;
  readonly eventId: string;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly operatorId: string;
}
function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function master(
  context: MasterContext,
  block: PaperBlock,
  key: CustodyPublic,
  original: boolean,
): string {
  const t = custodyStrings(context.locale);
  const fields = [
    [
      t.scope,
      `${key.scope.taxpayerNif} / ${key.scope.softwareId} / ${custodyValueLabel(key.scope.environment, context.locale)}`,
    ],
    [t.custodian, block.custodianId],
    [t.fingerprint, key.fingerprint],
    [t.generation, block.generationId],
    [t.block, block.blockId],
    [t.request, context.requestId],
    [t.attempt, context.attemptId],
    [t.event, context.eventId],
    [t.source, context.sourceId],
    [t.node, context.targetNodeId],
    [t.operator, context.operatorId],
  ];
  return `<article class="custody-document" lang="${context.locale}"><h1>${original ? t.original : t.snapshot}</h1><p>${original ? t.originalWarning : t.snapshotWarning}</p><dl>${fields.map(([name, value]) => `<dt>${name}</dt><dd>${escape(value!)}</dd>`).join("")}</dl>${original ? `<p>${t.originalIssue}: ____________________</p>` : ""}<table><thead><tr><th>${t.allocation}</th><th>${t.series}</th><th>${t.reservation}</th><th>${t.eventAttempt}</th><th>${t.result}</th><th>${t.time}</th></tr></thead><tbody>${block.allocations.map((a) => `<tr><td>${escape(a.installationIdentity)}<br>${escape(a.allocationId)}</td><td>${a.series.map((s) => `${escape(s.code)} / ${escape(custodyValueLabel(s.purpose, context.locale))}`).join("<br>")}</td><td>${original ? t.unassigned : "—"}<br>________</td><td>________<br>________</td><td>________</td><td>________</td></tr>`).join("")}</tbody></table><p>${t.exhaustion}</p><p>${t.recovery}</p><p>${t.handoverCare}</p><p>${t.loss}</p></article>`;
}
export function renderMasterOriginal(
  context: MasterContext,
  candidates: PaperBlock,
  publicKey: CustodyPublic,
): string {
  return master(context, candidates, publicKey, true);
}
export function renderMasterSnapshot(
  context: MasterContext,
  block: SignedPaperValue<PaperBlock>,
  publicKey: CustodyPublic,
): string {
  return (
    master(context, block.payload, publicKey, false) +
    `<pre class="public-signature">${escape(JSON.stringify(block))}</pre>`
  );
}
export async function renderSecretPaper(key: CustodyKey, locale: CustodyLocale): Promise<string> {
  const t = custodyStrings(locale);
  return `<article class="custody-document secret-document" lang="${locale}"><h1>${t.secret}</h1><p><strong>${t.secretWarning}</strong></p><pre>${escape(await encodeSecretPaper(key))}</pre><p>${t.printCare}</p><p>${t.separation}</p><p>${t.paperLimit}</p></article>`;
}
