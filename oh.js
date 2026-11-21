// Einfacher Leser für OSM-Öffnungszeiten (opening_hours).
// Liefert für einen Zeitpunkt: true = offen, false = zu, null = unbekannt/zu kompliziert.
// Versteht: "24/7", "Mo-Fr 08:00-20:00; Sa 10:00-14:00; Su off", Zeiten über Mitternacht.
// Alles andere (Monate, Feiertage, sunrise …) gibt null, damit nichts fälschlich als offen gilt.
(function (g) {
  const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const min = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };

  function parseDays(s) {
    const set = new Set();
    for (const part of s.split(",")) {
      const p = part.trim();
      if (p === "PH" || p === "SH") return null;
      const r = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(p);
      if (!r) return null;
      let a = ORDER.indexOf(r[1]); const b = r[2] ? ORDER.indexOf(r[2]) : a;
      for (let i = 0; i < 7; i++) { set.add(ORDER[a]); if (a === b) break; a = (a + 1) % 7; }
    }
    return set;
  }
  function parseTimes(s) {
    const out = [];
    for (const part of s.split(",")) {
      const r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\+?$/.exec(part.trim());
      if (!r) return null;
      const a = min(r[1]), b = min(r[2]);
      if (isNaN(a) || isNaN(b)) return null;
      out.push([a, b]);
    }
    return out;
  }
  // Ergebnis: Array[7] (So=0) mit Liste von [von, bis] oder "off"; null wenn nicht lesbar
  function parse(str) {
    if (!str) return null;
    str = str.trim();
    if (str === "24/7") { const all = []; for (let i = 0; i < 7; i++) all.push([[0, 1440]]); return all; }
    const week = new Array(7).fill(null);
    let any = false;
    for (let rule of str.split(";")) {
      rule = rule.trim().replace(/\s+/g, " ");
      if (!rule) continue;
      let days = null, rest = rule;
      const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH))*)\s*(.*)$/.exec(rule);
      if (m) { days = parseDays(m[1]); rest = m[2].trim(); if (!days) { if (/^(PH|SH)/.test(m[1])) continue; return null; } }
      else if (!/^\d/.test(rule) && !/^(off|closed)$/.test(rule)) return null;
      let val;
      if (/^(off|closed)$/.test(rest)) val = "off";
      else if (rest === "") val = [[0, 1440]];
      else { val = parseTimes(rest); if (!val) return null; }
      const list = days ? [...days] : ORDER;
      for (const d of list) week[DAYS.indexOf(d)] = val;
      any = true;
    }
    if (!any) return null;
    // Tage ohne Regel gelten als geschlossen, sobald irgendeine Tagesregel existiert
    return week.map(v => v === null ? "off" : v);
  }
  function isOpen(str, when) {
    const w = parse(str);
    if (!w) return null;
    const d = when || new Date();
    const day = d.getDay(), t = d.getHours() * 60 + d.getMinutes();
    const today = w[day], yest = w[(day + 6) % 7];
    if (Array.isArray(today)) for (const [a, b] of today) {
      if (b > a ? (t >= a && t < b) : (t >= a)) return true;
    }
    if (Array.isArray(yest)) for (const [a, b] of yest) { if (b <= a && t < b) return true; if (b > 1440 && t < b - 1440) return true; }
    return false;
  }
  // Kurzer Text für heute, z. B. "heute 8–18 Uhr"
  function today(str, when) {
    const w = parse(str);
    if (!w) return null;
    const d = when || new Date();
    const v = w[d.getDay()];
    if (v === "off") return "heute geschlossen";
    if (v.length === 1 && v[0][0] === 0 && v[0][1] >= 1440) return "rund um die Uhr";
    const f = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return h + (mm ? ":" + String(mm).padStart(2, "0") : ""); };
    return "heute " + v.map(([a, b]) => f(a) + "–" + f(b)).join(", ") + " Uhr";
  }
  g.OH = { parse, isOpen, today };
})(typeof window !== "undefined" ? window : globalThis);
