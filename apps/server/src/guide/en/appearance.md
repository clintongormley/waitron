# Appearance

Your dashboard and tills can carry your venue's own colours instead of Waitron's blue. The
**Appearance** page under **Settings** shows the look in use, and lets a manager change it and
see the result before anyone else does.

## See the look in use {#look}

Open **Settings**, then **Appearance**. The **Look** card shows the **Theme in use** and the
choices it is made of:

- **Brand colour**: the colour of the main buttons and of selected items. **Waitron's** means the
  theme keeps Waitron's own colour. A colour that is not one of the swatches shows as **Custom**
  with its code. Where a readable shade was taken in place of the colour, the row names it too.
- **Background**: **Neutral** keeps Waitron's greys, and **Tinted** gives the page, field fills
  and borders a faint cast of the brand colour.
- **Corners**: **Square**, **Standard** or **Round**, for buttons, fields and cards.
- **Colours set by hand**: any of the theme's colours that were given a value of their own rather
  than worked out from the brand colour, or **None**. This page cannot set a colour by hand, but
  its fixes can replace one that is hard to read with a readable shade, and **Use Waitron's look**
  removes them all.

The note at the bottom of the card explains that one look covers the dashboard and every till.
Each theme has a light version and a dark version, and each screen shows one of them, as its own
**Theme** setting says: Light, Dark or Follow device.

Anyone whose role is **Supervisor** or above can open this page and read the card. Only a
**Manager** or an **Admin** can change the look.

## Edit the look {#edit}

The card shows **Edit** to a **Manager** or an **Admin** while one of the venue's own themes is in
use. While Waitron's theme is in use, the card has no **Edit**.

Press **Edit** and the card opens its three choices in place:

- **Brand colour**: pick **Waitron's**, one of the swatches, or **Custom** to choose any colour.
  You can also type a code such as `#1e5b3a` into the box beside **Custom**. A code must be `#`
  followed by six digits or letters a to f, or Save tells you so under the field.
- **Background**: **Neutral** or **Tinted**.
- **Corners**: **Square**, **Standard** or **Round**.

Beside or below the choices, the **Preview** paints a small sample of the dashboard in the look you
are building: a **Light version** and a **Dark version**, each with a selected menu item, a field,
Save and Cancel buttons, a switch, a link and a Light and Dark choice. It is a picture, so its
buttons do nothing. The editor arranges itself by the width of the card rather than of the window.
On a wide card the preview sits beside the choices, and on a narrow one below them. When the
preview has room, the two versions sit side by side; otherwise the light version sits above the
dark one.

Nothing else on the page, and no other screen, changes until you save. **Use Waitron's look** sets
every choice back to Waitron's: Waitron's brand colour, Neutral, Standard corners, and no colours
set by hand. It saves nothing by itself, and it is greyed out while the choices already are
Waitron's look. **Cancel** closes the editor without saving. If you have changed something, Cancel,
and leaving the page, ask you first.

## When a colour is hard to read {#hard-to-read}

Some brand colours make buttons hard to see. A sunny yellow such as `#f2c94c`, for example, barely
stands out on a light screen. When that happens, a warning appears under the brand colour: "Buttons
in this colour are hard to see on light screens."

When a shade of your colour would read well, the warning comes with a button that offers it. For
that yellow on a Neutral background, the button reads **Use #a78612 on light screens**. Press it and
light screens use the shade, while dark screens keep your colour. The line then reads "Buttons on light screens:" with the shade, and
**Undo** puts your colour back.

A shade you take belongs to its colour. Picking another brand colour drops it, and returning to the
theme's saved colour brings its saved shade back. Changing the background or the corners keeps it.

When two or more of the warnings each offer a fix, a line under the editor counts the colours that
are hard to read and offers **Fix all**, which takes every fix at once.

Waitron never refuses a colour. A warning is advice: you can save the colour you chose and live
with it.

## Save the look {#save}

**Save** is greyed out until you change something. When nothing is hard to read, Save stores the
theme and closes the editor.

When something is still hard to read, Save first opens the **Hard to read** dialog, with one line
for each colour that is. It offers three choices:

- **Back** returns you to the editor with nothing saved.
- **Save anyway** saves the colours as you chose them.
- **Fix and save** takes every fix, then saves. The dialog offers it only when fixing everything
  would leave no warning at all.

When the theme you saved is the one in use, the dashboard you are using changes to the new look at
once. Other dashboards open at the same time follow on their own, and a signed-in till follows the
next time it checks its menu for changes. A handheld phone or tablet, and a cash register set up
for counter service, check every 15 seconds. Any other cash register checks every 15 seconds while
a table's order is open on it, and otherwise follows when it next opens one, or when it restarts.

If you saved anyway, the Look card keeps a warning line for each colour that is still hard to read,
so the next person who opens the page sees it too.
