# Qanoot Jahangir

Costs, income and profit for every collection and dress — an installable app for Android (and iPhone),
backed by a Google Sheet.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `style.css` | The app |
| `themes.js` | The 10 colour themes (5 light, 5 dark) |
| `config.js` | **Paste your Apps Script Web app URL here** |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and work offline |

The Google Apps Script server code (`Code.gs`) is kept separately, inside your Google Sheet.

## Users and access

Users are managed in the **Users** sheet of the Google Sheet:

| Name | Access Code | Active |
|---|---|---|
| Nabeel | (at least 6 characters) | TRUE |

* To remove someone's access, set **Active** to `FALSE` — they are signed out on their next sync.
* Names are not case-sensitive; access codes are.
* After 8 wrong codes for the same name, that name is locked for 15 minutes.

## Updating the app

Upload the new files to this repository (replacing the old ones). Phones pick up the update
automatically the next time the app is opened.
