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
whether to include cutlery. You can translate both labels without changing what Yes and No mean.
The initial default is No, and an explicit No stays recorded.

Use **Text** for an optional message of up to 500 characters. Text is displayed literally and has
no price. It remains separate from the dish's kitchen note and doneness setting.

## Set defaults and availability

Give the modifier and each choice a name in your default content language. You can add other
translations now or later. The Yes and No labels also need a translation before you change your
default content language. See [content languages](content-and-images.md).

A default seeds a new selection once. Changing a default does not change an order you already
started. An extra's default quantity starts at zero and cannot exceed its individual maximum;
the sum of defaults cannot exceed the total maximum. A required extras group may have no defaults,
so the operator must make an active choice.

Turn off **Available** on a choice to stop new selections of it and clear its default. If an
available required modifier has no usable choices, you must add a choice or deactivate the
modifier. If a published menu later reaches that state, the till explains why the product cannot
be added. It does not silently waive the required choice.

Deactivating a whole modifier leaves its existing product attachments in place, ready for you to
reactivate it. You cannot attach it to another product while it is unavailable. An unavailable
choice already present in an open picker must be corrected before you add the dish.

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

Delete a modifier only when it is unused. A product, menu offer or retained order can prevent
deletion; the message identifies which kind of use remains. Deactivate it if you want to stop new
selections. Changing a modifier's type is also refused while it is attached to a product or menu.

The optional **Allergens and dietary effects** section describes what a choice adds or removes.
Use the selected food and allergen controls to describe the served dish. Their effects apply to
both extras and unpriced options. Recorded answer labels stay fixed; allergen and dietary effects
continue to use the current declarations.
