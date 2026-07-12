// Docket — Scriptable home screen widget
// Setup (one time, ~3 min):
//  1. Install "Scriptable" from the App Store.
//  2. Open Scriptable → "+" → paste this whole file → name it "Docket".
//  3. Long-press your home screen → "+" → Scriptable → add a LARGE widget.
//  4. Long-press the new widget → Edit Widget → Script: "Docket".
// Tapping the widget opens the Docket app. SCRIPT_URL is already filled in.

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMkAjcaqufPej-GsFUfpTMDpKnxJdWFjabgt11HOivKBJ3gpwD_ko22eVOca9F08-uUQ/exec";
const APP_URL = "https://ritchie3237.github.io/punchlist/";
const MAX_TASKS = 8;

const isDark = Device.isUsingDarkAppearance();
const C = {
  bg: isDark ? new Color("#101614") : new Color("#f6f5f1"),
  ink: isDark ? new Color("#e8ede9") : new Color("#1c2420"),
  muted: isDark ? new Color("#8fa197") : new Color("#6b7a72"),
  accent: isDark ? new Color("#4ade80") : new Color("#157a4b"),
};

async function getData() {
  try {
    const req = new Request(SCRIPT_URL + "?action=widget");
    return await req.loadJSON();
  } catch (e) {
    return null;
  }
}

function line(stack, text, font, color, limit) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = color;
  if (limit) t.lineLimit = limit;
  return t;
}

const data = await getData();
const w = new ListWidget();
w.backgroundColor = C.bg;
w.url = APP_URL;
w.setPadding(16, 18, 14, 18);

// daily quote
if (data && data.quote && data.quote.t) {
  const q = w.addText("“" + data.quote.t + "”  —" + (data.quote.a || ""));
  q.font = Font.italicSystemFont(12);
  q.textColor = C.muted;
  q.lineLimit = 3;
  w.addSpacer(8);
}

// header: Docket + inbox count
const header = w.addStack();
header.centerAlignContent();
const doStk = header.addStack();
line(doStk, "Do", Font.boldSystemFont(15), C.accent);
line(doStk, "cket", Font.boldSystemFont(15), C.ink);
header.addSpacer();
if (data && data.inbox_count > 0) {
  line(header, data.inbox_count + " in inbox", Font.mediumSystemFont(12), C.accent);
}
w.addSpacer(8);

if (!data) {
  line(w, "Couldn’t reach Docket", Font.systemFont(13), C.muted, 2);
} else if (!data.tasks.length) {
  line(w, "All clear ✓", Font.systemFont(14), C.muted);
} else {
  for (const t of data.tasks.slice(0, MAX_TASKS)) {
    const row = w.addStack();
    row.centerAlignContent();
    line(row, "○  ", Font.systemFont(13), C.accent);
    line(row, t.title, Font.systemFont(13.5), C.ink, 1);
    row.addSpacer();
    w.addSpacer(4);
  }
  if (data.tasks.length > MAX_TASKS) {
    w.addSpacer(2);
    line(w, "+" + (data.tasks.length - MAX_TASKS) + " more", Font.systemFont(12), C.muted);
  }
}

w.addSpacer();
// iOS decides the actual refresh cadence (~15–30 min)
w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

if (config.runsInWidget) Script.setWidget(w);
else await w.presentLarge();
Script.complete();
