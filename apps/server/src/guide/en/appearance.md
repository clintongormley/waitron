# Appearance

Your dashboard and tills can carry your venue's own colours instead of Waitron's blue. The
**Appearance** page under **Settings** shows the look in use, and lets a manager change it and
see the result before anyone else does.

## See the look in use {#look}

Open **Settings**, then **Appearance**. The **Look** card shows the **Theme in use** and the
choices it is made of:

- **Logo**: **None**, or the theme's logo followed by how dark screens show it: "Dark screens: own
  version" when the theme has a version for dark screens, or "Dark screens: on a light plate" when
  it does not. The picture follows this dashboard's own **Theme** setting, so a dark dashboard shows
  the logo the way dark screens will.
- **Brand colour**: the colour of the main buttons and of selected items. **Waitron's** means the
  theme keeps Waitron's own colour. A colour that is not one of the swatches shows as **Custom**
  with its code. Where a readable shade was taken in place of the colour, the row names it too,
  and where a version's main buttons were given a colour by hand, the row names that colour
  followed by "set by hand", such as "dark screens #5fa77a, set by hand".
- **Background**: **Neutral** keeps Waitron's greys, and **Tinted** gives the page, field fills
  and borders a faint cast of the brand colour.
- **Corners**: **Square**, **Standard** or **Round**, for buttons, fields and cards.
- **Text size**: how big the theme makes every screen's text: "100% (standard)", or a larger
  step such as "115%".
- **Colours set by hand**: any of the theme's colours that were given a value of their own rather
  than worked out from the brand colour, or **None**. The editor's **Advanced** section sets them,
  as "Set colours and text by hand" below describes.
- **Text set by hand**: the text settings given a value of their own, such as **Small text**, or
  **None**. "Set text by hand" below describes them.

The note at the bottom of the card explains that one look covers the dashboard and every till.
Each theme has a light version and a dark version, and each screen shows one of them, as its own
**Theme** setting says: Light, Dark or Follow device. The **Themes** card under it lists the
venue's themes.

Anyone whose role is **Supervisor** or above can open this page and read both cards. Only a
**Manager** or an **Admin** can change the look.

## Edit a theme {#edit}

The Look card shows **Edit** to a **Manager** or an **Admin**, whichever theme is in use. It opens
the theme in use. To edit one of the venue's other themes, or to start a new one, use the
**Themes** card below it.

While Waitron's theme is in use, Edit opens on Waitron's choices. Waitron's own theme never
changes, so when you save, Save asks for a name and stores your choices as a new theme. That is
how a venue makes its first theme.

A line at the top of the editor says what saving does. Editing the theme in use, it reads "Theme
in use:" with the theme's name, and "Saving changes every screen." Editing any other theme, it
reads "Not in use. Saving changes no screen until you use it.", and the card's heading names the
theme, or reads **Add theme**.

The editor opens with the theme's **Logo** first, as "Add your logo" below describes, then the
theme's four choices:

- **Brand colour**: pick **Waitron's**, one of the swatches, or **Custom** to choose any colour.
  You can also type a code such as `#1e5b3a` into the box beside **Custom**. A code must be `#`
  followed by six digits or letters a to f, or Save tells you so under the field.
- **Background**: **Neutral** or **Tinted**.
- **Corners**: **Square**, **Standard** or **Round**.
- **Text size**: a slider from 100% to 130% in steps of 5%, with the four sizes drawn under it,
  such as "Text on screens: small 12 px · normal 14 px · large 18 px · largest 22 px" at 100%.

Under the brand colour, **Pick a different colour for dark screens** gives the dark version's main
buttons a colour of their own: it opens Advanced and its **Buttons** section and puts the cursor in
the code box of **Main buttons** on dark screens. Once that colour is set, the link gives way to a line such as "Buttons on
dark screens: #5fa77a, set by hand", and **Use the brand colour** beside it takes the colour away
again, so dark screens work their buttons out from the brand colour once more.

Beside or below the choices, the **Preview** paints a small sample of the dashboard in the look you
are building: a **Light version** and a **Dark version**, each headed by a strip with the logo and
the venue's legal name, then a selected menu item, a field, Save and Cancel buttons, a switch, a
link and a Light and Dark choice, then a till's product button and a bill line. Both versions are
drawn at the text size you have chosen. The product's name is in the venue's main language for
menu content when the dashboard has one, else in the dashboard's language. It is a picture, so its
buttons do nothing. The editor arranges itself by the width of the card rather than of the window.
On a wide card the preview sits beside the choices, and on a narrow one below them. When the
preview has room, the two versions sit side by side; otherwise the light version sits above the
dark one.

Nothing else on the page, and no other screen, changes until you save. **Use Waitron's look**
removes the logo and sets every choice back to Waitron's: Waitron's brand colour, Neutral, Standard
corners, text size 100%, and nothing set by hand. It saves nothing by itself, and it is greyed
out while there is no logo and the choices already are Waitron's look. **Cancel** closes the editor
without saving. If you have changed something, Cancel, leaving the page, and opening another theme
from the Themes card ask you first.

## Make text bigger {#text-size}

The **Text size** slider makes the text of every dashboard, till, handheld and kitchen screen
bigger: each of the four text sizes grows by the same percentage, to the nearest pixel. 100% is
Waitron's size, and 130% the largest. Spacing stays as it is, and so does the smallest size of a
button, a till's product buttons included, so a long name that no longer fits takes another line.

On a till or handheld whose venue's [default content language](content-and-images.md#languages) is
Spanish, a word of eight letters or more in a
product name, on a product button or a bill line, can break at a syllable with a hyphen; a shorter
word is never hyphenated. In a language the browser does not hyphenate, English among them, a word
longer than its button or line breaks inside the word, with no hyphen, at any text size; larger text
makes that happen more often.

A saved text size reaches the dashboards and tills as a saved theme's colours do (see
[Save a theme](appearance.md#save)). A kitchen screen that nobody signs in on takes it when it next
starts.

Printed paper keeps Waitron's sizes: receipts, kitchen tickets, the equipment label and the node
recovery pack. Google's sign-in button keeps Google's size.

A size set by hand grows with the slider too, as [Set text by hand](appearance.md#text-by-hand)
describes.

## Add your logo {#logo}

With no logo, the **Logo** field shows **+ Add a logo**, which opens the image library: upload a
picture there or find one already in it, then choose **Use image** on it. A logo is a PNG, JPEG or
WebP file, like every picture in the library; an SVG file is refused. The hint under the field reads
"PNG, JPEG or WebP. A see-through background, at least 200 pixels tall, looks best."

With a logo, the field shows the picture on a white plate, with **Replace** above **Remove** beside
it. Replace opens the image library to choose another picture. Remove takes the logo off the theme,
together with its version for dark screens. The picture itself stays in the image library.

Once there is a logo, **For dark screens (optional)** offers **+ Add a version for dark screens**: a
second picture, such as a light drawing of your logo, which dark screens show instead of the main
one. Until you add one, the hint reads "Without one, dark screens show your logo on a light plate."
The version for dark screens has its own Replace and Remove.

Below **For dark screens (optional)**, a small picture shows how the main logo prints on receipts of
departments with no receipt logo of their own: in the black dots of an 80 mm receipt printer. See
[On receipts and invoices](appearance.md#logo-receipts). When the logo would print no dots at all,
as a white logo on a see-through background does, "This logo prints blank on receipts." shows
underneath the picture: pick a darker picture, or give the departments a receipt logo of their own.
If asking for the picture fails, "Could not show how this logo prints." appears instead, with **Try
again**.

The preview shows the logo in the strip at the top of each version, followed by the venue's legal
name: the main logo on the light version, and on the dark version the version for dark screens, or
the main logo on its light plate. With no logo, the strip shows Waitron's own logo.

**Save** and **Cancel** treat the logo as they do the other choices. The logo is saved with the
theme.

## Where your logo shows {#logo-screens}

The logo of the theme in use shows in these places:

- **The dashboard's banner**, before the business's legal name, both when you are signed in and on
  the sign-in page.
- **A handheld's top bar**, in place of the word "Waitron". It is the first thing the bar leaves
  out when it is short of room, and a narrow screen, such as a phone's, leaves it out altogether.
- **The sign-in screen of a cash register or handheld**, above the device's name and the list of
  names.
- **"Powered by Waitron"**, which shows while a logo is set: under the dashboard's sign-in form; in
  the dashboard's banner once you are signed in, before the buttons at its end (on a narrow screen,
  such as a phone's, after the legal name on the banner's second line, or under it when the two do
  not fit); at the foot of a cash register's or handheld's sign-in screen; and at the foot of a
  handheld's **More** (☰) menu, under **Log out**.
- **A receipt shown on a cash register's or handheld's screen**, above the venue's name. A
  department's own receipt logo comes first there too, and the main logo always shows there, never
  the version for dark screens.

A cash register's top bar shows no logo yet.

Each of the other screens shows the light or the dark image by its own **Theme** setting. A dark screen, when the
theme has no version for dark screens, shows the main logo on a white plate.

The other screens follow a new or removed logo when they follow a change of colours, as "Save a
theme" below describes.

When one of the other screens cannot load the picture, the dashboard's banner shows Waitron's logo,
a handheld's bar shows the word "Waitron", and a cash register's or handheld's sign-in screen shows
no logo, with no gap where it would be. No "Powered by" line shows. The screen tries the picture
again every minute, and shows it once it loads.

## On receipts and invoices {#logo-receipts}

The logo of the theme in use also prints, in black dots, above the venue's name on receipts and A4
invoices for a department that has no receipt logo of its own, and for a sale with no department.

A department's own receipt logo, set on its **Receipts** tab, always comes first. That is how a
department prints a different picture from the rest of the venue.

Paper takes the main logo, never the version for dark screens.

Saving a new logo, removing it, or putting another theme in use changes what the next receipt or
invoice prints, a reprint of an earlier sale included. A theme that is not in use prints nothing.

A department's **Receipts** tab preview shows the theme's logo while no receipt logo is chosen on
the tab, unless the department's saved receipt settings cannot be read: then it shows no logo.

When a department's receipt settings cannot be read, its receipts and invoices print no logo at all,
rather than one that may be the wrong one.

## Set colours and text by hand {#advanced}

Below the choices and the preview, the editor has a section headed **Advanced: set colours and
text by hand**. It starts closed each time the editor opens, and its closed line says what is set by hand:
"None set by hand. Waitron works out every colour and text size.", or a count and the names
of the colours and text rows set by hand, such as "2 set by hand: Page (light), Text (light)". While colours or text sizes set by hand
are hard to read, the line adds how many, as in "1 set by hand: Text (light) · 1 hard to read". Press the
heading to open it.

Inside, Advanced holds five sections, in this order: **Page and surfaces**, **Text colours and
links**, **Buttons**, **Fields and focus** and **Text**. Each starts closed when you open the
editor, and each has a closed line of its own that says what in it is set by hand, such as "1 set by
hand: Page (light)" or "None set by hand". While colours set by hand in that section, or, in the
**Text** section, text sizes, are hard to read, the line adds how many, as in "1 set by hand: Page
(light) · 1 hard to read". The brand colour's own warning counts in none of the sections. Press a
section's heading to open it. A section stays open or closed as you leave it, closing and opening
Advanced included, until the editor closes; the next time the editor opens, every section starts
closed.

In the four colour sections, a row for each of the section's colours gives its value on light
screens and on dark screens, under the headings **Light screens** and **Dark screens** at the top of
the section on a wide card, or each labelled
**Light** or **Dark** on a narrow one, each with a colour picker and a box for a colour code. Beside each value's code, or under it
on a narrow screen, a colour that is worked out reads **Worked out**; Main buttons reads **Brand colour**, or **Fixed** where a
readable shade was taken for that kind of screen. Changing either value, with the picker or by
typing a code, sets that value by hand and leaves the other kind of screen's value as it was. A
value set by hand is marked **Set by hand**, with **Use worked-out colour** under it to go back to
the value Waitron works out. **Reset all to worked-out**, at the bottom of Advanced after the
sections, puts every value back to worked out, the text rows included; it is greyed out while
nothing is set by hand. The **Text** section holds the rows for the typeface, the text sizes and the
weights, which "Set text by hand" below describes.

A colour set by hand stays as you set it when you change the brand colour, the background or the
corners. When you change the brand colour or the background while some colours are set by hand, a
note under the brand colour says so, such as "You set 1 colour by hand, and it is kept: Text
(light). Advanced shows it."

Setting **Main buttons** by hand replaces the brand colour on that kind of screen, so a readable
shade taken for it there is dropped.

A code must be `#` followed by six digits or letters a to f. When one is not, Save says so under
that code box and saves nothing, and Advanced and the section holding that colour open to show it,
and they cannot be closed until the code is fixed.

## Set text by hand {#text-by-hand}

In Advanced's **Text** section there are eight rows: **Typeface**, **Small text**, **Normal
text**, **Large text**, **Largest text**, **Normal weight**, **Medium weight** and **Bold weight**.
Each shows Waitron's own value, marked **Worked out**, until you change it:

- **Typeface** offers **The device's own**, the typeface each screen uses unless told otherwise,
  and **Serif**, a typeface with small strokes at the ends of its letters. Which serif typeface a
  screen draws depends on the device.
- A size is a whole number of pixels from 8 to 40, typed or set with − and +. Waitron's own are 12,
  14, 18 and 22.
- A weight is 400, 500, 600, 700 or 800: the higher, the bolder. Waitron's own are 400, 500 and 600.

Changing a row sets it by hand, even to Waitron's own value: its value turns bold, it is marked
**Set by hand**, and **Use worked-out size**, **Use worked-out typeface** or **Use worked-out
weight** under it puts it back. **Reset all to worked-out** puts the text rows back with the
colours.

A size you set is the size at 100%, and the **Text size** slider grows it as it grows Waitron's
own. Away from 100%, each size row says what it draws, such as "at 115%: 16 px", and the line under
the slider lists the sizes drawn.

A size drawn smaller than 12 px warns under its row, such as "Small text: 10 px is smaller than 12
px; text that small is often hard to read.", with a button that sets the smallest size that draws
12 px: **Use 12 px** at 100%, or **Use 9 px (12 px at 130%)** with the slider at 130%. It counts as
hard to read, as a colour does: Advanced's closed line, the Text section's closed line, **Fix all**,
the **Hard to read** dialog and the Themes card count it.

A size drawn larger than Waitron checks the tills at, which is Waitron's own size at 130% (16, 18,
23 and 29 px), gets a note instead: "Largest text: 33 px is larger than Waitron checks the tills at;
long names may wrap more or be cut off.", with a button that sets the largest size within it, such
as **Use 22 px (29 px at 130%)**. The note is not a warning: nothing counts it, and you can save the
size as it is.

A size that is not a whole number from 8 to 40 is not used. Save says "Enter a whole number from 8
to 40." under it, saves nothing, and opens Advanced and its Text section to show it.

The typeface and the weights reach every screen the theme paints, and a bold word, heading or table
header follows **Bold weight** unless its screen gives it a weight of its own. Printed paper and
the typeface used for codes keep Waitron's type, and Google's sign-in button keeps Google's.

## When a colour is hard to read {#hard-to-read}

Some brand colours make buttons hard to see. A sunny yellow such as `#f2c94c`, for example, barely
stands out on a light screen. When that happens, a warning appears under the brand colour: "Buttons
in this colour are hard to see on light screens."

When a shade of your colour would read well, the warning comes with a button that offers it. For
that yellow on a Neutral background, the button reads **Use #a78612 on light screens**. Press it and
light screens use the shade, while dark screens keep your colour. The line then reads "Buttons on light screens:" with the shade, and
**Undo** puts your colour back.

A shade you take belongs to its colour. Picking another brand colour drops it, and returning to the
theme's saved colour brings its saved shade back, except on a kind of screen whose **Main buttons**
is set by hand in Advanced. Changing the background or the corners keeps it.

A colour set by hand in Advanced is checked too. When it is hard to read, a warning under its row
names the kind of screen and what it is hard to read on, or what is hard to read on it. Text set
to `#9a9a9a` on light screens, for example, warns "Light screens: hard to read on Page, Cards, …",
naming every colour it is hard to read on. When a shade would read well, a button offers it: for that
grey it reads **Use #585858**. Press it and the value takes the shade, and a line reading "Light
screens: fixed from #9a9a9a" shows with **Undo**, which puts your colour back. Undo stays until you
change that value again or the editor closes.

Some colours set by hand have no shade that reads well. Their warning ends "Pick another colour.", or, where
another colour set by hand is in the way, names it: with Page set to `#777777` and Text to `#888888`
on light screens, Page's warning ends "while Text is set by hand to #888888".

When two or more of the warnings each offer a fix, a line under the editor counts the colours and text
sizes that are hard to read and offers **Fix all**, which takes every fix at once, colours set by hand
included.

Waitron never refuses a colour. A warning is advice: you can save the colour you chose and live
with it.

A text size drawn smaller than 12 px counts as hard to read in the same way, and **Fix all** and
**Fix and save** take its fix too: see [Set text by hand](appearance.md#text-by-hand).

## Save a theme {#save}

**Save** is greyed out until you change something. What it does next depends on the theme you are
editing.

Editing one of the venue's own themes, Save stores your changes to it and closes the editor.

Editing Waitron's theme, or a theme you started with **Add theme**, Save opens the **Name this
theme** dialog, after the **Hard to read** dialog when that appears, because your choices are about
to become a theme of their own. Its **Use it on every screen now** switch starts on when you are
editing Waitron's theme in use, and off for a new theme. **Save** in the dialog stores the new theme
and closes the editor. **Back** leaves you in the editor with nothing saved, asking first if you
changed anything in the dialog. The rules for a name are under "Name a theme" below.

When something is still hard to read, Save first opens the **Hard to read** dialog, with one line
for each colour or text size that is. It offers three choices:

- **Back** returns you to the editor with nothing saved.
- **Save anyway** saves the theme as you chose it.
- **Fix and save** takes every fix, then saves. The dialog offers it only when fixing everything
  would leave no warning at all.

Where Save asks for a name, **Save anyway** and **Fix and save** open the name dialog rather than
saving at once. While its switch is on, the name dialog lists the colours and text sizes that are
still hard to read, so you see them before the theme goes on every screen.

When the theme you saved is the one in use, the dashboard you are using changes to the new look at
once. Other dashboards open at the same time follow on their own, and a signed-in till follows the
next time it checks its menu for changes. A handheld phone or tablet, and a cash register set up
for counter service, check every 15 seconds. Any other cash register checks every 15 seconds while
a table's order is open on it, and otherwise follows when it next opens one, or when it restarts.
Saving a theme that is not in use changes no screen until you put it in use.

If you saved anyway, the Themes card's row for that theme shows a tag such as "2 hard to read", and
while it is the theme in use the Look card also keeps a warning line for each colour or text size that
is still hard to read, so the next person who opens the page sees it too.

While you edit one of the venue's own themes, the editor also offers **Save as new theme…**. It
opens the name dialog with the theme's name followed by "(copy)", stores your choices under the name
you give, leaves the theme you were editing as it was last saved, and closes the editor. Its **Use
it on every screen now** switch starts on when the theme you are editing is in use. When a colour or
text size is still hard to read, the **Hard to read** dialog comes first, as it does for Save. Like Save, it
tells you under the field when a colour code or a text size you typed is not valid, and saves
nothing until you fix it.

## The venue's themes {#themes}

The **Themes** card lists every theme the venue has, Waitron's first. Each row shows the theme's
**Name**, its **Colours** and its **Status**. The colours are three dots: the brand colour, then
the page colour of the light version and of the dark version. When the card is narrow, as on a
phone or beside the side menu on a small screen, it leaves the colours out, and on a phone the
status tags sit after the theme's name instead of in a column of their own. The status tags say
which theme is **In use** and how many of a theme's colours and text sizes are hard to read, such as "2 hard to
read". Waitron's theme carries the tag **built in**.

A **Manager** or an **Admin** sees **Add theme** on the card, which opens the editor on Waitron's
choices for a theme that is not yet stored, and a menu on each row:

- **Edit** opens that theme in the Look card's editor. A theme that is not in use opens with the
  line "Not in use. Saving changes no screen until you use it."
- **Rename** gives the theme a new name.
- **Make a copy** stores a copy of the theme under a new name. The name dialog proposes the theme's
  name followed by "(copy)". The copy is not in use unless you turn on **Use it on every screen
  now** before you save.
- **Use on every screen** puts the theme in use. The row of the theme in use does not offer it.
- **Delete** removes the theme. The row of the theme open in the editor does not offer it.

Waitron's row offers only **Make a copy**, and **Use on every screen** while another theme is in
use, because Waitron's theme cannot be edited, renamed or deleted. A **Supervisor** sees the list,
without Add theme and without the menus.

## Name a theme {#names}

The **Name this theme** dialog asks for a name whenever a theme is stored under a new one: the first
save of Waitron's theme or of a new theme, Save as new theme…, Make a copy, and Rename. A name is 1
to 60 characters long, and spaces at either end are dropped. Two themes cannot share a name,
whatever their capitals: while a theme called "Terrace" exists, naming another one "terrace" is
refused with "A theme with this name already exists." No theme may be called "Waitron", in any
capitals, because that is the built-in theme's name.

Every way in but Rename shows the **Use it on every screen now** switch. Rename has no switch, and
renaming a theme changes no screen's look.

## Put a theme in use {#switch}

**Use on every screen** asks first, with a question such as "Use Terrace on every screen?" When
the theme has colours or text sizes that are hard to read, the question lists them under "Hard to read:".
**Use it** puts the theme in use, and **Back** changes nothing.

Once a theme is in use, the dashboard you are using changes to it at once and other dashboards
open at the same time follow on their own. Signed-in tills follow as they do when you save the
theme in use, as "Save a theme" above describes. Waitron never refuses a theme for being hard to
read: the list is there so that you choose knowing it.

## Delete a theme {#delete}

**Delete** asks first, naming the theme and saying the delete cannot be undone. When the theme is
the one in use, the dialog says so under "What changes": deleting it puts Waitron's theme on every
screen, and the screens change as they do when you put a theme in use.
