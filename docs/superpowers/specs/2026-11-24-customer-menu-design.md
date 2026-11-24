# The customer menu: online and printed, from each menu's own tab

Status: approved by the owner in conversation, 2026-11-24, part by part, with the list of the session's
calls put to them. Decisions marked **owner** were made in that session, quoted where the words matter. **My call** marks the session's own
choices, for the owner to check. Statements about today's code come from reading it, except the two
printed layouts and the pop-up, which were looked at on the demo.

It follows the [menu editor](2026-11-24-menu-editor-redesign-design.md) and
[device home page](2026-11-24-device-home-page-design.md) designs. It replaces the three A670 documents
([proposal](2026-11-12-a670-guest-menu-design.md), [online](2026-11-13-a670-online-go-live-study.md),
[print](2026-11-13-a670-printed-template-study.md)) and the 13 November choice of a read-only copy kept
in Cloud.

## Why

The owner, on today's **Guest menu preview** pop-up: it "is a half baked feature that combines a read-only
online menu … with a function to print A4 PDF menus"; "the design is ugly"; "the custom design feature
is almost non-existent"; "it is just wedged in to preview without much thought"; and the sharing switch
"hasn't been thought through properly".

The owner's list of what a menu is for: the till and handhelds (built); printed menus "with customisable
design"; a read-only menu for the restaurant's website, with "photos, search, easy navigation", in the
same style as the printed one, on phones and computers; ordering for delivery and pickup; ordering at
the table by QR; and sending the menu to apps like Glovo. This design covers print and the read-only
menu. The rest get their own designs and build on it.

Found in today's version: set menus and photos never reach the customer; the sharing switch always
shares the default menu, whichever menu is open; the customer's link and QR code are shown nowhere on
the box; section order, page breaks and logo are forgotten after each print; the page-break switches
have no label; the page's heading is the menu's internal name although a menu has a customer name; every
price ends "/ ea"; a dish with no declarations leaves a gap; the A4 pages print on a grey ground and
the two Bistro columns start at different heights.

## Goals

- A manager puts a menu online at an address, or prints it, from that menu, seeing the real menu in the
  real style while deciding.
- What a customer sees is something a restaurant is proud of, without a designer.
- One look online and on paper, reusable by other menus.
- Reprinting the food does not mean reprinting the wines (**owner**).
- The customer's page is the start of the ordering app, not something ordering replaces.

## Non-goals

Ordering of any kind, table QR codes tied to a bill, payments, sending menus to delivery apps, laying out
a page freely, a designer's artwork as a background (**owner**: "for sure they will want to do this, but
let's worry about this later"), two languages on one sheet, a wall screen, and live "sold out" marks on
the read-only page (**my call**: ordering brings them).

## Anti-goals: what would make this a failure even if it worked

- Customers reading the menu slow a till or delay a sale.
- A customer sees an unpublished price, a staff or kitchen name where a customer name exists, or
  anything the menu does not offer.
- A missing allergen icon reads as "free of".
- A printed page breaks somewhere the preview did not show.
- A change to a style changes a menu the manager did not know about.

## Approaches

**Who serves the online menu.** (A) the box, through Cloud's public address, with ordinary caching;
(B) the box with nothing kept in Cloud; (C) the copy published to Cloud, as built. The session first
recommended the copy. **Owner**: "I don't think this should be in the free tier, so paying customers
will already have the connection … it could be served straight from their box", a router restart takes
ordering down too, and "we can provide simple http caching to reduce load on the box". Chosen: the box
serves, Cloud caches. C is removed.

**Where it lives.** A Guest menus page in the sidebar (**owner**: "i don't think we need a separate nav
bar section"); entries in each menu's ⋮; a page per menu; a tab in the menu's editor with the style in a
window (**owner's** proposal, chosen).

**Style.** Set on each department with changes per menu, or named styles each menu picks. A menu belongs
to no department: periods name menus (`menu_periods`), so one menu can serve several departments or
none, and "the department's style" would have two answers or no answer. Chosen: named styles (**owner**:
"I think named styles work"), edited beside the menu rather than on Appearance ("a bit far from the menus
themselves. you'd want to experiment with the fonts, and layout settings in combination with your real
menus").

**Menus inside menus.** A list of customer menus per department, each shown once, was drawn and dropped:
each menu has its own address and shows what is inside it. A wrapper menu gives one page for several.
Print leaves sections out.

**The page's code.** (A) a small customer app; (B) today's script-free page improved; (C) both. Chosen: A
(**owner**).

## The design

### 1. The Customer menu tab

- A fourth tab in the menu's editor: Structure, Device home page, Preview, **Customer menu** (**owner**; the
  name is **my call**, between the owner's Guest and Customer: the product says "customer-facing name"
  and a delivery customer is not a guest). On a phone the tabs scroll (**owner**).
- Two sub-tabs, **Online** and **Print** (**owner**: "i can imagine having a growing number of settings in
  each"), a `wt-segmented-control`. Beside them, **Style**, its name and **Change…**.
- Settings on the left, the real menu on the right. On a phone, **Settings** and **Preview** are two views.
  The preview shows the **published** menu; a menu never published says so, with a link to Preview.
- The fixed Cancel and Save bar, as on the other tabs: everything on the tab waits for Save. Cancel,
  leaving and changing tab ask, through the draft scope; changing sub-tab does not, and one Save covers
  both. A menu's customer settings take effect on Save, not on publishing (**my call**).
- A set menu's page gets the same tab with **Print** only; online it appears inside the menus that sell it.
  It prints the newest published copy any live menu holds; with none, it says no published menu sells it
  (**my call**).
- The permission is the menu editor's, `menu.manage`, styles included (**my call**).
- The Menus list gains an **Online** column: the address, which opens the live page. No Style column
  (**my call**; it was drawn before the tab).
- The **Guest menu preview** button, its pop-up and its words go. "Customers see this menu on your online
  menu" leaves the default menu's explanation (`strings.ts`): the default is only where new departments
  start.

### 2. Online

- **Online** on or off (off for every menu to start), and the **address** after the venue's own host:
  lower-case letters, digits and hyphens, unique among menus. A taken or invalid address is refused under
  its field. Turning it on for an unpublished menu is refused, with a link to Preview.
- **Copy link**, **QR code…** (shows it, prints it, saves it as a picture) and **Embed code…**, a frame for
  the restaurant's own website.
- **Changing an address, or turning it off, stops printed QR codes and links:** Save asks when the menu
  was online at another address (**my call**).
- **Photos**: None, Small, Large. **Allergens** as below. Previewed as **Phone** or **Computer**, in any content
  language.
- The host's root page opens the only online menu, or lists them when there are several (**my call**).
- Off, deleted, or never-published menus answer 404. When a menu is on but customers cannot reach it (the
  box is not connected, or has no plan), the tab says why with the one thing to do, and offers neither
  link nor QR code. **There is no address inside the venue**: a phone that does not trust the box's own
  certificate is stopped by a warning before any page loads. Customers come through the public address,
  wi-fi or not; the manager has the preview (**my call**).

### 3. The customer's page

Phone and computer, from 360 px up (mock 18 for the phone, 16 and 19 for a computer).

- The style's logo, or the menu's customer name; the language choice; **Search dishes**; **Allergies and
  diets**; the top sections as tabs that follow the scroll; then the sections. Sections inside sections
  show as smaller headings.
- A dish: customer name, allergen and diet icons after it, description, price, photo. Names fall back as
  today (`resolveMenuText`), never to the kitchen name. A price names its unit only when that is not
  Each, and a product with variants shows the range, by the device home page design's shared function.
- A dish opens: large photo, description, variants and their prices, its choices, extras and their prices,
  and its allergens and diets written out. Back returns to the same place. Each dish has a link of its own.
- A **set menu** shows as a card where the menu holds it, and opens to its price per person and each line of
  what it includes, headed by its courses, with the choices and their supplements, from the copy
  published with that menu (`PublishedSetMenu`).
- **A course gains a customer-facing name in each content language** (**owner**: "A"), edited on Courses,
  offered to Translate all, carried in an export and published with the set menu. Empty, the staff name
  shows. A line that accepts two courses reads "Dessert or coffee". Bread and drinks are lines like any other.
- Allergens and diets follow the owner's decision of 2026-10-14
  ([A509](../../backlog/till.md#a509-online-ordering-for-collection-at-the-counter)): icons after the
  name, a key on the page, hide dishes with chosen allergens, show only dishes of a chosen diet. Cereal
  and nut kinds are written. Nothing is said to be free of anything; the note that says so stays.
- **The allergen filter is cautious** (**my call**). It hides a dish that declares the allergen; a
  dish with variants, only when every variant does; a dish with a preselected extra that does; and every
  dish whose allergens have not been reviewed. It says how many it hid, how many of those for not being
  reviewed, and to ask staff. A variant or an optional extra that declares it, inside a dish still shown, is
  marked. The diet filter shows only dishes declared for that diet.
- **Staff only** products, and products **not sold separately**, are not listed (**my call**); an extra still
  shows inside the dishes that offer it.
- Allergens and diets are the published menu's, online as on paper (section 8).
- It remembers nothing about the visitor and sets no cookie; the language is in the address. No visitor's
  IP address is logged.
- The shared link carries the menu's name, a photo and the venue's name in the page's head, so a
  messaging app shows them. Search engines may list it (**my call**).
- It must pass axe in every state, in both a light and a dark style, and reach its first dishes on a slow
  phone without waiting for photos.

### 4. Styles

- A style belongs to the venue and has a name: **logo**, **heading font**, **text font**, **page**, **text** and
  **heading** colours, **names** plain or in capitals, **lines** between dishes or none, and whether prices on
  paper show the currency (off to start; the lane checks the rule on price lists in the country pack's
  law first, and keeps it on if the law wants it) (**my call**).
- One style is the default, made at setup from the theme's logo, brand colour and typeface. A menu that has
  never chosen one uses the default. A menu inside another takes the outer menu's style.
- **Change…** opens a window over the tab: the list of styles with their colours and which menus use them,
  the chosen one's settings, and its own live preview of this menu, phone, computer or paper.
  - Choosing a style is the tab's change, held until the tab's Save.
  - Changing a style's settings is saved in the window: **Save style**, which names the other menus it
    changes, or **Save as new style…**, which asks its name and uses it here. It takes effect at once. In
    a style no other menu uses, only Save style shows as the main button.
  - **Rename…**, **Make default** and **Delete…** are in the window. A style in use, or the default, cannot
    be deleted; the refusal names the menus.
- A colour pair too close to read is warned about, as the theme editor does (`warnings.ts`), and does
  not stop saving.
- **Fonts**: a small built-in set with Latin letters and accents for every content language, shipped with
  their licences in `/app/third-party/`, and **uploaded fonts** (**owner**: "custom fonts"). Uploads settle
  the open questions of the theme backlog entry
  ([uploaded fonts](../../backlog/till.md#uploaded-font-files-for-themes-owner-2026-10-20-a841-q7-b--after-a841))
  once, for both: where the files live, formats, size, the licence line, and drawing in a preview. The
  theme's own use of them stays that entry.
- Styles and each menu's customer settings travel in a configuration export, except Online and the
  address, which start off in the new venue (**my call**, as sharing does today).

### 5. Print

- **Layouts**: One column; Two columns; Side panel, whose sections the manager ticks; Card, for a set menu or
  a short menu; Price list, one price column per variant name, such as Glass and Bottle. Each in every
  style.
- **Paper** A4, A3 or A5; **portrait or landscape** (**owner** corrected the words); **photos** None, Small or
  Large, its own choice, None to start; **allergens** as icons with a written key at the end, or words beside
  each dish; **page colour** the style's or white, since most printers leave a white border.
- **Sections**: which to print, in which order, with **New page** before any of them. An included menu is one
  row. All of it is remembered for the menu; a section added later prints at the end, a removed one is
  dropped.
- Language is chosen at printing, one per sheet, and not remembered.
- The preview draws the real pages and says how many. **Print or save as PDF** uses the browser's print
  window, from the published menu.
- A heading stays with its first dish; a dish's name, price and declarations stay together.
- **This piece starts with a trial** that the previewed pages are the printed pages, for the five layouts, in
  Chrome, Safari and Firefox on real long menus. If they cannot be made to match, bring the owner what
  can be before building the rest.

### 6. Serving it, and protecting the till

- The customer app is a browser package beside the till and dashboard, sharing their components and
  tokens where they fit, with its own theme root: the style, not the venue's Theme.
- The box serves customers on a listener of its own, separate from the staff one, that reaches an allowlist
  of read-only paths, and only while the box is the serving one; a mirror or fenced box serves nothing.
  Today's tunnel reaches only the staff listener (`deploy/tunnel/peer.sh`), so the path is new on both
  sides (piece 6).
- The tab's preview goes through the signed-in dashboard, not that listener, and works when the dashboard
  is opened remotely: the app's files, photos and fonts are admitted on the staff listener's list.
- What a page needs is prepared once per language and kept in memory, rebuilt when anything it draws changes
  (publication, languages, style). Reads take no write lock: today's photo route does
  (`packages/media/src/routes.ts`), so customers' photos need a read that does not. The box limits total
  requests and work in progress; past it a customer gets "try again shortly". Behind the tunnel every
  visitor looks the same to the box, so per-visitor limits are Cloud's. A test with a busy till shows a
  sale's time is unchanged under a flood.
- **Caching**: photos, fonts and app files for a year, under names that change with them (photos already do,
  `packages/media/src/routes.ts`); the page and the menu about one minute, so a publication or a switched-off
  menu shows within that (**my call**: the minute).
- Only a photo the published menu uses is reachable, never the whole image library.
- The read-only pages may be framed by any site; pages that order may not be, when they come.

### 7. Cloud (in waitron-cloud, its own plan)

- The venue's public name already exists in Cloud's design (assigned, or the venue's own domain with one
  record), with HTTPS ending at the gateway. **Its gate today carries one path** (`/public/availability`),
  after a script challenge with a cookie, forbids framing, sends no-store and caps a reply at 64 KB, and
  nothing finds the serving box after a takeover. This needs: the customer paths, following a takeover,
  caching as the box's headers say, replies the size of a photo, HEAD for link previews, framing allowed
  on read-only pages, and a plain **try again shortly** page when the box does not answer.
- Connected or Hosted, trial included, as the guest menu is today.
- Request limits per visitor, and the challenge: it must not stop embedding, link previews or the first page
  in normal use; whether it may appear under attack is settled in that plan.
- Customers' traffic is measured apart from the venue's own remote access, and does not count as "really
  used" when deciding whether to extend a trial (**my call**): strangers reading a menu are not the venue
  trying the service.
- The hosted copy goes: its storage, its listener and `/m/<venue>`, the portal's takedown, the plan check on
  publishing, and the three signed actions (`guest-menu-publish`, `-status`, `-withdraw`,
  `packages/contract`). Waitron stops sending first. A way for Waitron's staff to block a venue's public
  pages is kept or replaced in that plan (**my call**).

### 8. Allergens and diets are published

The owner, on allergen corrections reaching customers without publishing: "ingredients may change, so i
think allergens should be published like anything else. they could always be patched if needed". Told that
this reverses their 27 October decision (A1150: the live product on every screen, built in #3389 and #3394)
and reaches the till and the kitchen, the owner chose **published everywhere, with a safeguard**.

- Allergens, diet labels and an extra's own labels are frozen in the published menu again, compared and
  listed as changes on Preview, and scheduled with the rest. The till's menu, product info and filters,
  the basket and held dishes, the customer page and print read the published menu. Sent dishes keep what
  they said when first sent, as now (A1517).
- **Kitchen screens, kitchen tickets and the allergy check read the same source as the till**, so no two
  screens disagree, which is what A1150 was for. For a dish already sent they keep reading what is live
  now: that is the menu's published version today, so a patched correction reaches a dish not yet cooked.
  A dish no longer on that version uses what it was ordered with (**my call**: both).
- **Patch live menu** gains allergens and diets for a dish, a variant and an extra.
- **The safeguard**: saving a product whose allergens or diets changed, when a live menu holds it, asks
  "Update the live menus now?", naming them. Yes patches those fields on each, all or nothing. No leaves
  it waiting as an unpublished change on each. It is asked after the product is saved, and a patch that
  fails leaves the product saved and says which menus were not updated (**my call**: how it is asked).
  An import, or a change to many products at once, does not ask; its result names the menus waiting
  (**my call**).
- A menu with such a change waiting says so plainly among Preview's warnings (**my call**).
- The lane writes a short design of its own first, from
  [A1150's table of readers](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/specs/2026-11-15-a1150-live-product-declarations-design.md),
  saying for each what it reads now and after. Full review path: someone can be harmed by a wrong answer.

### 9. Guide and design contract

The English and Spanish Products guide sections on checking a menu as a guest, sharing it and printing it
are rewritten as one, with the screens. `docs/developers/design-system.md` and
`docs/developers/products.md` describe the tab and the customer's page. The staff guide says "customer
menu", diners at a table stay "guests" on the till.

## Delivery

Each piece is usable without the next.

1. **Remove today's version**: the pop-up and its widgets, `guest-menu-page.ts` and its API, `/public/menu`, the
   settings document, the sending of copies to Cloud. The translated words
   (`packages/shared/src/i18n/guest-menu.ts`) stay for piece 3, and `publicGuestMenu` as a text helper: it
   carries no photos or ids and drops set menus. Dropping the settings document needs no table change. The
   remaining A670 rehearsals are dropped.
2. **Allergens and diets are published** (section 8). The document format changes: **a venue reset**. It stands
   alone and can land first.
3. **The customer app and the tab's Online sub-tab**, in one built-in style: on and off, the address, the
   preview on phone and computer. Nobody outside can open it until piece 6; the tab says so. First the
   published document gains the menu's customer name and the set-menu courses' names, and set-menu dishes get
   their allergens, which are filled in only for ordinary dishes today (`packages/menu/src/menu-document.ts`;
   with piece 2 they are frozen with the rest): **a venue reset**, said in that PR's first line. After the menu
   editor's Structure piece, whose bar and save it follows, and the device home page design's piece 1,
   which makes the shared price function. The lane splits it.
4. **Styles**, with the built-in fonts. Schema: a venue reset.
5. **Print**, after the trial.
6. **Reaching customers**: a short joint design in both repositories first, then the box's listener and tunnel
   path (Waitron), the gate (waitron-cloud), and the two qualified together. Full review path: an
   unauthenticated surface. The design can start with piece 3. Production follows remote access's own
   gates; the tunnel does not start in production today.
7. **Uploaded fonts**, last, since nothing depends on them.

Screenshots for the owner before landing each of 3 to 5 and 7: 1440, 1280 and 390 px, English and Spanish, with
the dashboard light and dark, a light and a dark style, with and without photos, and for print the saved
PDFs of every layout.

Not built here and to be designed on their own, in this order (**my call**, shown to the owner): table
ordering (A508), pickup (A509), delivery (A1012, as a department of its own with its own periods, hours
and menu: **owner**), and sending menus to delivery apps (joins A1513).

waitron-cloud's `docs/backlog/guest-menu.md` still records the 13 November direction; its update travels with
piece 6's hand-off.

## Left to the builder

Where settings and styles are stored, the app's framework within the house stack, how drafts reach the
preview, the built-in fonts and their number, exact limits and file sizes, the wording, and the Spanish
names ("Carta para clientes" was suggested for the tab; it must suit the scrolling tabs at 390 px).

## Pictures

Not committed. On the owner's machine, in the main checkout: `.impeccable/shots/guest-menu-mock-18.png` (the
customer's phone), `-19.png` (the tab, the style window, a phone; before sub-tabs) and `-20.png` (Print and
the five layouts; its preview lacks allergen icons and ignores the ticked new page). Drawn, not
screenshots: where they differ from a shared `wt-*` component, the component wins. Links, descriptions,
extras, wines and allergens in them are invented, and fonts are stand-ins.
