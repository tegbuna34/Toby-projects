/**
 * Blind Score — Google Sheets API.
 *
 * Setup (see README): bind this script to a spreadsheet, set the script property
 * BLIND_SCORE_TOKEN, then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 * Every request must carry the token; without it nothing is read or written.
 */
var ROUND_COLS = ['round_id', 'course_name', 'round_date', 'hole_count', 'starting_nine', 'status', 'created_at', 'completed_at', 'updated_at'];
var HOLE_COLS = ['hole_id', 'round_id', 'hole_number', 'par', 'distance_yards', 'strokes', 'putts', 'tee_penalty_type', 'updated_at', 'note'];
var TEXT_COLS = ['note', 'round_date', 'created_at', 'completed_at', 'updated_at', 'round_id', 'hole_id'];
var NUMBER_COLS = ['hole_count', 'hole_number', 'par', 'distance_yards', 'strokes', 'putts'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('BLIND_SCORE_TOKEN');
    if (!expected || !safeEqual(String(body.token || ''), expected)) return out({ ok: false, error: 'Unauthorized' });
    lock.waitLock(20000);
    if (body.action === 'upsert') {
      upsert('Rounds', ROUND_COLS, body.rounds || []);
      upsert('Holes', HOLE_COLS, body.holes || []);
      return out({ ok: true });
    }
    if (body.action === 'pull') {
      return out({ ok: true, rounds: readAll('Rounds', ROUND_COLS), holes: readAll('Holes', HOLE_COLS) });
    }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sheet(name, cols) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    cols.forEach(function (c, i) {
      if (TEXT_COLS.indexOf(c) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'); // keep dates as text
    });
  } else {
    // Sheets created by an older version: add any columns introduced since (e.g. note).
    var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    cols.forEach(function (c, i) {
      if (have.indexOf(c) === -1) {
        sh.getRange(1, i + 1).setValue(c).setFontWeight('bold');
        if (TEXT_COLS.indexOf(c) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      }
    });
  }
  return sh;
}

/** Insert or replace rows keyed by the first column. Re-sending a row is harmless. */
function upsert(name, cols, records) {
  if (!records.length) return;
  var sh = sheet(name, cols);
  var last = sh.getLastRow();
  var index = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { index[String(r[0])] = i + 2; });
  }
  var appendRows = [];
  records.forEach(function (rec) {
    var row = cols.map(function (c) { return rec[c] === null || rec[c] === undefined ? '' : rec[c]; });
    var at = index[String(rec[cols[0]])];
    if (at) sh.getRange(at, 1, 1, cols.length).setValues([row]);
    else appendRows.push(row);
  });
  if (appendRows.length) sh.getRange(last + 1, 1, appendRows.length, cols.length).setValues(appendRows);
}

function readAll(name, cols) {
  var sh = sheet(name, cols);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    cols.forEach(function (c, i) {
      var v = r[i];
      if (v instanceof Date) v = v.toISOString();
      if (v === '') v = (c === 'distance_yards' || c === 'completed_at') ? null : v;
      if (NUMBER_COLS.indexOf(c) >= 0 && v !== null && v !== '') v = Number(v);
      if (c === 'note') v = String(v);
      o[c] = v;
    });
    return o;
  });
}
