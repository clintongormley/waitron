import type { DeploymentEnvironment, DeploymentMode } from "@waitron/db";
import type { SubscriberLag } from "@waitron/sync";
import type { CertExpiry } from "./cert-expiry.js";
import type { ChainHeight } from "./chain-height.js";
import type { TimeHealth } from "./time-health.js";

/**
 * The box-status wire shape. `cert.available: false`, `replication.configured: false` and
 * `backup.configured: false` are the deliberate N/A placeholders — cert when no TLS path is
 * configured or the leaf is unreadable, replication when sync is off (Task 6 supplies the reader),
 * backup unconditionally until 4b fills it in. `chain` is passed through untouched; the "no records"
 * signal is `chain.height === 0`, never `chain.lastAt`.
 */
export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  chain: ChainHeight;
  replication:
    { configured: false } | { configured: true; worstLagSeq: string; subscribers: number };
  backup: { configured: false };
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  chain: () => Promise<ChainHeight>;
  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  duties: () => Record<string, unknown>;
};

export async function collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus> {
  const [mode, time, chain] = await Promise.all([readers.mode(), readers.time(), readers.chain()]);

  let cert: BoxStatus["cert"] = { available: false };
  if (readers.cert !== undefined) {
    try {
      const c = await readers.cert();
      cert = { available: true, notAfter: c.notAfter, daysRemaining: c.daysRemaining };
    } catch {
      // A missing or unreadable leaf must never fail the whole status read.
      cert = { available: false };
    }
  }

  let replication: BoxStatus["replication"] = { configured: false };
  if (readers.replicationLag !== undefined) {
    // `lagFor` returns worst-first, so the head is the worst lag. bigint → string on the wire
    // (never `Number()`); an empty subscriber list summarises as a zero worst-lag.
    const lags = await readers.replicationLag();
    replication = {
      configured: true,
      worstLagSeq: (lags[0]?.lag ?? 0n).toString(),
      subscribers: lags.length,
    };
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    chain,
    replication,
    backup: { configured: false },
    duties: readers.duties(),
  };
}
