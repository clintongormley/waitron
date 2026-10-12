# NFC stickers on a real handheld — the W102 probe

**Date:** 2026-10-12. **Status:** done for the one phone below. Run by the owner tapping, with
Claude reading two logs.

This is the hardware probe that the equipment plan's Task 5 asks for before any NFC product code is
written
([plan](../superpowers/plans/2026-10-04-device-equipment-and-independent-drawers.md), "Task 5: Probe
and enable NFC on intended handhelds"). It answers what the phone, Chrome and the stickers actually
do. It says nothing about any other phone or browser.

## What was run

- **Phone:** OnePlus 13 (model `CPH2653`), Android 16.0.0, Chrome 154.0.8037.126, as the probe
  page reported it through `navigator.userAgentData`.
- **Stickers:** the owner's new metal-backed (on-metal) NFC stickers. Android classes them as
  `Mifare Ultralight`, protocol `T2T` (an NTAG-type chip), serial `04:e2:23:92:df:2a:81`.
- **Card reader:** a SumUp Solo, with a sticker stuck on it.
- **The probe:** a throwaway page, kept beside this note in
  [`2026-10-12-nfc-probe/`](2026-10-12-nfc-probe/). `node server.mjs` serves it on port 8765 and
  appends every event the page sends to `results.jsonl`. `adb reverse tcp:8765 tcp:8765` makes the
  phone's `http://localhost:8765` reach it, and Chrome treats `localhost` as a secure address, which
  Web NFC requires. The page reads, writes (as a text record, a custom external record
  `waitron.io:equipment`, or a web-address record), locks a sticker, opens the rear camera, and
  starts scanning by itself once the NFC permission is granted. It recognises the same
  `waitron-equipment:<kind>:<uuid>` text as `parseEquipmentCode`
  (`packages/shared/src/equipment-code.ts`). It does not recognise that text inside a web address,
  so a web-address read shows as unrecognised in its log.
- **Two logs, compared tap by tap:** the page's own log, kept as
  [`results-oneplus-13.jsonl`](2026-10-12-nfc-probe/results-oneplus-13.jsonl) (times in UTC), and
  the phone's system log (`adb logcat -v time`, times in CEST, UTC+2). Each tag the phone's NFC
  chip notices appears there as `NfcService: onRemoteEndpointDiscovered`. The system log was not
  kept: it holds every app's messages.

## Results

| Question | What happened |
| --- | --- |
| Does Chrome offer Web NFC here? | Yes. `"ndefReader":true` and `"makeReadOnly":true` in the page's first `environment` event. |
| Bank card and ID card | Both are `Mifare Desfire`, protocol `T4TA`. Chrome logged `cr_NfcImpl: This tag is not supported.` and the page got `reading-error` events, or no event at all. Neither was ever recognised as ours. |
| Write, then read back | `write-ok` at 16:02:24.930; the next read gave `"recordType":"text"`, `"text":"waitron-equipment:reader:a45f83b1-…"`, recognised as a reader. |
| Repeated taps, bare sticker | 10 of 10 read, 16:07:46 to 16:08:05, matching 10 `onRemoteEndpointDiscovered` lines. Two taps were found late by the phone's chip (gaps of 4.3 s and 3.8 s). Each read reached the page about 0.12 s after the chip noticed the sticker. |
| Repeated taps, sticker on the Solo | 10 of 10 read, 16:13:21 to 16:13:38, gaps 1.4 s to 3.2 s, again matching the chip's 10. A plain (not metal-backed) sticker was not tried on the Solo. |
| Quick or glancing taps | Lost without any event to the page. The chip logged `T2T timeout` or `reSelect: waiting for Card to be activated`, then `Tag lost`. Seen at 18:06:45, 18:14:58 and 18:15:03 CEST. |
| Permission remembered | After the first grant, every reload logged `"nfcPermission":"granted"` and `"trigger":"auto-on-load"`, in a Chrome tab and in the installed app. |
| Lock the phone, or switch apps, then come back | Reads resumed with no button pressed: 16:14:46 after unlocking and 16:15:02 after returning from another app. |
| A sticker tapped while the page is **not** scanning | Android opened its own tag viewer over Chrome (`START … com.android.nfc/.NfcRootActivity`, then `com.android.apps.tag/.TagViewer`, 18:02:25 CEST). |
| A sticker tapped while the page **is** scanning | The page got it, and Android's viewer never opened. The system log holds 25 `NfcRootActivity` starts; matched against the page log, each came while no probe page was in front. One page's events were logged out of order as it went to the background (`jqqtpm`, 16:19:51), and it is counted as not in front. |
| Tapped from the home screen: text record | Android's tag viewer opened (owner's note, 16:17:50). |
| Tapped from the home screen: custom external record | Android's tag viewer opened (owner's note, 16:18:43). So the custom record is no better than text. |
| Tapped from the home screen: web-address record, Chrome | Android passed the address to Chrome as an ordinary link (`START … act=android.intent.action.VIEW … dat=http://localhost:8765/…`). Chrome opened a **new tab** each time; the new page started scanning by itself and Chrome also handed it the same tap about 0.25 s after it loaded. |
| A tab opened by a sticker closing itself | `window.close()` closed it, 4 of 4, and Chrome went back to the tab before. Each logged `close-attempt` and none logged `close-did-not-close`. |
| Handing the tapped id to an already-open tab | A `BroadcastChannel` message reached a probe tab that had been in the background for about 17 s and about 60 s (`handoff-received` at 16:53:37 and 16:54:23). |
| Tapped from the home screen: web-address record, installed app | Android asked whether to open the app or Chrome. The app opened even when Chrome was chosen (owner's report). The app **reloaded with the sticker's address**, replacing the page it was showing. `launch_handler: {"client_mode": "focus-existing"}` was in the manifest of the reinstalled app and `launchQueue` existed (`"launchQueue":true`), but the page's `launchQueue` consumer never ran on any launch, and every sticker launch made a new page. |
| Camera open at the same time | The phone stops looking for tags whenever any camera opens: `NfcService: setReaderMode called by camera:disable polling.` Seen for the camera app (18:25:07–18:25:18 CEST), face unlock (18:23:16), and Chrome's own camera on the probe page (18:30:54–18:31:05). |
| Vibration on a read | Yes (owner's report). |
| Locking a sticker | `lock-ok` at 17:04:53. Two later writes failed about 0.03 s after the sticker connected, with no write attempted (`cr_NfcImpl: Cannot write data to NFC tag: null` straight after `doConnect`, 19:05:04.409 CEST). Two writes that failed BEFORE the lock look different in the system log: `T2T timeout. state=WRITE_NDEF` first, meaning the write started and the sticker moved away. The page sees the same `NetworkError … IO error` in both cases. |
| Battery | Not measured. The phone looks for tags with scanning stopped too (it found the sticker at 18:02:25 CEST and opened its own viewer). Scanning does change how it looks: starting a scan logged `setReaderMode: … com.android.chrome, flags: 271` (18:04:18 CEST) and stopping it `flags: 0` then `restoreSavedTech` (18:02:02), Android's reader mode. What that costs in power was not measured. |

## What follows for the product

- **The till scans whenever it is in front**, or a tap brings up Android's tag viewer over it.
- **The QR scanner and NFC cannot run at once on this phone.** Opening the camera stops NFC.
- **A failed tap is silent.** A tap the chip loses never reaches the page, so the till cannot say
  "try again"; it can only show what it last read.
- **Text record, not a web address** (owner, 2026-10-12, after these results). A web-address sticker
  reloads the installed till when the till is not in front, which discards whatever it had on
  screen, and it fixes one address on the sticker that a later move to the cloud would not follow.
  Neither can be avoided on Chrome 154 for Android: `focus-existing` had no effect.
- **The dropdown stays** as the path that always exists, as already decided.

## Not tested

- The box's own `https://waitron.local` address. NFC permission is kept per address, so the first
  grant there needs its own check.
- Any other phone, any other Chrome version, and a plain (not metal-backed) sticker on the Solo.
- Battery, in numbers.
- Whether a page can tell a locked sticker from a failed write. It sees one message for both.
