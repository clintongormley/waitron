# Printer follow-ups

You can preview a stored job as a receipt, including its text spacing, line feeds, cuts,
native QR symbols and raster graphics. The preview interprets the commands Waitron's
`EscBuilder` emits. Unknown commands stop interpretation and show an incomplete-preview
notice. Drawer pulses do not create printable content.

The server returns ordered text, feed, cut and bitmap blocks alongside the existing text
summary. It bounds input, text, block count and bitmap dimensions before returning data.
Native QR commands become bitmaps using the stored data, module size and correction level.
The browser renders these blocks on white paper in both themes; receipt data never becomes
HTML or a navigable URL. You can select a 58 mm or 80 mm paper approximation because the
printer record does not contain paper width. The notice explains that fonts, code pages and
physical printer settings can change the paper output.

Printer Delete requires a second click, matching agent Delete. The printer table defaults to
Active and offers Disabled and All filters. Discovery offers a disabled matching printer as
Add again; this updates `active` on the retained record and preserves its name, routing, history
and pending jobs. The hint explains that pending jobs resume. Active matches stay hidden. Named shared switches replace
the native toggles in hardware and routing forms. Table-cell CSS uses shadow parts so styles
remain owned by the screen. Last-print aggregates return numeric epoch milliseconds instead
of depending on PostgreSQL's text date format.

Physical Bluetooth/network discovery and paper comparison need a reachable configured box
and attached hardware. Record exactly which checks ran; keep missing hardware receipts open.
