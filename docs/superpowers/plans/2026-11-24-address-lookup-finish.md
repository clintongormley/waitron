# Address suggestions: what is left, and who builds it

Owner, 24 November 2026: "we need to pick this up again and get it finished. come up with a plan and
queue everything that needs doing". Written by the watcher. The order of the pieces is the watcher's
call; the owner's answers are still wanted where the last section says so.

## What works today

- The search box (`wt-address-lookup`) is on all four address forms: the setup wizard's venue page,
  the dashboard's Venue card, the registered-address window and the till's full-invoice window
  (A1171, #2191, #2227). It stays hidden until the form is handed a supplier.
- Setup hands it one when the person has signed in to Waitron Cloud there
  (`apps/setup/src/api/cloud-address-provider.ts`). The dashboard and the till hand it none.
- Cloud has a signed route for a registered box (`packages/account-http/src/address-lookup.ts`) with
  ten workflows a month per account and twenty attempts a day. It is off unless a stack injects a
  supplier, and the real Google one is allowed for a single private box.
- Real Google has answered one whole search (7 November): one suggestion, with no street lines.
  The October comparison of 60 residential addresses found a complete draft for 48 with Google, 36
  with Geoapify's autocomplete and 40 with its geocoder.

## Decisions this plan makes

1. **Saving the form is the confirmation.** Google's terms let Waitron keep an address the person
   confirmed or corrected. Every field is shown and editable before Save, so no second confirm
   window and no confirm call to Cloud. This replaces the 16 October Cloud design's confirm request,
   its one-use codes and its approval screen; what to ask a specialist about it goes on their list,
   and nothing waits for that (owner, 24 November: best guess first).
2. **An address typed by hand always works**, with or without Cloud, and nothing waits on the search.
3. **Cloud keeps no query, address or reply.** It keeps counts.
4. **Google's name** is shown beside the list, and beside the filled fields until the person saves or
   changes them.
5. **Costs are capped twice:** a monthly number per venue, and one total for all of Cloud that can
   never be passed whatever the venues do. Past either, the search is hidden and people type.
6. **Bill it the cheap way.** Google's list on 24 November 2026: Address Validation Pro, 5,000 free a
   month then USD 17 per 1,000; Validation Enterprise, 1,000 free then USD 25; Autocomplete, 10,000
   free then USD 2.83. Today's client passes a session token to both calls, which Google's session
   pages bill as Enterprise. The Cloud lane confirms that on the bill of the trial and drops the token if calling without it
   bills as Pro. For 100 venues at 30 addresses a month that is about USD 6 instead of about USD 50
   (assuming four autocomplete calls an address).
7. **Not built:** a map, an address database, a cache, showing balances in the Cloud account, anything
   outside Spain.

## Pieces

| Piece | Where | What it delivers |
| --- | --- | --- |
| ADDRESS-TRIAL | Cloud, lane G | Real Google on the Amazon test Cloud for the test box, and about 40 real-looking public addresses (restaurants, shops, flats, rural, Canaries, Ceuta, with and without a postcode) tried through the box's signed route. Report: how many fill every field right, what is wrong with the rest, calls and billed type per address. Fix the mapping faults it finds, such as the missing street lines. |
| ADDRESS-SERVICE | Cloud, lane G, after ADDRESS-TRIAL | The route as a normal service: any connected box in good standing, the two caps, a stop switch, Google's key from the same place Cloud keeps its other keys. The trial's one-box list and its counted-abandonment exception go: only a chosen address counts. Off in production until the owner turns it on. Privacy notice, processor list and subprocessor wording name Google. |
| ADDRESS-BOX | Waitron, lane E | The box asks Cloud with its own signed connection: one server function, a dashboard route and a till route (each needs the form's own permission). The dashboard's two forms get the supplier. Hidden when the box is not connected or Cloud says unavailable. The dashboard recognises a province by its other official names (A1171's second point). |
| ADDRESS-TILL | Waitron, lane E, after ADDRESS-BOX | The till's full-invoice window gets the supplier. |
| ADDRESS-WORDS | Waitron, lane E, with ADDRESS-TILL | Google's name on all four forms; the guide lines and the privacy notices A1171 lists (`table-service.md`, `data-protection.md`, `invoice-email-notice.ts`, EN and ES), since Google then receives what is typed into the search. |
| ADDRESS-PROOF | Lanes G and E together | On the test box against the Amazon test Cloud: all four forms, EN and ES, with the search on, off, over its cap and with Cloud unreachable. |
| ADDRESS-FALLBACK | not queued | Geoapify when Google fails. Waits for the owner's answer below. |

ADDRESS-TRIAL and ADDRESS-BOX start side by side: the signed request and reply already exist
(Cloud's `docs/address-lookup-trial.md`), so neither waits for the other. Any change the trial forces in
that request is agreed in both lanes' questions files first.

## The owner's part

- **How many per venue:** 100 chosen addresses a month, and a total for Cloud that cannot cost over
  about EUR 10 a month (the watcher's numbers, for the owner to change). ADDRESS-SERVICE builds them as
  settings.
- **Geoapify:** the owner preferred Google with Geoapify behind it (October). The watcher now
  recommends leaving it out: when Google fails people type the address, which must work anyway, and
  it was the weaker of the two. Not queued until answered.
- **Before 14 January 2027**, when Google's trial ends: upgrade the billing account, then set a daily
  cap on each of the two services and a EUR 10 budget alert before anything else uses the key.
- **Turning it on in production**, when there is a production Cloud.
