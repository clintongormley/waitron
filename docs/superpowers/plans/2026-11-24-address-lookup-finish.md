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
| ADDRESS-TRIAL | Cloud, lane J | Real Google on the Amazon test Cloud for the test box, and about 40 real-looking public addresses (restaurants, shops, flats, rural, Canaries, Ceuta, with and without a postcode) tried through the box's signed route. Report: how many fill every field right, what is wrong with the rest, calls and billed type per address. Fix the mapping faults it finds, such as the missing street lines. |
| ADDRESS-SERVICE | Cloud, lane J, after ADDRESS-TRIAL | The route as a normal service: any connected box in good standing, the two caps, a stop switch, Google's key from the same place Cloud keeps its other keys. The trial's one-box list and its counted-abandonment exception go: every call counts, as "Keeping it from being abused" says. Off in production until the owner turns it on. Privacy notice, processor list and subprocessor wording name Google. |
| ADDRESS-BOX | Waitron, lane E | The box asks Cloud with its own signed connection: one server function, a dashboard route and a till route (each needs the form's own permission). The dashboard's two forms get the supplier. Hidden when the box is not connected or Cloud says unavailable. The dashboard recognises a province by its other official names (A1171's second point). |
| ADDRESS-TILL | Waitron, lane E, after ADDRESS-BOX | The till's full-invoice window gets the supplier. |
| ADDRESS-WORDS | Waitron, lane E, with ADDRESS-TILL | Google's name on all four forms; the guide lines and the privacy notices A1171 lists (`table-service.md`, `data-protection.md`, `invoice-email-notice.ts`, EN and ES), since Google then receives what is typed into the search. |
| ADDRESS-PROOF | Lanes J and E together | On the test box against the Amazon test Cloud: all four forms, EN and ES, with the search on, off, over its cap and with Cloud unreachable. |

ADDRESS-TRIAL and ADDRESS-BOX start side by side: the signed request and reply already exist
(Cloud's `docs/address-lookup-trial.md`), so neither waits for the other. Any change the trial forces in
that request is agreed in both lanes' questions files first.

## Keeping it from being abused

Owner, 24 November 2026: "Could anybody abuse our service the way we set it up? Potentially?" Read in
Cloud's code that day (`packages/account-http/src/address-lookup.ts`,
`packages/registration/src/billing-allowances.ts`); nothing was run.

What already holds: Google's key stays on Cloud; a request must be signed by a registered box whose
owner has a confirmed email; a revoked or replaced box is refused; a free account is counted per
account, so more venues give it no more; a box is limited to 30 requests a minute.

What ADDRESS-SERVICE adds, the watcher's choices:

1. **Every call to Google counts.** The trial counts a lookup once it starts, chosen or not, with up
   to eight searches in it. An earlier draft of this plan would have counted only a chosen address,
   which leaves searches uncounted. Instead a chosen address counts as one, and searches have their
   own limit of five for each address of the venue's limit; Cloud's total counts both at Google's prices.
2. **Free accounts get less, and share a part.** An account is free to open, so a person could open
   many: 20 addresses a month each instead of 100, and all free accounts together at most a third of
   Cloud's total. A venue on a trial with no payment card counts as free: today a trial venue has a
   limit of its own. Invented accounts can then use up that third, never what paying venues need.
3. **The total is also a daily one**: at most a tenth of the month's total in a day, so a bad day costs
   a day of suggestions, not the month.
4. **No single slot.** Today one lookup runs at a time for all of Cloud and any other is refused; one
   busy box would turn the others away. That slot was the private trial's own, not Google's. Lookups
   run side by side, limited only by requests a minute per box, network and account.
5. **Turn one venue off** from the operator screen, and tell the operator once when a venue or the
   total reaches its limit.
6. **Google's side:** the key works only from Cloud's own server address and only for the two
   services, and Google's daily caps stay as the last stop.

What is left: someone with a free account can get 20 Spanish addresses checked a month for another
use, and people filling a real form may have to type an address for a day. No money passes the total.

## The owner's part

- **How many:** 100 chosen addresses a month for each paying venue, and a total for Cloud that cannot
  cost over about EUR 10 a month (owner, 24 November: "yes"), shared as the section above says. Both
  are settings.
- **Geoapify:** left out (owner, 24 November: "agree"). When Google fails people type the address.
- **Before 14 January 2027**, when Google's trial ends: upgrade the billing account, then set a daily
  cap on each of the two services and a EUR 10 budget alert before anything else uses the key.
- **Turning it on in production**, when there is a production Cloud.
