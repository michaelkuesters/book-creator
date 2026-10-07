# Studio settings

## Intent

Operators need personal appearance controls for the local studio—light or dark chrome, plus a writing-area text color that suits long reading and editing—without tying preferences to a book package or an account, and without leaving the page they were on.

**Hypothesis:** We believe a studio-wide settings sheet (not a separate page) stored in the browser will feel like “my studio,” stay out of the manuscript source of truth, and match how other studio prompts already use `<dialog>`. Theme owns the chrome; custom ink belongs only in the chapter writing surface.

## User-facing behaviour

```gherkin
Scenario: Open settings
  Given any studio page
  When the operator opens Settings
  Then a Settings sheet opens for appearance
  And closing it leaves them on the same page

Scenario: Toggle light and dark
  Given the Settings sheet
  When the operator chooses Light or Dark
  Then the studio chrome switches theme using the theme’s default ink
  And the chapter WYSIWYG editor surface matches that theme
  And the choice is remembered on later visits

Scenario: Configure writing text color
  Given the Settings sheet
  When the operator sets a text color
  Then only the chapter writing area uses that ink color
  And the rest of the studio chrome keeps the theme’s default text color
  And the choice is remembered on later visits

Scenario: Scroll under the top bar
  Given Dark or Light theme
  When the operator scrolls a tall Write view
  Then chapter content does not show through or fight the sticky top bar

Scenario: Browser tab icon
  Given any studio page
  When the operator views the browser tab
  Then a Book Creator favicon is shown
```

## Feature description

### Musts

- Settings is reachable studio-wide from the shared top bar as an HTML `<dialog>` sheet (not a separate Settings page).
- Closing the sheet (Close control, Escape, or dismiss) returns the operator to the same page; no Back navigation is required.
- Operators can toggle Light / Dark mode.
- Operators can configure the text color of the chapter writing area (WYSIWYG contents).
- Studio chrome (top bar, nav, sidebars, dialogs, labels) always uses the active theme’s default ink—not the custom writing color.
- Preferences persist in `localStorage` (`bc.theme`, `bc.ink`) and apply on every page load before paint.
- Theme applies via CSS variables on `html` / `:root`. Custom writing ink applies via a separate writing-area variable (for example `--write-ink`), not by overriding chrome `--ink`.
- Dark/Light theme still styles the WYSIWYG chrome (toolbar, surface); only the editable text ink is customizable.
- The sticky top bar uses an opaque theme background so scrolled content does not visually conflict with navbar controls.
- Shared chrome links a Book Creator favicon for the browser tab.
- No server account or SQLite prefs.

### Must nots

- Must not change manuscript or package content.
- Must not require login.
- Must not store appearance prefs in book packages or the database.
- Must not navigate away to a dedicated Settings route for everyday use.
- Must not recolor the whole UI when the operator picks a writing text color.

### Preferences

- Default theme is Light with the theme’s built-in writing ink until the operator changes them.
- `GET /settings` may redirect into the studio with the sheet available rather than rendering a standalone page.

### Escalation

- If `localStorage` is unavailable, the studio keeps the default Light theme and default writing ink without erroring.

## Acceptance criteria

1. Shared chrome includes a Settings control that opens a `<dialog>` with light/dark controls and a writing text-color control.
2. The shared top bar exposes Settings from Library and book pages without requiring a separate Settings URL for normal use.
3. Dark theme styles the WYSIWYG editor surface; custom text color applies to writing contents only; chrome keeps theme default ink; the sticky top bar stays opaque over scrolled Write content.
4. Shared chrome serves a Book Creator favicon for browser tabs.
5. Covered by `tests/test_app.py` for Settings sheet markup and favicon in shared chrome.
