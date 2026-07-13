// Docket — Scriptable home screen widget (dark, at-a-glance)
// Setup (one time, ~3 min):
//  1. Install "Scriptable" from the App Store.
//  2. Open Scriptable → "+" → paste this whole file → name it "Docket".
//  3. Long-press your home screen → "+" → Scriptable → add a LARGE widget.
//  4. Long-press the new widget → Edit Widget → Script: "Docket".
// Tapping the widget opens the Docket site (iOS can't launch the home-screen
// web-app icon directly — that's an Apple limitation, so it opens in Safari).

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMkAjcaqufPej-GsFUfpTMDpKnxJdWFjabgt11HOivKBJ3gpwD_ko22eVOca9F08-uUQ/exec";
const APP_URL = "https://ritchie3237.github.io/punchlist/";

// Dark palette — matches the Docket site's dark theme.
const C = {
  bg: new Color("#101614"),
  ink: new Color("#e8ede9"),
  muted: new Color("#8fa197"),
  accent: new Color("#4ade80"),
};

async function getData() {
  try {
    return await new Request(SCRIPT_URL + "?action=state").loadJSON();
  } catch (e) {
    return null;
  }
}

function text(stack, str, font, color, opts) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  if (opts && opts.center) t.centerAlignText();
  if (opts && opts.limit) t.lineLimit = opts.limit;
  return t;
}

// a centered stat: big number over a small label
function stat(row, num, label) {
  const col = row.addStack();
  col.layoutVertically();
  const nStk = col.addStack();
  nStk.addSpacer();
  text(nStk, String(num), Font.boldSystemFont(40), C.accent);
  nStk.addSpacer();
  const lStk = col.addStack();
  lStk.addSpacer();
  text(lStk, label, Font.mediumSystemFont(13), C.muted);
  lStk.addSpacer();
}

const data = await getData();
const w = new ListWidget();
w.backgroundColor = C.bg;
w.url = APP_URL;
w.setPadding(18, 18, 18, 18);

// centered "Docket" (Do = accent, cket = ink)
const titleRow = w.addStack();
titleRow.addSpacer();
const title = titleRow.addStack();
text(title, "Do", Font.boldSystemFont(24), C.accent);
text(title, "cket", Font.boldSystemFont(24), C.ink);
titleRow.addSpacer();

// prominent, centered daily quote
if (data && data.quote && data.quote.t) {
  w.addSpacer(10);
  const q = w.addText("“" + data.quote.t + "”");
  q.font = Font.semiboldSystemFont(15);
  q.textColor = C.ink;
  q.centerAlignText();
  q.lineLimit = 4;
  if (data.quote.a) {
    w.addSpacer(3);
    const a = w.addText("— " + data.quote.a);
    a.font = Font.mediumSystemFont(12);
    a.textColor = C.muted;
    a.centerAlignText();
  }
}

w.addSpacer();

// counts only (no task list)
if (!data || !data.tasks) {
  const r = w.addStack();
  r.addSpacer();
  text(r, "Couldn’t reach Docket", Font.systemFont(13), C.muted, { center: true, limit: 2 });
  r.addSpacer();
} else {
  const open = data.tasks.filter(function (t) { return t.status === "open"; }).length;
  const inbox = data.tasks.filter(function (t) { return t.status === "inbox"; }).length;
  const row = w.addStack();
  row.addSpacer();
  stat(row, open, open === 1 ? "to-do" : "to-dos");
  row.addSpacer(40);
  stat(row, inbox, "in inbox");
  row.addSpacer();
}

w.addSpacer();
// iOS decides the actual refresh cadence (~15–30 min)
w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);

if (config.runsInWidget) Script.setWidget(w);
else await w.presentLarge();
Script.complete();
