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
a default or leave the decision to the operator. Use **Yes/no** for a Boolean answer, such as
whether to include cutlery. At the till it is one on/off switch labelled with the modifier's own name, so write that
name as the thing being asked for ("Cutlery"); there is no separate wording for Yes and No to write
or translate. The initial default is No. The recorded answer is kept even when it is "no" — but only
an affirmative answer prints on a receipt, kitchen ticket or the till basket; a negative one leaves
no visible trace.

Use **Text** for an optional message of up to 500 characters. Text is displayed literally and has
no price. It remains separate from the dish's kitchen note and doneness setting.

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

Only a Yes/no modifier can be turned off as a whole. A text, Options or Extras modifier has no
modifier-level Available toggle — its availability is set per choice — so you take one of those out
of use by detaching it from the product. Deactivating a whole Yes/no modifier leaves its existing
product attachments in place, ready for you to reactivate it, and you cannot attach it to another
product while it is unavailable. An unavailable choice already present in an open picker must be
corrected before you add the dish.

## Keep menu offers deliberate

A product attachment and a menu publication are separate. New menu offers copy attached available
modifiers and choices. Attaching another modifier to the product does not change an existing offer.
Publish it on that menu when you want it to become selectable there.

A menu can override an extra's price. That menu price controls the sale, even if you later change
the definition's price. Options and Yes/no remain unpriced. An option default excluded from a
menu's published choices does not reappear as another choice.

## Keep recorded orders intact

When you park an order, its answers, labels and prices are saved. Retrieving it and changing only
the quantity keeps those saved facts, even after you edit the definition. Kitchen views, completed
sales and reprints display the recorded answers.

Deleting a modifier detaches it from every product and menu offer that uses it — those attachments
are removed for you. Deletion is refused only while an open order still uses the modifier; the
message says so, and you finish or void that order first. To stop new selections without deleting,
detach the modifier from the product (or, for a Yes/no modifier, deactivate it). Changing a
modifier's type is still refused while it is attached to a product or menu.

The optional **Allergens and dietary effects** section describes how a choice changes the served
dish. Add or remove allergens directly. For dietary suitability, select the declarations that the
choice invalidates. Adding bacon, for example, invalidates the meat-free claim and therefore stops
the served dish from claiming vegan or vegetarian suitability. These effects apply to both extras
and unpriced options. Recorded answer labels stay fixed; allergen and dietary effects continue to use
the current declarations.
