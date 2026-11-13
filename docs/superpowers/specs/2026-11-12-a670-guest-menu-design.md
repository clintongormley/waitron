# A670: designed guest menus

**13 November update:** the owner's 12 November 20:45 answer supersedes the paper-first
recommendation and online-with-ordering sequence below. Read the
[read-only online go-live study](2026-11-13-a670-online-go-live-study.md) and
[printed-template comparison](2026-11-13-a670-printed-template-study.md) first. The PDF method
question waits for the template choice. This document retains the earlier proposal and vocabulary;
it is not a cleared build plan.

**Proposal, 12 November 2026.** The owner requested a design, not these recommendations or a build.
Authority: Lane D `~/waitron-campaign-d/questions.md`, 12:14 relay: “these menus are mixing
concerns”, “why not just translate it now”, and “yes” to design first. The stopped
[plan](../plans/2026-11-12-a670-printable-guest-menu.md) remains historical. Keep this off main
until the owner sees it. Claude reads the design first; local mock-ups then accompany its presentation.

## Two products, one identity

You design a **printed menu**, downloaded as an A4 PDF to print yourself or send to a printer,
and an **online ordering menu**, used at a table or from outside. Counter collection is the proposed first outside flow (A509); delivery (A1012) remains an explicit later choice.
They share venue identity and dish content, with separate presentation settings.

Offer compact text and photo-led presets: venue display name, logo, optional cover,
section headings, image visibility/crop, spacing, font size, curated
typeface pair, and background/text/accent colours with readable contrast. Paper offers one/two
columns; screens adapt from phone list to desktop grid. Reuse dish images; choose/upload logo
and cover through the media library. Bundle curated fonts. Keep guest settings separate from
dashboard appearance, using declared `--wt-*` tokens and an independent theme root
([design system](../../developers/design-system.md)).

Preview paper, phone and desktop independently of dashboard theme. Paper captures one published
version and language. Keep headings with their first dish and each item's name, price and
declarations together; reserve key space, adding a final page if needed. Allow section page breaks.
Recommend HTML/CSS rendered by the manager’s browser, then **Print / Save as PDF**. This avoids
putting a headless browser on the box or building a separate PDF layout engine. It requires the
browser’s print dialog, rather than a one-click PDF download; ask the owner to accept that first
cut below. The full ask still includes downloadable PDF. Native PDF generation or a hosted print
service needs a later design if one-click download is required. PDF/X, bleed and press colour
management stay outside this proposal.

Table ordering needs menu, dish choices, basket, submission and status, alongside A508's
waiter/bill/payment actions. Collection needs collection choices, basket, checkout and pickup status.
Tab credentials, guest permissions, payment providers/timing and fiscal recording remain undecided.
[A508/A509](../../backlog/till.md#a508-a-tables-qr-code-order-call-a-waiter-ask-for-the-bill-or-pay),
[payment decisions](../../backlog/payments.md#a-guest-paying-from-their-own-phone) and
[A951's current successor](../../backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)
still govern that work. A951-S staff access does not supply a customer entrance.

## Content and declarations

Reuse `packages/catalogue/src/menu-publication.ts#readLiveMenu` and published `MenuDocument`
(`packages/shared/src/menu-document/menu-document-types.ts`). Preserve section order/direct
inclusions. Use `customerName`, descriptions, published dish/variant prices and pricing units;
price extras separately. Reuse
`customer-menu-presentation.ts#resolveMenuText` and `product-presentation.ts` in that shared
directory. Dish, variant and extra declarations stay distinct (`menu-types.ts#OfferedExtraItem`).
References describe source inspection, not runtime verification.

Default to inline allergen and dietary icons after dish names, reusing
`packages/ui/src/nutrition-icons.ts`, which already has the six dietary symbols. Paper's written key
names the used icons once, at the end of the **last page**, in separate allergen and dietary groups.
The 12:14 watcher relay quotes the owner: “often the key will be at the end of the last page,
not on every page. but again, a choice”. This updates October’s per-page-key direction as a
proposal for this presentation. Offer a key on each page for that page’s used icons, or inline words. Other paper pages carry a
short “Allergen key on page N” footer. This follows the latest requested default while
acknowledging the words-with-symbols constraint recorded in A670’s backlog; it is not a legal
compliance conclusion. Online, labelled icon buttons open on click, Enter or Space, with accessible
names and a dismissible explanation; focus alone opens nothing. Cereal/nut kinds stay written per item,
even in icon mode, so a generic cereal/nut symbol does not hide which ingredient was declared:
wheat/walnuts, Catalan **blat/nous**, Galician **trigo/noces**.

Use published `dietaryDeclarations` for dietary marks. Show the most specific declared mark:
vegan suppresses vegetarian/no-meat/no-fish; vegetarian suppresses no-meat/no-fish. Independent
halal/kosher declarations remain. This guest-only recommendation goes to the owner as question 6;
it does not change the editor’s October decision to show implied diets.
Dietary marks represent positive declarations, not allergen absence. An absent icon says nothing
about safety; unreviewed and reviewed-empty information never become “allergen-free”. Preserve
A509's proposed allergen/diet filters in the later interactive work, without promising safe dishes.
Keep October’s decision against per-dish “Not reviewed” labels. Both unreviewed and reviewed-empty
dishes have no allergen icon; one key note explains that icons show declarations and guests should
tell staff about allergies. This does not claim the two stored states are equivalent.

## Languages added to this spec now

Offer every enabled venue **content language**, independently of staff app locales. Translate guest
controls, keys and explanations too, extending beyond current dashboard EN/ES tables. Missing dish
text follows `resolveMenuText`: requested language, venue default, then staff name where supplied;
descriptions can remain empty. Never infer a recipe or translate its ingredients from its name.
Keep guest standard wording in one future browser-safe translation file,
`packages/shared/src/i18n/guest-menu.ts`, reused by print and online renderers; do not add another
copy to each app. If a requested content language lacks standard wording, use the whole guest
wording bundle in the venue default when available, otherwise English, and name that language
beside the key. Dish text still uses its content-language fallback. CA covers Valencian with the
standard-wording override **Cereals que continguen gluten**; other terms here are shared, while
venue dish names preserve their own `ca-ES-valencia` text. This override is editorial, not a
verbatim Annex II quotation.

Complete short labels follow ACSA (CA) and SERGAS Annex V (GL), except **Froitos de casca**,
an editorial normalization of its printed “Froitos de cascara”. The older guide supplies vocabulary,
not current legal advice or every legal exception.

| Code | Catalan (CA) | Galician (GL) |
| --- | --- | --- |
| gluten | Cereals que continguin gluten | Cereais que conteñan glute |
| crustaceans | Crustacis | Crustáceos |
| eggs | Ous | Ovos |
| fish | Peix | Peixe |
| peanuts | Cacauets | Cacahuetes |
| soybeans | Soja | Soia |
| milk | Llet | Leite |
| nuts | Fruita seca de clofolla | Froitos de casca |
| celery | Api | Apio |
| mustard | Mostassa | Mostaza |
| sesame | Grans de sèsam | Grans de sésamo |
| sulphites | Anhídrid sulfurós i sulfits | Dióxido de xofre e sulfitos |
| lupin | Tramussos | Altramuces |
| molluscs | Mol·luscs | Moluscos |

Dietary labels are editorial UI translations, **not Annex II terms**. Official usage supports
vegan/vegetarian stems and GL halal/kosher. Masculine agreement with *plat/prato*, CA transliterations
and “without” labels are editorial choices.

| Declaration | CA | GL |
| --- | --- | --- |
| vegan | Vegà | Vegano |
| vegetarian | Vegetarià | Vexetariano |
| halal | Halal | Halal |
| kosher | Kosher | Kosher |
| no_meat | Sense carn | Sen carne |
| no_fish | Sense peix | Sen peixe |

The same sources supply the specific cereal/nut names. These short display forms follow their
lists; compound labels and modern spelling are editorial adaptations, not verbatim legislation.
The mock-ups exercise wheat and walnuts, not only generic categories.

| Kind | CA | GL |
| --- | --- | --- |
| wheat | Blat | Trigo |
| rye | Sègol | Centeo |
| barley | Ordi | Cebada |
| oats | Civada | Avea |
| spelt | Espelta | Espelta |
| kamut | Blat khorasan | Trigo khorasan |
| almonds | Ametlles | Améndoas |
| hazelnuts | Avellanes | Abelás |
| walnuts | Nous | Noces |
| cashews | Anacards | Anacardios |
| pecans | Pacanes | Pacanas |
| brazil_nuts | Nous del Brasil | Castañas de Pará |
| pistachios | Festucs | Pistachos |
| macadamia | Nous de macadàmia | Noces de macadamia |

### Vocabulary provenance

Checked 12 November 2026. Quotes are short source excerpts; interpretations describe their use here.

| Source | Exact excerpt | Interpretation |
| --- | --- | --- |
| [ACSA, Informació sobre al·lèrgens](https://acsa.gencat.cat/ca/seguretat_alimentaria/seguretat_alimentaria_per_temes/etiquetatge_dels_aliments/informacio_sobre_al_lergens/) | “Llet i derivats (inclosa la lactosa)” | Official CA list explicitly names Annex II; source for the 14 shortened labels and cereal/nut kinds. |
| [SERGAS, Guía de indicacións obrigatorias, Annex V, p. 16](https://www.sergas.gal/gal/documentacionTecnica/docs/SaudePublica/Alimentos/Guia%20de%20indicacions%20obrigatorias%20no%20etiquetado%20dos%20produtos%20alimenticios.pdf) | “Cereais que conteñan glute”; “Froitos de cascara” | Official older GL vocabulary list. The 14 groups checked against Annex V and the driver's local `receipts/a670-design/gl-sergas.txt`; nuts normalization disclosed above. |
| [Canal Salut, Alimentació saludable a l'escola](https://canalsalut.gencat.cat/ca/vida-saludable/alimentacio/saludable/escola/index.html) | “menú vegetarià o vegà” | CA dietary stems, not allergen terminology. |
| [Xunta, Proxecto CHEF: Cociña vexetariana e sen glute](https://recursos.edu.xunta.gal/sites/default/files/recurso/1525338193/Proxecto_CHEF_2017/cocia_vexetariana_e_sen_glute.html) | “vexetariano”; “vegano” | Official educational usage supports GL dietary stems; agreement remains editorial. |
| [Xunta GALP, Diversificación Bombóns de Mar](https://galp.xunta.gal/a-marina-ortegal/diversificacion-bombons-de-mar) | “certificación de calidade halal e kosher” | Official GL usage supports those spellings only; this spec makes no certification claim for dishes. |

## Proposed first phase and remaining size

Recommend shared styling and paper output as the first usable stage: approximately
**700–1,100 production lines and 350–650 test lines**, split into proportionate build PRs after
the owner chooses the route. Re-estimate if direct PDF download is required. Build the online
renderer with the customer entrance and ordering, not as a separate locally-only product.
The online studies are design evidence, not a promised usable first release.

Reuse `packages/media/src/routes.ts`, `packages/media/src/presentation.ts` and
`packages/media/src/renditions.ts` for images. Check publication fidelity, separate extras,
language fallback, escaping, icon accessibility and long-menu pagination; inspect actual saved
PDFs and phone/desktop output. No tests ran for this spec. The paper stage does not complete
A508/A509 or provide any ordering.

Estimate later table ordering at **8–15 engineering days**, collection at **8–15**, after decisions;
shared work may overlap. Exclude customer hosting/payment integration. Credential lifetime,
staff acceptance/notifications, collection timing/pausing, readiness identification,
payment timing/provider and fiscal recording
need their own design before a reliable commitment. CSS theme upload comes later under a separate
design for styling boundaries, assets and preview compatibility; no arbitrary code in the first cut.

After Claude's read, show the owner local A4 and online 390/1280 mock-ups in EN/ES plus
Catalan, including a multipage last-page key. Keep them outside git. Names/prices come from the
published demo snapshot; Catalan names come from `packages/country-es/src/demo/menu.ts`. Any
added allergen/diet markers are explicitly illustrative, not verified recipes.

## Owner questions

1. Start with settings/presets and defer CSS theme upload? Recommend yes: compact text and photo-led
   examples make layout, colours, fonts and imagery editable immediately.
2. Deliver styled paper output first, then the online menu with ordering? Recommend yes; do not
   build an online result guests cannot reach. Retain table/outside ordering in the full scope.
3. Follow the 12:14 last-page-key preference, changing October’s per-page default while retaining
   that option and inline words? Recommend yes, with cereal/nut kinds written beside each item.

4. Accept browser Print / Save as PDF for the first cut, or require one-click PDF download now?
   Recommend browser Save as PDF first; you can send that file to your printer, with a print dialog.
5. Start outside ordering with counter collection (A509), then delivery (A1012)? Recommend yes;
   this is a proposed sequence, not an interpretation that removes delivery from your request.

6. Show only the most specific guest dietary marks? Recommend one Vegan mark instead of Vegan,
   Vegetarian, No meat and No fish together. The editor still shows implied diets as decided in October.

## Draft guest wording

These are editorial translations, not statutory quotations. `{n}` is the last-page number.
Beside an icon, the short kind is “Wheat”. The activated explanation and inline-words mode use
“Cereals containing gluten (Wheat)”, with both names localized. The key names the general category.

| Use | English | Español | Català | Galego |
| --- | --- | --- | --- | --- |
| Menu | Menu | Carta | Carta | Carta |
| Language | Language | Idioma | Idioma | Idioma |
| Context | At your table | En tu mesa | A la teva taula | Na túa mesa |
| Outside context | Collection | Recogida | Recollida | Recollida |
| Basket | View basket | Ver pedido | Veure comanda | Ver pedido |
| Add | Add | Añadir | Afegir | Engadir |
| Close explanation | Close | Cerrar | Tancar | Pechar |
| Explanation | Allergen and dietary information | Información sobre alérgenos y dietas | Informació sobre al·lèrgens i dietes | Información sobre alérxenos e dietas |
| Key heading | Allergen key | Leyenda de alérgenos | Llegenda d’al·lèrgens | Lenda de alérxenos |
| Diet heading | Dietary declarations | Declaraciones dietéticas | Declaracions dietètiques | Declaracións dietéticas |
| Page footer | Allergen key on page {n} | Leyenda de alérgenos en la página {n} | Llegenda d’al·lèrgens a la pàgina {n} | Lenda de alérxenos na páxina {n} |
| Key language | Key in English | Leyenda en español | Llegenda en català | Lenda en galego |
| Common note | Icons show declared allergens. No icon does not mean allergen-free. Tell staff about allergies. | Los iconos muestran los alérgenos declarados. La ausencia de iconos no significa que no haya alérgenos. Informa al personal de tus alergias. | Les icones mostren els al·lèrgens declarats. L’absència d’icones no vol dir que no hi hagi al·lèrgens. Informa el personal de les teves al·lèrgies. | As iconas mostran os alérxenos declarados. A ausencia de iconas non significa que non haxa alérxenos. Informa o persoal das túas alerxias. |

Valencian shares this draft wording, with editorial **A la teua taula**, **no hi haja** and
**les teues al·lèrgies** in the affected entries. Guest ordering/status/checkout wording belongs to
its later ordering design; the local studies label those controls as demonstrations.
