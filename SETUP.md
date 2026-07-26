# Punchlist — one-time backend setup (~7 minutes)

Tasks live in a Google Sheet in your account, served by a small Google Apps
Script. Google only lets the account owner deploy the script, so these steps
are yours; everything else is already wired up.

## Steps

1. **Create the spreadsheet.** Go to [sheets.google.com](https://sheets.google.com)
   (signed in as ritchie3237@gmail.com), create a blank spreadsheet, name it
   `Punchlist`. (The Tasks/Usage/Rules tabs create themselves on first use.)

2. **Open the script editor.** In the sheet: **Extensions → Apps Script**.

3. **Paste the code.** Delete the placeholder and paste the full contents of
   [`apps-script/Code.gs`](apps-script/Code.gs). Save (Cmd+S).

4. **Add your Anthropic API key** (powers the daily email/Inbox harvest):
   - Get a key at [console.anthropic.com](https://console.anthropic.com) →
     API Keys → Create Key. Name it `punchlist` and use it nowhere else, so
     the in-app spend number stays exact.
   - In the Apps Script editor: **Project Settings (gear) → Script properties
     → Add script property** — name `ANTHROPIC_API_KEY`, value = the key.
   - (If you skip this, quick-add still works — it just saves your text as-is
     without the smart parsing.)

5. **Deploy it.** **Deploy → New deployment**, gear icon → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and authorize (it needs Sheets + Calendar read access —
   click through **Advanced → Go to (project)** if it warns the app is
   unverified; that's because you wrote the script yourself).

6. **Copy the Web app URL** (`https://script.google.com/macros/s/…/exec`) and
   send it to Claude — it goes into [`config.js`](config.js), or edit that
   file yourself on GitHub.

That's it. The app is at **ritchie3237.github.io/punchlist** — open it on your
phone in Safari → Share → **Add to Home Screen**.

## If you ever update the script

Changes to Code.gs go live only after **Deploy → Manage deployments →
(pencil) → Version: New version → Deploy**. The URL stays the same.

## Privacy note

The web app URL is long and unguessable, but anyone who has it can read and
add tasks. Fine for a personal list; don't post the URL publicly. Your API key
lives only in Script Properties — never in this repo.
