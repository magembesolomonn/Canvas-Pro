# Window layout and appearance

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## src/floating-player.css

- A 0x0 thumb hid the playback position from keyboard users. A small white dot shows it; the negative margin centres it on the 4px track.
- This window loads only this stylesheet, so it needs its own focus ring. It rides on top of the opacity-only idle fade; no layout is animated.
- Faded controls must not capture clicks meant for the video underneath.

## src/islands.css

- The islands sit a shade above the window so they read as separate pieces without a heavy border.
- With titleBarStyle:'hiddenInset' the renderer starts at x=0 and the native traffic lights float above it (x=22, ~52px wide). Any toolbar that sits at the very left of the window has to clear them. The sidebar normally covers that band; when it is hidden or becomes a drawer the toolbar owns the space, so it switches to this inset.
- The sidebar island keeps its own margin inside its track, so the window shows the same gap on both sides of it and the gallery is not pushed against it.
- Keep the traffic-light inset here rather than in a separate, less specific rule: `.filter-bar.library-header` would otherwise win the cascade and slide the show-sidebar button and the Library title under the window controls on small windows.
- Light mirrors the dark theme: the rails are the one soft grey and the window behind them is white.
- A narrow window keeps the details panel as a sheet over the gallery.
- Dragging a window edge feeds resize events faster than Chromium can repaint. Keeping the sidebar spring, the panel transitions and the translucent layers alive during the drag makes the tile field judder and leaves stale pixels along the newly exposed edges. The renderer marks the window while a resize is in flight; everything here just holds still until it settles.
- Align the footer with the navigation and keep it within reach on long lists.

## src/select.css

- A select that reads like a field and opens a list of options. The trigger is a field: the same surface, hairline and radius as every other field in the app. The list that drops from it is the app's own menu: a solid card, a shadow, plain rows and a tick beside the chosen option. In the light appearance the field is white and the card is the one soft grey, the way every other panel is.
- The native select is the tabbable control; forward its focus to the visible trigger so keyboard users can see which field is active.
- The list scrolls; the field for a new answer stays where it is.
- Only an open list is laid out: a popover that is closed must stay gone.

## src/sidebar.css

- Finder keeps every icon in one column and every name in another, so a line drawn down the sidebar meets the icons and then the names.
- Every category stays open, so the heading is a label rather than a disclosure control: no arrow, and clicking it does nothing.
- Keep the window controls legible while sidebar content scrolls behind them.
- Same 56px band as the toolbar, so the sidebar toggle sits exactly on the traffic lights instead of a few pixels above them.
- The sidebar is a fixed drawer here, so its grid track must collapse too. Leaving the 20px island gutter in place shifts the whole toolbar and the gallery right for no visual reason.
- Same 56px band as the toolbar, so the drawer toggle sits on the traffic lights and not a few pixels above them.

## src/style.css

- Three fills every surface shares, so a field, a row under the pointer and a chosen row look the same in the sidebar, Settings and a list.
- A bare button is a quiet raised surface. Components that paint their own fill override these locally instead of out-specifying the base rule.
- Shadows mark floating layers only. Anything that lives inside the window is separated with a fill and a hairline, never with a drop shadow.
- Quote papers. Muted enough to sit behind text, distinct enough that a wall of quotes never reads as one repeated card. Each one keeps a paper feel in dark mode: a tinted ground, warm off-white ink.
- One sidebar material. The app and the Settings window use the same surface, so moving between them never feels like a different product.
- Inter, bundled so the app looks the same on every Mac.
- Under this width the details panel would take a third of the window and leave the gallery one narrow column, so it steps aside: the gallery takes the room, and the panel comes back as a sheet over it.
- Native buttons keep the arrow cursor. The pointing hand belongs to links that leave the app, not to every control on the screen.
- A long name gives way to the count instead of pushing it out of the card.
- The top bar is the title bar. Dragging it moves the window, the way a native one does; the controls in it do not drag.
- On a touch screen the field needs a finger-sized target, not a hairline.
- Reserve the scrollbar track even when every tile fits. Otherwise adding a scrollbar changes the gallery width, which re-runs the masonry, which changes the height, which toggles the scrollbar again — a relayout loop that shows up as the whole tile field juddering during a window resize.
- The hover player owns the bottom edge; its timeline replaces the badge so the duration never sits on top of the seek bar.
- List layout: one dense row per file. The card keeps the same surface and metadata nodes as the grid, so selection, favourites and hover players all still work; only the arrangement changes.
- The chip's remove control is a bare glyph, not a control with a surface of its own. Light mode's general button fill would otherwise give it a white disc that reads as a second chip.
- The chosen tag is a pressed state, not a button waiting for a hover: keep its fill while the pointer rests on it. Other tags still get the grey wash.
- In the viewer the sidebar and File Details keep their place: the preview occupies only the middle column. Their own visibility still comes from the same ⌘B / ⌘I state the library uses.
- Start at the main column, not at the sidebar's nominal width: the island layout adds its own gutter to the sidebar track, and using the raw width made the viewer overlap the sidebar by one gutter while leaving the same gutter exposed on the inspector side.
- At this width File Details is a sheet over the gallery. Leaving it up while the viewer is open covers the preview's Close and Next controls.
- The room for the chevron is left to the shared select rule, and only the colour is set: the shorthand would wipe the chevron away.
- The scrim is dark in both themes, so the drop callout must be light too.
- The Library header. Only the library chrome wears these rules. A recipe view also uses a <header> for its title block, so a bare `header` selector would indent that block when the sidebar is hidden and break its spacing.
- depth 0 is the newest selection and sits in the middle, fully visible. Everything selected before it recedes up and to the left.
- Rows in the two navigation rails only change fill when chosen. A press scale made the sidebar and Settings feel like they bounced under the pointer, so those rows keep their geometry completely still.
- A search box that shrinks to a few characters is not a search box. The field keeps a usable width; the title gives up the room first.
- The item count is the first thing to go: the name of the view and the search field matter more.
- Video controls float over the picture; they never consume its aspect-ratio box.
- The Settings header sits on the dialog, so it stays transparent: a tinted band at the top of the window read as a different pane.
- A dim, not a blur. A full-window backdrop-filter is re-sampled every frame against the window's vibrancy layer, which made the sidebar bloom with a bright halo and burned battery while the dialog was open.
- The Settings rail has its own width. The app's --sidebar collapses to nothing on a narrow window, and that must not reach into the dialog: a one-pixel rail let the search field and the icons overlap the pane title.
- The pill is the field here. `dialog input` gives typeset fields a bottom margin, and as a flex child that margin lifted the text five pixels above the icon.
- The ring belongs to the pill, not to the input inside it. These selectors are deliberately specific: the generic light-mode focus rule out-specifies a plain class.
- The status lines sit between rows, so they take the row's own padding. Without it they start at the card edge and read as a different column.
- Light mode: the app paints every button with a translucent white fill, so the settings surfaces opt out and keep their own contrast.
- The generic light-mode fill and hairline belong to standalone controls; the search field is one control, so its inner input stays flat inside the pill.
- The menu has its own shadow; it does not need a line around it. The light appearance keeps a hairline, where there is no shadow to read.
- Same 56px band as the toolbar, so the sidebar toggle sits exactly on the traffic lights instead of a couple of pixels below them.
- The sidebar island starts at --island-gap plus its 1px top border, while the traffic lights (and the toolbar row) are aligned to the window at y=28. Lift the control by that exact offset so it stays on the same line at every window size and zoom, without moving the island itself.
- 56px puts the row's centre on the macOS traffic lights (y = 22 + 6). The bar keeps that height at every window size and never wraps: a toolbar that grows while the user drags the window is what pushed the title off the traffic lights and made the whole window judder.
- A hairline separates the bar from the content; a drop shadow made the whole window look heavier than it needed to be.
- When the library tray is open it sits on the left, so the dock slides right to stay clear of it.
- The save state is a status, not an action: it sits apart from the toolbar.
- With the sidebar hidden (or drawn over the window on a narrow display), the canvas fills the window, so the status pill needs the same traffic-light clearance as the library header instead of sitting underneath the lights.
- The viewport is tabbable; an inset ring keeps its focus visible without being clipped by the viewport's own overflow.
- In the canvas tray a link is a small picture, so the card keeps only its image and drops the caption that would not fit.
- Cooking view: ingredients are a checklist that remembers its state, and the method sits beside them rather than a screen below.
- Ticking off ingredients is a repeated, low-stakes action: keep the response instant and only animate the properties that read as feedback.
- A check that pops in from 0 looks like it teleports. 0.85 + opacity reads as one object changing state.
- The window itself: it must match the BrowserWindow background, not the island palette that islands.css layers over --surface-app.
- Set on the body as well: the root values are inherited, so overriding only the surfaces there would not change the app background.
- Dark red holds contrast on the white dialog without shouting.
- Hover is a wash, the chosen row is the grey below it. They are two steps, so a row under the pointer never looks chosen.
- Light mode needs far less depth: the same surfaces are told apart by their fills, so the shadows get much tighter.
- Standalone fields are white with a hairline. Nested fields (a search input inside its pill, a menu row) opt out below. Buttons are not listed here: their fills come from --button-* so components can override them without out-specifying the base rule.
- A primary button keeps the app's light hover fill in light mode, with readable text, instead of turning into a second dark surface.
- The toolbar's buttons sit inside a hairlined pill, so they are bare glyphs rather than a second white button stacked on a white bar.
- Duplicate review. A group is one picture, however many files it arrived as. The chosen copy wears the focus grey; the others are what "Move to Trash" will take.
- A post with pictures keeps its pictures, so its words step back to three lines. A post that is only words is the whole card: it wraps as far as the height the layout reserved for it.
- The element is the picture, not the stage: object-fit on a 100% × 100% box puts the rounded corners in the letterbox where nobody can see them. mountRasterPreview() sizes this element to the fitted picture, so the radius lands on the photo's own edges.
- Keep dialogs usable at larger text sizes and in short windows.
- The keyboard cursor uses the card's own hairline, not a second ring. An outline here would sit outside the selection border and read as two different coloured edges.
- Menus. The Finder context-menu idiom: 13px system text, one left edge, plain rows, hairline rules between groups and a checkmark for the chosen item. A menu is never a stack of filled buttons.
- The row is full height so the pointer never crosses a dead band between items. Only the fill is inset, which keeps the rows contiguous for hover while the highlight still has a little air around it.
- Contrast preferences apply everywhere, including islands, toasts, the sidebar and canvas controls, not only the preview. Reduced motion is handled by the single global rule above.
- Draggable splits. The app sidebar, the Settings rail and File Details share one 11px grab edge centred on the existing hairline. Nothing is visible until the pointer reaches it, then the line doubles and takes the app's focus grey.
- A modal sheet owns the window; the rails behind it cannot be dragged.
- Grow with a compositor transform, not `width`, so hover never reflows.
- Video player chrome. A single cinematic overlay used by both the preview and the card player. The controls sit on the picture, so they keep one white ink and a soft scrim in both themes: a light bar over an arbitrary frame is unreadable, while a theme-coloured bar looks out of place over a film. The lavender seek outline is the one accent, chosen to stay legible on warm and cool frames alike.
- Fade only; the range is laid out at its final width, so no reflow.
- Portrait video: the player box is only as wide as the picture, so shed the secondary controls before the seek bar is squeezed out.
- The base control strip caps itself at 900px, which left-anchored it inside a wider video. The overlay must follow the picture edge to edge.
- The reveal transform comes from Motion.revealFromTrigger, anchored to the control or shortcut that opened the palette.
- `dialog input` adds typeset-field margins; the palette search is a toolbar.
- When the canvas tray is open on a narrow window, the centred tool dock would sit on top of the zoom cluster. Lift it clear instead.
- Fade only; the range is laid out at its final width, so no reflow.
- Canvas items are square: no rounded corner can reveal a dark sliver of board behind a light image, and no selection outline is rounded either.
- Continuous corners. Chromium supports Apple-style continuous curvature natively, so rounded surfaces get a superellipse corner without clip-path or JS. The shape follows every existing border-radius and keeps borders and fills intact.
- Circles and capsules stay optical circles: a superellipse would deform their ends.
- The square-item rule above must not flatten an ellipse: exported boards draw a real ellipse, so the on-screen shape has to stay round too.
- Concentric radii: an element nested in a padded container takes the outer radius minus that padding, never below zero. Containers set the two variables; children read --radius-inner.
- The gallery is a huge focus target: outlining it draws a white frame around the whole library. Focus is shown on the selected card instead.
- Controls are never filled surfaces: the generic light-mode button rule would otherwise paint them white and hide the white glyphs.
- Audio gets a centred capsule. Full-screen video keeps the flat, edge-to-edge scrim: a rounded floating bar would read as a second window on the picture and override the scrim's zero radius.
- Infinite canvas view. A full-window justified wall. The stage sits behind the sidebar and File Details, so scrolling carries items underneath those floating panels.
- 172px including the 3px padding: the JS wrap period relies on this exact pitch, so keep the row total (not its content box) at 172.
- The wall runs edge to edge, but the sidebar and File Details are islands with a 10px margin. The viewer is inset to the middle column, so those margins would show the wall moving around the viewer's edges. Paint the viewer's backdrop across the whole window instead, and keep the islands above it so they stay readable and interactive.
- The viewer is modal: the gaps around the floating panels must not let a click through to the wall underneath.
- These adjustments used to live higher up the sheet, where the base .filter-bar rules below them silently won the cascade and the search field kept its full-width size down to 900px. Keep the override at the end so it actually takes effect.
- The canvas hides the toolbar, which is the window's drag region. The sidebar still carries one, so a board only needs its own when the sidebar is hidden; then this thin strip at the very top is the only place the window can be grabbed. Keeping it out of the way otherwise leaves the whole board interactive, including the top edge where fitted content starts.
- An unfocused window is a quieter window, the way native chrome dims when another app is in front. Only the chrome fades; the content keeps its contrast so a board or a photo is still readable at a glance.
