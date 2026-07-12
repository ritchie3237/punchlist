/**
 * Punchlist — self-populating to-do list backend.
 *
 * Endpoints (deploy as Web app: Execute as Me, Anyone has access):
 *  - GET  ?action=state   → all tasks + this week's calendar events + month-to-date API spend
 *  - GET  ?action=widget  → compact JSON for the Scriptable home-screen widget
 *  - POST {action:"quickadd", text}            → Claude parses sloppy text into task(s), added to List
 *  - POST {action:"update", id, status}        → change a task's status (open/done/dismissed/inbox)
 *  - POST {action:"add_inbox", tasks:[...]}    → harvester drops suggested tasks into the Inbox
 *
 * Setup: store the Anthropic API key under Script Properties as ANTHROPIC_API_KEY.
 * Tabs (Tasks, Usage, Rules) are created automatically on first use.
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
  // "My calendars" only: every calendar Ritchie owns, not subscribed/other calendars.
  var cals = CalendarApp.getAllCalendars().filter(function (c) {
    return c.isOwnedByMe();
  });
  var events = [];
  cals.forEach(function (cal) {
    cal.getEvents(start, end).forEach(function (ev) {
      events.push(ev);
    });
  });
  events.sort(function (a, b) {
    return a.getStartTime() - b.getStartTime();
  });
  return events.map(function (ev) {
    return {
      title: ev.getTitle(),
      day: Utilities.formatDate(ev.getStartTime(), tz, "EEE"),
      date: Utilities.formatDate(ev.getStartTime(), tz, "MMM d"),
      time: ev.isAllDayEvent() ? "" : Utilities.formatDate(ev.getStartTime(), tz, "h:mm a"),
      start: ev.getStartTime().toISOString(),
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
    if (d.action === "add_inbox") return handleAddInbox(d);
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

function handleAddInbox(d) {
  // Harvester entry point (phase 2). Dedupes on normalized title vs live tasks.
  var existing = {};
  readTasks().forEach(function (t) {
    if (t.status === "inbox" || t.status === "open") existing[normTitle(t.title)] = true;
  });
  var added = 0;
  (d.tasks || []).forEach(function (t) {
    if (!t.title || existing[normTitle(t.title)]) return;
    appendTask(t.title, t.category || "Other", "inbox", t.source || "harvest", t.source_detail || "", t.due || "");
    existing[normTitle(t.title)] = true;
    added++;
  });
  return jsonOut({ ok: true, added: added });
}

function normTitle(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------- Claude quick-add parsing

function parseWithClaude(text) {
  // Accept common casings — Google's settings UI resisted renaming the property.
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("ANTHROPIC_API_KEY") || props.getProperty("Anthropic_API_Key");
  if (key) key = key.trim();
  if (!key) return { _err: "no ANTHROPIC_API_KEY script property found" };

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

  var payload = {
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system:
      "You turn one sloppy, unstructured note into a clean personal to-do list entry (or several, " +
      "if the note contains multiple distinct tasks). Today is " + today + ". " +
      "Keep titles short and imperative. Resolve relative dates like 'saturday' or 'before the 4th' " +
      "to YYYY-MM-DD. Do not invent tasks that are not in the note.",
    messages: [{ role: "user", content: text }],
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
  var out = JSON.parse(textBlock.text);
  if (!out.tasks || !out.tasks.length) return { _err: "no tasks in parsed output" };
  return out;
}

// ---------------------------------------------------------------- util

function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
