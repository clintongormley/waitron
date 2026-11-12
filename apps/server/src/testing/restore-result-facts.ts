import type { stagedHourCrash } from "./staged-hour-crash.js";

type Snapshot = Awaited<ReturnType<Awaited<ReturnType<typeof stagedHourCrash>>["snapshot"]>>;
type RestoreRows = Pick<Snapshot, "registrations" | "series" | "allocations"> &
  Partial<Pick<Snapshot, "chainHeads">>;
export function resultFacts<T extends RestoreRows>(rows: T) {
  const sif = (id: string) => rows.registrations.find((row) => row.id === id)!.numeroInstalacion;
  const series = (id: string) => rows.series.find((row) => row.id === id)!.code;
  return {
    ...rows,
    ...(rows.chainHeads === undefined
      ? {}
      : { chainHeads: rows.chainHeads.map((row) => ({ ...row, actualizadoEn: null })) }),
    registrations: rows.registrations.map((row) => ({
      ...row,
      id: sif(row.id),
      registradoEn: null,
      revocadoEn: row.revocadoEn !== null,
    })),
    series: rows.series.map((row) => ({
      ...row,
      id: series(row.id),
      retiredAt: row.retiredAt !== null,
    })),
    allocations: rows.allocations.map((row) => ({
      ...row,
      activatedAt: null,
      sifId: sif(row.sifId),
      result: {
        ...row.result,
        sifId: sif(row.result.sifId),
        series: row.result.series.map((row) => ({ ...row, id: series(row.id) })),
      },
    })),
  };
}
