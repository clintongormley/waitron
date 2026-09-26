# Printer calibration wizard

## Follow-up, 26 September 2026

The setup flow below records the original three-step design. Its follow-up uses four steps:
choose characters, measure the paper and QR, test the receipt, then answer whether a cash drawer
is attached. The measurement sheet restores the A/B/C/D width lines. You choose the longest
unwrapped line and whether the QR is closer to 40 mm or 45 mm; the screen derives the settings.

Finder options and the side-by-side W and 8 examples are available before you print. Printed and
on-screen codes now use `06-W` and `06-8`. Historical hardware observations below retain the
labels that were printed at the time.

Click a printer name to open its status page, including connection details, calibration settings,
drawer attachment and an Edit button. Drawer attachment and till assignment are separate fields.
The most recent completed print supplies the observing agent when no newer discovery result exists.

The print-agent setup page shows progress during Bluetooth scans and a retryable error when a
scan fails. Command failures and simulated discovery refusals are tested; the Bluetooth radio and
printer have not been verified in this follow-up. Bluetooth job delivery still needs the per-device
connection implementation identified by `liveBtDevicePath` in `apps/print-agent/src/linux-devices.ts`.

## Setup flow

You enter calibration immediately after adding or reactivating a printer. An existing printer's
editor also opens the same three steps:

1. Choose a character set from the printed finder. Codes use `W-06` and `8-06`, appear only on
   the first sample line, and identify both the byte encoding and the printer's numeric table.
   Returning to a printed range restores its options without another print.
2. Set paper width and resolution directly. The measurement sheet keeps the QR ruler test and
   removes the A/B/C/D width examples and the old character-set choices.
3. Print a sample receipt using your draft settings. Record whether a cash drawer is attached,
   request a separate opening test, and confirm what happened on the hardware.

The drawer result is immediate feedback, not an automatic hardware-detection claim. Saving records
`printers.hasCashDrawer`; the old device-level flag is removed. A test may run before saving that
flag, because calibration is how you establish whether it belongs on this printer.

Disabling a printer takes one click and closes the action menu. The printers list always exposes
the shared status filter. Print agents advertise their setup URL and listening port. The server
may supply its own agent's LAN URL from configured addresses, but does not invent an address for
a remote agent. Advertised links accept HTTP(S) origins without credentials, paths or query data.

## Receipt QR size

Choose the largest whole-dot scale whose black QR square is at most 40mm and whose four-module
blank border fits the configured paper width. This replaces the closest-to-35mm preference; the
minimum remains 30mm where the grid and paper allow it. Keep the non-throwing fallback when no
legal size fits. The calibration measurement QR keeps its fixed size so it can identify resolution.

At 203dpi on 80mm paper, the 33-module sample receipt QR uses nine dots per module: about 37.2mm
without its border. On 58mm paper its border limits it to eight dots, about 33.0mm. The layout and
sample-receipt tests pin these cases and the upper limit.

The receipt uses native centring for its body, QR and VERI*FACTU legend. Body lines are padded to the
configured column count so their left-aligned descriptions and right-aligned amounts stay aligned
as a block. The legend remains unpadded, directly beneath the QR's blank border, with a blank line
after the legend rather than before it. The preview carries alignment
with its text and image blocks and preserves the body's trailing spaces when laying out the text.
The owner approved the centred body and QR in the 13:39:49 photograph. The final product-format
sample, including the centred legend, was sent with `final-centered-sample.ts` in the probe folder.
The owner approved the final QR-to-legend gap and the blank line after it in the 13:47:10 photograph.

Follow-up, 2026-09-26: a 58mm roll in the owner's wider printer exposed that native centring still
used the printer's default print area. Receipts now set a zero left margin and the configured safe
print width before centring. The print-agent list also has its own remembered Active/Revoked/All
status filter, separate from the printer list's saved filter.

## Drawer boundary

Receipt and measurement documents contain no drawer command. The explicit calibration action
requires `printer.manage` and `cash.drawer`, enqueues a `drawer` job and records its authorizing
person and printer in the same transaction. Calibration audit rows have no till or sale.
Drawer jobs remain ineligible for manual resend.

Cash-sale and manual till opening check the selected printer's attachment flag. Existing handheld,
profile and authorization restrictions still apply. The core migration rebuilds `drawer_opens`
without copying its old rows, following the preproduction no-data-migration rule; it also drops
the unused device flag. Do not treat this migration as preserving an existing drawer audit log.

## Physical investigation, 26 September 2026

The owner's NETUM NT-806 was tested directly over TCP port 9100 at `192.168.10.81`. The earlier
failing finder also used its network address. Scripts and emitted byte files are retained for
this session under `/tmp/waitron-printer-probe.Ofr6rA`.

- `reset-comparison.ts`: the owner reported all five table-6 lines correct, with no reset,
  table-zero reset, CR/LF variants and initialization.
- `unsupported-transition.ts`: the owner reported all lines correct after interleaving table 11.
  This did not reproduce the failure and does not establish that a reset cleared the prior table.
- `original-finder.ts`: the full original 0–15 finder reproduced the incorrect table-6 sample.
- `full-no-reset.ts`: removing only the 64 table-zero commands did not repair it.
- `paced-finder.ts`: sending the same no-reset bytes with 150 ms between lines did not repair it.
- `table-two-transition.ts`: table 6 printed `Café ñ ü €` correctly initially; selecting table 2,
  then table 6 left the table-2 glyphs. `ESC @`, `FS .`, then selecting 6 restored that sample.
- `isolated-tables.ts`: initializing before each sample restored the useful table-6 accents and
  euro, but its curly quotes were blank. Tables 16 and 19 still did not match the supplied chart.
  Reversing the order to 19, 16, 6 produced the same glyphs for each table.
- `table-zero.ts`: selecting 0 after 6 restored the initial table-0 sample; selecting 0 after 2
  kept table-2 glyphs. Initializing before selecting 0 restored the initial sample.
- `pc858-scan.ts`: with initialization on each line, table 14 printed the PC858 sample with its
  euro. This is outside the manual's documented ranges, 0–10 and 16–21.
- `product-finder.ts`: the actual updated `formatCharacterTableTest` output for 0–15 showed full
  matches at W-11 and 8-14, including the quotation marks; W-06 left curly quotes blank.
- `product-sample.ts`: the actual `formatSampleReceipt` output using `pc858`, table 14, 80mm and
  180dpi printed readable Spanish text and euro amounts. The photo does not measure QR dimensions.

The supplied NT-806 programmer manual, PDF page 21, gives `1B 74 n`, decimal table numbers,
16 for WPC1252 and 19 for PC858. Page 13 says `ESC @` restores the power-on mode. Inspection with
`xxd -g 1 /tmp/waitron-printer-probe.Ofr6rA/isolated-reversed.bin` found the corresponding table
commands `1B 74 10`, `1B 74 13` and `1B 74 06`; each follows `1B 40 1C 2E`.

The finder now initializes and cancels Kanji mode before each candidate line;
`character-table-test.test.ts` checks that byte sequence. The 0–15 finder and PC858/table-14 sample
receipt have now been inspected on paper. W-11 is the first full match on this unit; PC858/table 14
is also usable for the tested text. Do not hardcode these numbers for other printers. Why this
unit's observed selections differ from the supplied manual remains unknown.

An independent encoding comparison also passed: `spawnSync("iconv", ["-f", "UTF-8", "-t", codec],
{ input: "áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ € £ çÇ" })` produced byte-for-byte matches for Waitron's `encodeText`
with `CP858`/`pc858` and `CP1252`/`wpc1252`. This checks those sample bytes, not every character.
