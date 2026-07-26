# Punchlist

A self-populating personal to-do PWA. Tasks are harvested daily from texts-to-self,
Apple Reminders, and Google Calendar into a review **Inbox** (structured by Claude
Haiku); quick-add text you type is stored verbatim as a task — exactly as written,
never reworded or split. Everything lives in a Google Sheet behind a Google Apps
Script web app.

- **App:** https://ritchie3237.github.io/punchlist/
- **Backend:** [apps-script/Code.gs](apps-script/Code.gs) — deploy per [SETUP.md](SETUP.md)
- **Home-screen widget:** [scriptable/PunchlistWidget.js](scriptable/PunchlistWidget.js)

## Views

| View  | What it shows |
|-------|---------------|
| Week  | This week's Google Calendar events, read live |
| Inbox | Harvested task suggestions — one-tap approve or dismiss |
| List  | Open tasks grouped by category, check-off, quick-add bar |
| Done  | Recent completions with undo |

Footer shows month-to-date Anthropic API spend, computed from per-request token
counts logged to the Usage tab (the key is dedicated to this app, so it's exact).

## Deploying frontend changes

Bump `CACHE` in [sw.js](sw.js), commit, push. GitHub Pages serves `main`.

Backend changes: paste the new Code.gs into the Apps Script editor, then
Deploy → Manage deployments → New version.
