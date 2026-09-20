# Reuse choices across your products

When several dishes offer the same extras or preparation choices, create one modifier in
**Modifiers** and attach it to each product. You edit its names, choices and limits in one place;
each order keeps its own answers.

## Choose the input you need

Use **Extras** for additions with a price. For example, add bacon at 1.00 with a maximum quantity
of two and cheese at 1.00 with a maximum of one. Set the total maximum to two if you want two
bacon portions or one of each. Leave the total maximum blank for no group limit. The individual
maximum still applies. For two dishes, two bacon portions per dish add 4.00 to the bill.

Use **Options** when you need exactly one unpriced choice, such as a cup or a glass. You can choose
a default or leave the decision to the operator. For a simple on/off question, such as whether to
include cutlery, make an Options or Extras modifier with a single choice.

Use **Text** for an optional message of up to 500 characters. Text is displayed literally and has
no price. It remains separate from the dish's kitchen note.

## Set defaults and availability

Give the modifier and each choice a name in your default content language. You can add other
translations now or later. See [content languages](content-and-images.md).

A default seeds a new selection once. Changing a default does not change an order you already
started. An extra's choice is either preselected or not — there is no starting quantity to set — and
you cannot preselect more choices than the total maximum allows. A required extras group may have no
defaults, so the operator must make an active choice.

Turn off **Available** on a choice to stop new selections of it and clear its default. If an
available required Options or Extras modifier has no usable choices, add or enable a choice so the
requirement can be met. If a published menu later reaches that state, the till explains why the
product cannot be added. It does not silently waive the required choice.

A modifier has no modifier-level Available toggle — availability is set per choice — so you take a
whole modifier out of use by detaching it from the product. An unavailable choice already present in
an open picker must be corrected before you add the dish.

## Keep menu offers deliberate

A product attachment and a menu publication are separate. New menu offers copy attached available
modifiers and choices. Attaching another modifier to the product does not change an existing offer.
Publish it on that menu when you want it to become selectable there.

A menu can override an extra's price. That menu price controls the sale, even if you later change
the definition's price. Options remain unpriced. An option default excluded from a
menu's published choices does not reappear as another choice.

## Keep recorded orders intact

When you park an order, its answers, labels and prices are saved. Retrieving it and changing only
the quantity keeps those saved facts, even after you edit the definition. Printed paper shows the
recorded answers: the kitchen ticket prints them in the kitchen's wording, and the customer receipt
prints them under the dish in the diner's. The till's own screens do not show them yet — not the
basket, the kitchen and pass displays, a table's line list, or a settled ticket you open again.

Deleting a modifier detaches it from every product and menu offer that uses it — those attachments
are removed for you. Deletion is refused only while an open order still uses the modifier; the
message says so, and you finish or void that order first. To stop new selections without deleting,
detach the modifier from the product. Changing a modifier's type is still refused while it is
attached to a product or menu.

Each choice can carry its own nutrition. Under **Nutritional information** you list the allergens the
choice contains. Under **Dietary preferences** you tick the diets the choice is suitable for — vegan,
vegetarian, halal or kosher. Both apply to extras and to unpriced options. These describe the choice
itself, not the whole dish: the till and kitchen screens show the dish's own allergens and diet and
each extra's own, side by side, and never fold them into a single combined figure. Recorded answer
labels stay fixed; the allergen and dietary information always reflects the current declarations.
