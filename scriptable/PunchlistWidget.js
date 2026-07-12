// Punchlist — Scriptable home screen widget
// Setup: install "Scriptable" from the App Store, create a new script named
// "Punchlist", paste this file in, and set SCRIPT_URL below. Then add a
// Scriptable widget (large) to your home screen and point it at this script.
// Tapping the widget opens the Punchlist PWA.

const SCRIPT_URL = ""; // paste the Apps Script web app URL here (same as config.js)
const APP_URL = "https://ritchie3237.github.io/punchlist/";
const MAX_TASKS = 9;

const isDark = Device.isUsingDarkAppearance();
const C = {
  bg: isDark ? new Color("#101614") : new Color("#f6f5f1"),
  ink: isDark ? new Color("#e8ede9") : new Color("#1c2420"),
  muted: isDark ? new Color("#8fa197") : new Color("#6b7a72"),
  accent: isDark ? new Color("#4ade80") : new Color("#157a4b"),
};

async function getData() {
  if (!SCRIPT_URL) return null;
  try {
    const req = new Request(SCRIPT_URL + "?action=widget");
    return await req.loadJSON();
  } catch (e) {
    return null;
  }
}

function line(stack, text, font, color) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

const data = await getData();
const w = new ListWidget();
w.backgroundColor = C.bg;
w.url = APP_URL;
w.setPadding(16, 18, 14, 18);

if (data && data.quote) {
  const q = w.addText("“" + data.quote + "”");
  q.font = Font.italicSystemFont(13);
  q.textColor = C.muted;
  q.lineLimit = 2;
  w.addSpacer(8);
}

const header = w.addStack();
line(header, "Punchlist", Font.boldSystemFont(15), C.ink);
header.addSpacer();
if (data && data.inbox_count > 0) {
  line(header, data.inbox_count + " in inbox", Font.mediumSystemFont(12), C.accent);
}
w.addSpacer(8);

if (!data) {
  line(w, SCRIPT_URL ? "Couldn’t reach backend" : "Set SCRIPT_URL in the script", Font.systemFont(13), C.muted);
} else if (!data.tasks.length) {
  line(w, "All clear ✓", Font.systemFont(14), C.muted);
} else {
  for (const t of data.tasks.slice(0, MAX_TASKS)) {
    const row = w.addStack();
    row.centerAlignContent();
    line(row, "○ ", Font.systemFont(13), C.accent);
    line(row, t.title, Font.systemFont(13.5), C.ink);
    row.addSpacer();
    w.addSpacer(4);
  }
  if (data.tasks.length > MAX_TASKS) {
    w.addSpacer(2);
    line(w, "+" + (data.tasks.length - MAX_TASKS) + " more", Font.systemFont(12), C.muted);
  }
}

w.addSpacer();
// refresh roughly every 20 minutes (iOS decides the actual cadence)
w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

if (config.runsInWidget) Script.setWidget(w);
else await w.presentLarge();
Script.complete();
