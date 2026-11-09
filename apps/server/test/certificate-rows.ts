/** Raw inserts of a `fiscal_certificate_installs` row, for tests that write `venue.db` directly. */
function certificateRow(id: string, source: "setup" | "dashboard") {
  const dashboard = source === "dashboard";
  return `insert into fiscal_certificate_installs
    (id, node_id, installed_at, source, person_id, kind, fingerprint, valid_from, valid_until,
     checked_endpoint, checked_at)
    values ('${id}', '00000000-0000-4000-8000-0000000000a1', '2026-10-18T10:00:00.000Z',
            '${source}', ${dashboard ? "'00000000-0000-4000-8000-0000000000b2'" : "null"},
            'sello', 'AA:BB', '2026-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z',
            ${dashboard ? "'https://prewww1.aeat.es', '2026-10-18T10:00:00.000Z'" : "null, null"})`;
}

const SETUP_CERTIFICATE = certificateRow("00000000-0000-4000-8000-0000000000c1", "setup");
const DASHBOARD_CERTIFICATE = certificateRow("00000000-0000-4000-8000-0000000000c2", "dashboard");

export { SETUP_CERTIFICATE, DASHBOARD_CERTIFICATE };
