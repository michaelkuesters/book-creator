# Studio settings

## Intent

Operators need personal appearance controls for the local studio—light or dark chrome and a text color that suits them—without tying preferences to a book package or an account.

**Hypothesis:** We believe studio-wide settings stored in the browser will feel like “my studio” and stay out of the manuscript source of truth.

## User-facing behaviour

```gherkin
Scenario: Open settings
  Given any studio page
  When the operator opens Settings
  Then they reach a Settings page for appearance

Scenario: Toggle light and dark
  Given the Settings page
  When the operator chooses Light or Dark
  Then the studio chrome switches theme
  And the choice is remembered on later visits

Scenario: Configure text color
  Given the Settings page
  When the operator sets a text color
  Then the whole UI uses that ink color
  And the choice is remembered on later visits
```

## Feature description

### Musts

- Settings is reachable studio-wide from the shared top bar (`/settings`).
- Operators can toggle Light / Dark mode.
- Operators can configure the whole-UI text color.
- Preferences persist in `localStorage` (`bc.theme`, `bc.ink`) and apply on every page load before paint.
- Theme and ink apply via CSS variables on `html` / `:root`; no server account or SQLite prefs.

### Must nots

- Must not change manuscript or package content.
- Must not require login.
- Must not store appearance prefs in book packages or the database.

### Preferences

- Default theme is Light with the studio’s built-in ink color until the operator changes them.

### Escalation

- If `localStorage` is unavailable, the studio keeps the default Light theme and default ink without erroring.

## Acceptance criteria

1. `GET /settings` returns 200 and exposes light/dark controls and a text-color control.
2. The shared top bar links to Settings from Library and book pages.
3. Covered by `tests/test_app.py` for the Settings page markup.
