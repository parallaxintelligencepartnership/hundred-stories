# UI polish spec, 2026-09-24

Status: draft for Matt's approval. Nothing here is built yet.

Goal: the game should feel like a 2026 app, not a 2020 web page. The tower is the star; the UI floats over it, stays out of the way, and every control is easy for a young player, a phone thumb, a keyboard or a controller.

## What is wrong today (from the current screenshots)

1. Everything is a box. Square panels, square buttons, hard 1px borders, solid slabs docked to the edges. It reads as a web admin page.
2. On a phone the UI eats the game. The top bar takes three rows, the build palette sits open under the tower all the time, and the tower gets about a third of the screen.
3. Settings is a wall of text. The Controls section is eight paragraphs for every input type at once, the save buttons are a row of equal gray boxes, and the browser's own "Choose File / No file chosen" shows through.
4. Too much monospace. Cash, population, the ticker, rent and scores all use the terminal font, which adds to the dated feel.
5. The bottom ticker is a permanent strip of small gray text.
6. The View buttons (Off, Stress, Noise, Vacancy, Elevator wait) take a whole row on phones for something used now and then.

## Direction

- **Full-bleed tower.** The canvas fills the screen edge to edge. UI floats above it on frosted glass: translucent surface, background blur, 16 to 20 px corners, soft shadow, no hard borders.
- **One compact top bar.** A single floating pill: cash, people, stars, clock and weather icon. Speed becomes one segmented pill with icons (pause, play, fast, faster). Share and Menu become round icon buttons. On phones it is one row.
- **Views in a popover.** One "Views" icon button opens a small popover with icon plus label for each overlay. The active view shows as a small chip under the top bar with an x to turn it off.
- **Build as a dock and a sheet.**
  - Desktop: a slim floating dock on the left with category tabs across the top and item tiles below. It collapses to just icons.
  - Phone: hidden until you tap a big round Build button (bottom right). It opens as a bottom sheet: a category row plus a sideways-scrolling row of items. Drag up for the full grid, and swipe down to close. While you place a room, the sheet shrinks to a small bar showing the item, its cost and Cancel.
- **Panels as cards and sheets.** Room info, finances, stories, log and recap: a floating card on the right on desktop, and a bottom sheet on phones with a grab handle, half and full heights, and swipe down to close.
- **Settings like a phone's settings app.** A sheet with grouped, rounded rows:
  - Game: Today's tower, New game, My tower
  - Saving: "Your tower saves by itself" line, Save now, Save to a file, Open a saved file (a styled button; the browser file picker never shows)
  - Sound: sliders styled to match, a mute switch
  - Display: Theme as a three-way segmented control (Auto, Light, Dark), switches for Reduced motion, Larger text and Color-blind friendly views
  - Help: Intro, How to play, and Controls as a row that opens its own page. That page only shows the controls for the device you are on (touch, mouse and keyboard, or controller), each as a short line with an icon.
- **Notices, not a ticker.** News pops up as a small toast above the bottom edge and fades after a few seconds. Alerts (fire, bankruptcy) stay until tapped. The full history stays in the Log panel.
- **Type.** Bricolage Grotesque everywhere. Monospace is kept only for the clock and money, with tabular figures. One type scale: 12, 14, 16, 20, 28.
- **Motion.** Sheets and cards slide and fade with a spring-like ease (cubic-bezier(0.2, 0.8, 0.2, 1), 200 to 280 ms). Buttons press in slightly. Everything turns into plain fades under reduced motion.
- **Touch.** Every control is at least 44 px. The layout respects safe areas.

## Accessibility (wishlist item 3, built in, not added later)

- Keyboard: every control can be reached with Tab and shows a clear focus ring. Sheets trap focus and Escape closes them. The existing game shortcuts stay.
- Screen readers: every icon button has a label, and toasts go through a polite live region (alerts through an assertive one). Panels are dialogs with titles.
- Larger text: one switch scales all UI text and controls by 1.25.
- Color-blind friendly views: an alternate blue-to-orange overlay palette, with a pattern (stripes or dots) on the worst state so it never relies on color alone.
- Controller: basic Gamepad API support. The left stick or d-pad moves the view, the right stick zooms, A picks, B goes back or closes, the shoulder buttons change speed, and Start opens Menu. It shows a small cursor when a controller is in use.
- Contrast: body text meets WCAG AA on the glass surfaces in both themes. Blur never lowers contrast, because the glass tint is strong enough on its own.

## Build plan (after approval)

1. **Foundation** (one Opus agent): design tokens (radius, glass, shadow, type scale, motion), a shared sheet/card component with focus handling, the toast system, the top bar and the speed pill. Everything else builds on this, so it goes first and alone.
2. **Then two agents in parallel:**
   - A: Settings, the panels as cards and sheets, and the Controls page.
   - B: the build dock and phone build sheet, the Views popover, the accessibility switches and the controller.
3. Screenshots for review: at most 10 named shots per agent, 20 minutes, Chrome closed afterward.

## Not in this pass

- The landing page (already reworked today).
- Game art and the tower rendering.
- New features.
