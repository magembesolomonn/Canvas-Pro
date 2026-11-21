# Input, focus and preferences

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## src/command-palette.js

- One ⌘K surface for commands, navigation and everything in the library. Results are assembled from the app's own indexes: the local smart index (which already knows names, tags and AI captions), the live catalog, canvases and collections. File hits are shown as a grid of previews, with a second grid of visually similar frames when a vector is available.
- A search is kept for 15s after the palette closes, so ⌘K can bring the same results straight back. After the window it resets to Quick actions.
- The gallery can be paged. Pull indexed hits that are not in memory so palette search still covers the whole library.
- Commands come first: the palette is a command surface, so actions stay above the file grid while a query is typed.
- A late async section (visually similar, or a slow file search) must not steal the selection from someone who has already moved down the list. If they have not moved, the first result stays selected: it is the one Enter should run.
- The dialog's close event is queued, so an rAF scheduled right now would run before it and the focus restore would steal focus from the action. Attach to close first: the palette's own listener restores focus, then the action runs in the next frame and can focus its own target.
- Restore a recent search before the first paint so the same files stay in view when the palette is reopened with ⌘K.
- Closing a preview here matters: the capture-phase handler would otherwise swallow the app's own handler that closes it.

## src/floating-player.js

- A malformed hash must not stop the controls from being wired up.
- The floating window is created with no-user-gesture-required autoplay, so it can continue with the original audio state immediately.
- Controls fade in on pointer movement and idle out after a beat. The CSS :hover fallback alone flickered because the window is a drag region; the class keeps the reveal stable while the pointer is moving or interacting.

## src/index.html

- The sidebar deliberately stays interactive above the preview, so this dialog does not claim modal semantics: no aria-modal, no focus trap.

## src/motion.js

- Motion helpers aligned with the app's fluid-interaction goals: respond instantly, animate from the current value, preserve velocity, stay interruptible, and respect reduced motion.
- Critically damped spring sampled for WAAPI. `from/to` are numbers. `velocity` is in the same units per ms as used by callers.
- A cubic-bezier can only approximate an ease-out; it cannot carry the spring's momentum or its slight overshoot. Feeding the sampled spring points to CSS `linear()` (supported by Chromium in Electron) reproduces the real curve while keeping this file dependency-free. Sample values are pinned to the 0→1 easing range at the ends; any overshoot in between is kept and left for CSS to clamp (harmless for opacity, a subtle pop for scale).
- The first rAF timestamp can predate performance.now() inside the same frame; clamping keeps the sample index valid and the spring alive.
- Interpolate linearly between sampled spring points. The spring model already supplies the curvature; easing again here made numbers land late and overshoot twice.
- Trigger-anchored reveal: a menu, dialog or popover grows out of the control that opened it instead of expanding from its own centre. The one shared helper keeps the spatial relationship identical everywhere.
- Two listeners can observe the same open (a pointer handler and the popover's toggle event). One reveal per surface per moment is enough.
- Keep the origin on (or just outside) the surface so a distant trigger gives direction without stretching the material into an extreme skew.
- Reveal with the sampled spring so the surface settles with the same character as the app's other spring-driven motion. If construction ever yields an empty/malformed string, keep the old bezier working.

## src/panel-resize.js

- Panel resizing: the app sidebar, the Settings rail and File Details all share one hairline. Dragging it changes that column's width, the way a macOS split view does. The hairline is invisible until the pointer reaches it, then it doubles in weight and takes the app's focus grey. Keyboard users get the same edge: arrow keys resize, Enter resets, and a small readout appears while adjusting.
- The gallery keeps at least this much room no matter how far a rail is dragged, so a split view never eats the library.
- The islands keep a margin inside their grid track, so the column is larger than the visible panel. Widths are stored and shown as the panel the user actually sees.
- Landing on the responsive default is the same as resetting: keeping a custom width that merely copies the default would stop the rail from following the window's own breakpoints.
- The Settings rail's handle lives inside the rail, so the browser keeps it on the edge as the rail changes width. Only the readout needs the current width.
- Restore widths saved by an earlier drag. The Settings rail is restored when its dialog opens so a closed 0-width dialog cannot clamp it.
- A live drag already owns the width. The resize event dispatched by its own re-layout must not snap the rail back to the last committed value.

## src/select.js

- A select that reads like a field and opens a list of options. The app's dropdowns were native <select> elements, which draw the browser's own menu: no tick beside the chosen option, no description, and no way to hold more than one answer. This is the listbox a design system gives us — a trigger that carries the value, a floating list, a tick beside every chosen option, and the keyboard to drive both. The native element stays in the page and keeps the value, so every place that reads or writes a select keeps working.
- Every list that is on show. A click anywhere else, or a window that changes size, has to reach all of them, so the listeners live here once rather than in each control: a view that draws its inspector again makes a new control every time, and the old ones must not leave listeners behind.
- The popover attribute gives it the top layer, the light dismiss and the Escape, the same way the app's menus behave.
- The list is redrawn when an option is chosen, which takes the clicked item out of the page before the click reaches the document. Keep the choice out of that click, or the outside-click listener would take the list for an outside click and put it away.
- The list opens downwards when it fits, otherwise upwards, and either way it is never taller than the room it has: a long list scrolls inside the window instead of running off the bottom edge.
- Measured once it is on the page: a hidden list has no height.
- Puts the new control in front of a native select and keeps the native element as the value holder, so the code that reads it does not change.
- The native element keeps the value, so the code that focuses it should land on the control the user can see.
- A disabled native select must look and behave disabled in the visible control too, including when the attribute changes later.
- Answers whether any list of options is on show, so a view that is about to redraw its panel can wait until the choice is finished.

## src/settings.js

- The single source of truth for the in-app shortcut reference. The command palette and the Settings pane used to keep separate lists that disagreed.
- The switches describe the resolved appearance, so they follow a theme change made from this pane without waiting for it to be reopened.
- A radiogroup promises arrow-key navigation and one tab stop. The native buttons already handle click/Enter/Space; this adds the missing arrows.
- With no matches the rail is empty but the old pane stayed on screen with no explanation, which looked like a broken search.
- The command palette can start this flow with Settings closed, so the in-pane status line is not enough: mirror every step into a toast.

## src/sidebar.js

- The sidebar's hairline does not change between paints. Reading it from computed style on every hover frame forced a style recalculation while the pointer moved; it is measured once and after a resize instead.
- The viewer keeps the sidebar and File Details on screen, so only the gallery under it is inert. A hidden or drawer-closed sidebar is inert.
- The sidebar is a card with a hairline, and an absolutely placed child starts inside that line, so its width is taken off the offset.
- The sidebar may have just become inert, and the browser drops focus from an element that turns inert. Move focus on the next frame so it lands.
- Track within the window even if the title bar interrupts pointer capture.
- The closing panel is inert. Its visible handle can still be re-grabbed.
- Navigation can replace its button before this event reaches the sidebar.
- A small input in the rail is faster than a sheet for the two things people create constantly. Enter commits, Escape backs out, and the rest of the app still uses the full dialogs when it needs templates or targets.

## src/view-preferences.js

- Arrow navigation is owned by the generic popover handler in app.js so it works uniformly across every menu item. This listener only handles the keys unique to this menu and stops them reaching the document; it must not stop propagation to the app.js listener on this same element.

## src/symbols.js

- Use AppKit masks at the requested size and weight so icons inherit the surrounding text color. Ship PNG masks as the fallback when the native helper is unavailable.
