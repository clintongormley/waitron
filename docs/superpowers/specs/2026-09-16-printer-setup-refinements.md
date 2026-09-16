# Printer setup refinements

You should be able to name a discovered printer before adding it, change its connection and paper
settings together, and use a separate test dialog to interpret the printed page.

- Remove tab-duplicate headings, hide the status filter when no registrations exist, and put the
  local-agent marker in Host. Keep the filter when only disabled registrations exist.
- Open a naming dialog when you choose Add. Require a name, initially the existing discovery label
  (the saved name for reactivation). Keep entered names across discovery polling. Add again retains
  the registration.
- Put address, port and Connect together, and paper width, resolution and character set together.
  Rows wrap on narrow screens. Device and poll identifiers are displayed as read-only text.
- Print test page opens a dialog and queues the page. Radio answers update the edit draft only when
  you apply them; Cancel leaves it alone. Printed instructions follow your dashboard language: saved
  user preference, then browser language, then the venue default. Explain which QR square to measure, excluding its white
  border, and that scanning it is unnecessary. Errors stay in the active dialog.
- Explain agent pairing as steps: open the agent setup page, enter the server address, then match
  its number. Keep the pairing window's existing lifecycle.
- Identify fetch rejection separately from an HTTP refusal. Do not infer that the server process
  stopped from a browser connection failure. Show successful addition separately from a failed list refresh and offer Refresh lists.
  Investigate the reported environment before assigning a cause.

## Character-set investigation

The NT-806 manual lists the same table numbers already sent by Waitron. Its separate Kanji mode is
not explicitly cancelled by our builder. Explicitly select single-byte text mode for configured
text output and teach preview to consume that command. Preserve the legacy/default builder used
for drawer jobs. This is a documented command correction, not proof of the physical fault.

| Source | Words in the source | Interpretation |
| --- | --- | --- |
| [NETUM NT-806 programmer manual](https://cdn.shopify.com/s/files/1/2144/8019/files/netum-printer-nt-806-programmer-manual-en.pdf?v=1786441250), ESC t and FS . | “16 WPC1252”; “19 PC858”; “Cancels Kanji character mode.” | Existing table numbers match; FS . selects the mode needed for single-byte text. |

Downloaded with curl and extracted with pdftotext on 2026-09-16. Physical verification needs another
printed page on the NT-806. Adding unrelated language tables does not establish why these two fail.

## Incident evidence

The owner used https://waitron.local on the real box and reports that adding the printer succeeded
and the dashboard continued working. The supplied console output contains refused background GETs
as well as earlier 401 responses. It does not establish their timing relative to the successful POST.
A read-only `curl -I --connect-timeout 3 --max-time 5 https://waitron.local/management-api/session/me`
from this development machine timed out resolving the name. The owner later reported that the box
was back up and did not know why it had gone down. Two further probes using macOS curl with a
five-second connection deadline also timed out resolving the name. No box logs were obtained.

The browser regression reproduces a successful create followed by a rejected discovery refresh.
It verifies that the saved printer is hidden from Add, the naming dialog is closed, and success
and refresh failure are separately visible. This explains a misleading feedback path, not the
underlying connection refusals on the owner's network.

The supplied address `192.168.10.101` was checked directly with curl `--resolve` and TCP sockets.
Ports 443 and 80 returned `ECONNREFUSED` (errno 61). `route -n get 192.168.10.101` selected `lo0`,
and `ifconfig` showed that address assigned to this development Mac's `en0`; `lsof` found no listener
on 443. Those probes describe the Mac, not an independently identified restaurant box.

### Name collision confirmed, 2026-09-16

The owner identified the box as `192.168.10.10`. A public `/health` request pinned with
`curl -ksS --resolve waitron.local:443:192.168.10.10 https://waitron.local/health` returned
`ok: true` at 14:43 local time, with `startedAt: 2026-09-16T11:51:55.863Z`. Certificate verification
was skipped only for this unauthenticated diagnostic request because the Mac did not trust the
box's issuer. A normal name-based request also returned 200 from `192.168.10.10`.

At 14:44 and 14:45, `dns-sd -G v4 waitron.local` returned **both** `192.168.10.101` (the Mac)
and `192.168.10.10` (the box), each with TTL 120. After the owner stopped the laptop's server,
the 14:48 probe returned only `192.168.10.10`. This demonstrates a name collision and provides a
route to the reported connection refusals without requiring the box to have stopped. It does not
identify the destination of each historical browser request.

All three server boot paths called the mDNS responder unconditionally. The responder now skips
`WAITRON_ENV=dev` and loopback-only HTTP listeners, so local development does not publish the
box's name. Non-development LAN listeners retain discovery. The fake-socket regression first
failed because all six disabled configurations created a socket; all passed after the guard.

## Owner follow-up and physical character-table probe, 2026-09-16

Later owner feedback supersedes two setup choices above. Hide the status filter whenever every
registration has the same status, including an all-disabled list. Keep disabled registrations rather
than deleting them: `print_jobs.printer_id` and the till and station routing tables still reference
printer ids (`packages/db/drizzle/0034_drop_tenant_id_after_sql.sql`). Put unsupported office-printer
scan results after receipt-printer results, move Scan to the trailing edge, and collapse the known-
address form in a bordered panel.

One QR sample is sufficient. Its 53-module code at six dots per module measures 39.8 mm at 203 dpi
and 44.9 mm at 180 dpi, excluding its quiet zone. Ask whether its black square is 30–40 mm: Yes means
203 dpi; wider than 40 mm means 180 dpi. The paper-width lines decide only 58 mm versus 80 mm.

The owner supplied an NT-806 test page on which the configured table-16 and table-19 lines were
garbled. A direct 1,469-byte raw-print probe to `192.168.10.81:9100` then printed bytes `0x80–0xFF`
under `ESC t` tables 0, 6, 16 and 19. The photographed output identifies table 0 as PC437, table 6 as
Windows-1252 (including `€` at `0x80`), table 16 as CP866 Cyrillic, and table 19 as CP737 Greek. Thus
this unit changes tables correctly, but its firmware's numeric assignments contradict the supplied
manual. Waitron must store the text encoding separately from the printer's numeric table. Its normal
test page covers the common pairs; a batched finder prints Windows-1252 and PC858 samples for sixteen
consecutive table numbers so a different printer can be identified from paper without trusting its
manual. A sample-receipt action then prints a clearly marked simulated receipt with the editor's
current unsaved settings.
