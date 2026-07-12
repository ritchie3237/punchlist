/**
 * Punchlist — self-populating to-do list backend.
 *
 * Endpoints (deploy as Web app: Execute as Me, Anyone has access):
 *  - GET  ?action=state   → all tasks + next 7 days of calendar events + month-to-date API spend
 *  - GET  ?action=widget  → compact JSON for the Scriptable home-screen widget
 *  - POST {action:"quickadd", text}            → Claude parses sloppy text into task(s), added to List
 *  - POST {action:"update", id, status}        → change a task's status (open/done/dismissed/inbox)
 *  - POST {action:"add_inbox", tasks:[...]}    → harvester drops suggested tasks into the Inbox
 *  - POST {action:"harvest_email"}             → run the Gmail scan now (also runs daily via trigger)
 *
 * Setup:
 *  - Anthropic API key in Script Properties (ANTHROPIC_API_KEY / Anthropic_API_Key).
 *  - Run setupTriggers() once from the editor to install the daily 7am email harvest.
 * Tabs (Tasks, Usage, Rules) are created automatically on first use.
 *
 * Least privilege (see appsscript.json oauthScopes): Gmail and Calendar are
 * READ-ONLY (gmail.readonly / calendar.readonly via the advanced services);
 * read/write is limited to this bound spreadsheet (spreadsheets.currentonly).
 * The app is technically incapable of sending, composing, or deleting email.
 */

var CATEGORIES = ["House", "Errands", "Family", "Health", "Admin", "Other"];

// Haiku 4.5 pricing (USD per million tokens) — used for the in-app spend display.
var PRICE_IN_PER_MTOK = 1.0;
var PRICE_OUT_PER_MTOK = 5.0;

// ---------------------------------------------------------------- sheet access

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getTab(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

var TASK_HEADERS = ["id", "title", "category", "status", "source", "source_detail", "due", "created_at", "completed_at"];

function getTasksSheet() {
  return getTab("Tasks", TASK_HEADERS);
}

function getUsageSheet() {
  return getTab("Usage", ["timestamp", "input_tokens", "output_tokens", "cost_usd"]);
}

function getRulesSheet() {
  // Phase 3: standing tasks like "Tennis with kids" / weekly.
  return getTab("Rules", ["title", "category", "frequency", "active"]);
}

function readTasks() {
  var sheet = getTasksSheet();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, TASK_HEADERS.length).getValues();
  return rows.map(function (r, i) {
    var t = { _row: i + 2 };
    TASK_HEADERS.forEach(function (h, j) {
      t[h] = r[j] instanceof Date ? r[j].toISOString() : r[j];
    });
    return t;
  });
}

function appendTask(title, category, status, source, sourceDetail, due) {
  var id = Utilities.getUuid().slice(0, 8);
  getTasksSheet().appendRow([
    id,
    String(title).slice(0, 300),
    CATEGORIES.indexOf(category) >= 0 ? category : "Other",
    status,
    source,
    sourceDetail || "",
    due || "",
    new Date(),
    "",
  ]);
  return id;
}

// Insert suggested tasks into the Inbox, deduping on normalized title vs live tasks.
function insertInboxTasks(tasks, defaultSource) {
  var existing = {};
  readTasks().forEach(function (t) {
    if (t.status === "inbox" || t.status === "open") existing[normTitle(t.title)] = true;
  });
  var added = 0;
  (tasks || []).forEach(function (t) {
    if (!t.title || existing[normTitle(t.title)]) return;
    appendTask(t.title, t.category || "Other", "inbox", t.source || defaultSource || "harvest", t.source_detail || "", t.due || "");
    existing[normTitle(t.title)] = true;
    added++;
  });
  return added;
}

function normTitle(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------- GET

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "state";
  if (action === "widget") return jsonOut(widgetPayload());
  return jsonOut(statePayload());
}

function statePayload() {
  return {
    ok: true,
    tasks: readTasks().map(function (t) {
      delete t._row;
      return t;
    }),
    week: getWeekEvents(),
    usage: { month_cost_usd: monthToDateCost() },
    quote: null, // parked: daily inspirational quote slot
  };
}

function widgetPayload() {
  var open = readTasks().filter(function (t) { return t.status === "open"; });
  var inboxCount = readTasks().filter(function (t) { return t.status === "inbox"; }).length;
  return {
    ok: true,
    quote: null,
    inbox_count: inboxCount,
    tasks: open.slice(0, 12).map(function (t) {
      return { id: t.id, title: t.title, category: t.category, due: t.due };
    }),
  };
}

function getWeekEvents() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  // rolling window: start of today → 7 days out
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
  // Read-only via the advanced Calendar service. minAccessRole "owner" =
  // "My calendars" (calendars Ritchie owns), not subscribed/other calendars.
  var cals = (Calendar.CalendarList.list({ minAccessRole: "owner" }).items) || [];
  var rows = [];
  cals.forEach(function (cal) {
    var resp = Calendar.Events.list(cal.id, {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    (resp.items || []).forEach(function (ev) {
      var st = ev.start || {};
      var allDay = !!st.date; // all-day events carry 'date'; timed carry 'dateTime'
      var when = new Date(st.dateTime || (st.date + "T00:00:00"));
      rows.push({ ev: ev, when: when, allDay: allDay });
    });
  });
  rows.sort(function (a, b) { return a.when - b.when; });
  return rows.map(function (r) {
    return {
      title: r.ev.summary || "(no title)",
      day: Utilities.formatDate(r.when, tz, "EEE"),
      date: Utilities.formatDate(r.when, tz, "MMM d"),
      time: r.allDay ? "" : Utilities.formatDate(r.when, tz, "h:mm a"),
      start: r.when.toISOString(),
    };
  });
}

function monthToDateCost() {
  var sheet = getUsageSheet();
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var rows = sheet.getRange(2, 1, last - 1, 4).getValues();
  var now = new Date();
  var total = 0;
  rows.forEach(function (r) {
    var ts = r[0];
    if (ts instanceof Date && ts.getMonth() === now.getMonth() && ts.getFullYear() === now.getFullYear()) {
      total += Number(r[3]) || 0;
    }
  });
  return Math.round(total * 10000) / 10000;
}

// ---------------------------------------------------------------- POST

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === "quickadd") return handleQuickAdd(d);
    if (d.action === "update") return handleUpdate(d);
    if (d.action === "edit") return handleEdit(d);
    if (d.action === "add_inbox") return handleAddInbox(d);
    if (d.action === "harvest_email") return jsonOut(dailyEmailHarvest());
    return jsonOut({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function handleQuickAdd(d) {
  var text = String(d.text || "").trim();
  if (!text) return jsonOut({ ok: false, error: "Empty text" });

  var parsed = null;
  var parseErr = "";
  try {
    parsed = parseWithClaude(text);
    if (parsed && parsed._err) {
      parseErr = parsed._err;
      parsed = null;
    }
  } catch (err) {
    parseErr = String(err);
    parsed = null; // never lose the input — fall through to raw add
  }

  var added = [];
  if (parsed && parsed.tasks && parsed.tasks.length) {
    parsed.tasks.forEach(function (t) {
      var id = appendTask(t.title, t.category, "open", "quickadd", "", t.due || "");
      added.push({ id: id, title: t.title, category: t.category, due: t.due || "" });
    });
  } else {
    var id = appendTask(text, "Other", "open", "quickadd", "unparsed", "");
    added.push({ id: id, title: text, category: "Other", due: "" });
  }
  return jsonOut({ ok: true, added: added, parsed: !!parsed, parse_error: parseErr });
}

function handleUpdate(d) {
  var allowed = ["open", "done", "dismissed", "inbox"];
  if (allowed.indexOf(d.status) < 0) return jsonOut({ ok: false, error: "Bad status" });
  var tasks = readTasks();
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].id === d.id) {
      var sheet = getTasksSheet();
      sheet.getRange(tasks[i]._row, TASK_HEADERS.indexOf("status") + 1).setValue(d.status);
      sheet
        .getRange(tasks[i]._row, TASK_HEADERS.indexOf("completed_at") + 1)
        .setValue(d.status === "done" ? new Date() : "");
      return jsonOut({ ok: true });
    }
  }
  return jsonOut({ ok: false, error: "Task not found" });
}

// Edit a task's title (and optionally due date) in place.
function handleEdit(d) {
  var title = String(d.title || "").trim();
  if (!title) return jsonOut({ ok: false, error: "Empty title" });
  var tasks = readTasks();
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].id === d.id) {
      var sheet = getTasksSheet();
      sheet.getRange(tasks[i]._row, TASK_HEADERS.indexOf("title") + 1).setValue(title.slice(0, 300));
      if (typeof d.due === "string") {
        sheet.getRange(tasks[i]._row, TASK_HEADERS.indexOf("due") + 1).setValue(d.due);
      }
      return jsonOut({ ok: true });
    }
  }
  return jsonOut({ ok: false, error: "Task not found" });
}

function handleAddInbox(d) {
  var added = insertInboxTasks(d.tasks, "harvest");
  return jsonOut({ ok: true, added: added });
}

// ---------------------------------------------------------------- Gmail harvest

// Runs daily via time trigger (setupTriggers) and on-demand via POST harvest_email.
// Scans the primary inbox for mail that needs handling — insurance notifications,
// bills, renewals, tax/government payment receipts to file — and drops suggested
// tasks into the Inbox for approval.
function dailyEmailHarvest() {
  var props = PropertiesService.getScriptProperties();
  var processed = [];
  try {
    processed = JSON.parse(props.getProperty("PROCESSED_THREADS") || "[]");
  } catch (e) {
    processed = [];
  }

  // Read-only via the advanced Gmail service (gmail.readonly scope) — the app is
  // technically incapable of sending or deleting mail.
  var listResp = Gmail.Users.Messages.list("me", {
    q: "in:inbox category:primary newer_than:7d",
    maxResults: 50,
  });
  var msgRefs = (listResp && listResp.messages) || [];
  var fresh = msgRefs.filter(function (m) {
    return processed.indexOf(m.id) < 0;
  });
  if (!fresh.length) return { ok: true, scanned: 0, added: 0 };

  var tz = Session.getScriptTimeZone();
  var emails = fresh.slice(0, 40).map(function (m, i) {
    var full = Gmail.Users.Messages.get("me", m.id, {
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    var h = {};
    ((full.payload && full.payload.headers) || []).forEach(function (x) {
      h[x.name.toLowerCase()] = x.value;
    });
    var dateStr = "";
    try {
      dateStr = h.date ? Utilities.formatDate(new Date(h.date), tz, "MMM d") : "";
    } catch (e) {}
    var snippet = (full.snippet || "").replace(/\s+/g, " ").slice(0, 400);
    return (
      "EMAIL " + (i + 1) + "\nFrom: " + (h.from || "") +
      "\nDate: " + dateStr +
      "\nSubject: " + (h.subject || "") +
      "\nBody: " + snippet
    );
  });

  var schema = {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short imperative task, e.g. 'Pay GEICO premium' or 'File: NJ estimated tax receipt'" },
            category: { type: "string", enum: CATEGORIES },
            due: { type: "string", description: "YYYY-MM-DD if a deadline is stated, else empty string" },
            source_detail: { type: "string", description: "Short sender name and date, e.g. 'GEICO · Jul 12'" },
          },
          required: ["title", "category", "due", "source_detail"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  };

  var system =
    "You review a day's incoming email for a busy parent and flag ONLY items that need action or filing. " +
    "Flag: insurance notifications and claims, bills or payments due, tax or government payment receipts " +
    "(create a 'File: ...' task so they get stored), renewals, deadlines, school/medical items needing a response. " +
    "Ignore: newsletters, promotions, marketing, social updates, routine shopping receipts, FYI-only mail. " +
    "Return an empty tasks array if nothing qualifies. One task per flagged email.";

  var out = callClaude(system, emails.join("\n\n"), schema);
  var added = 0;
  if (out && !out._err && out.tasks) {
    added = insertInboxTasks(
      out.tasks.map(function (t) {
        t.source = "email";
        return t;
      })
    );
  }

  // remember processed message ids (cap the list so the property stays small)
  fresh.forEach(function (m) { processed.push(m.id); });
  props.setProperty("PROCESSED_THREADS", JSON.stringify(processed.slice(-500)));

  return { ok: true, scanned: fresh.length, added: added, error: out && out._err ? out._err : "" };
}

// Run this ONCE from the editor to install the daily 7am harvest trigger.
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "dailyEmailHarvest") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyEmailHarvest").timeBased().everyDays(1).atHour(7).create();
}

// ---------------------------------------------------------------- Claude helpers

function getAnthropicKey() {
  // Accept common casings — Google's settings UI resisted renaming the property.
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("ANTHROPIC_API_KEY") || props.getProperty("Anthropic_API_Key");
  return key ? key.trim() : null;
}

// One structured-output call to Haiku. Returns the parsed object, or {_err: "..."}.
function callClaude(systemPrompt, userContent, schema) {
  var key = getAnthropicKey();
  if (!key) return { _err: "no ANTHROPIC_API_KEY script property found" };

  var payload = {
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: { type: "json_schema", schema: schema } },
  };

  var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    return { _err: "API HTTP " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300) };
  }
  var data = JSON.parse(res.getContentText());

  if (data.usage) {
    var cost =
      (data.usage.input_tokens / 1e6) * PRICE_IN_PER_MTOK +
      (data.usage.output_tokens / 1e6) * PRICE_OUT_PER_MTOK;
    getUsageSheet().appendRow([new Date(), data.usage.input_tokens, data.usage.output_tokens, cost]);
  }

  if (data.stop_reason === "refusal") return { _err: "refusal" };
  var textBlock = (data.content || []).filter(function (b) { return b.type === "text"; })[0];
  if (!textBlock) return { _err: "no text block in response" };
  return JSON.parse(textBlock.text);
}

function parseWithClaude(text) {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, "EEEE, MMMM d, yyyy");

  var schema = {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short imperative task title, cleaned up" },
            category: { type: "string", enum: CATEGORIES },
            due: {
              type: "string",
              description: "Due date as YYYY-MM-DD if one is stated or implied, else empty string",
            },
          },
          required: ["title", "category", "due"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  };

  var system =
    "You turn one sloppy, unstructured note into a clean personal to-do list entry (or several, " +
    "if the note contains multiple distinct tasks). Today is " + today + ". " +
    "Keep titles short and imperative. Resolve relative dates like 'saturday' or 'before the 4th' " +
    "to YYYY-MM-DD. Do not invent tasks that are not in the note.";

  var out = callClaude(system, text, schema);
  if (out && !out._err && (!out.tasks || !out.tasks.length)) return { _err: "no tasks in parsed output" };
  return out;
}

// ---------------------------------------------------------------- util

function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
