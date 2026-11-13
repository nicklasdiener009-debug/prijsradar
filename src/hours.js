// Reads OpenStreetMap opening hours such as "Mo-Sa 08:00-22:00; Su 10:00-20:00"
// and tells whether a store is open right now (Amsterdam time).

const DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

function parseDays(text) {
  const set = new Set();
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(mo|tu|we|th|fr|sa|su)(?:\s*-\s*(mo|tu|we|th|fr|sa|su))?$/);
    if (!m) continue; // public holidays and anything else are ignored
    const a = DAYS.indexOf(m[1]);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { set.add(i); if (i === b) break; }
  }
  return set;
}

// -> array of 7 days, each a list of [openMinute, closeMinute]; null when unreadable
export function parseHours(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().trim();
  const week = Array.from({ length: 7 }, () => []);
  if (s === '24/7') return week.map(() => [[0, 1440]]);
  let any = false;
  for (const rule of s.split(/;|,(?=\s*(?:mo|tu|we|th|fr|sa|su)\b)/)) {
    const r = rule.trim();
    if (!r) continue;
    const m = r.match(/^([a-z ,\-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+|off|closed)$/);
    if (!m) continue;
    const days = m[1].trim() ? parseDays(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days.size) continue;
    const spans = [];
    if (m[2] !== 'off' && m[2] !== 'closed') {
      for (const t of m[2].matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
        const a = +t[1] * 60 + +t[2];
        let b = +t[3] * 60 + +t[4];
        if (b <= a) b += 1440; // closes after midnight
        spans.push([a, b]);
      }
    }
    for (const d of days) week[d] = spans; // a later rule replaces an earlier one
    any = true;
  }
  return any ? week : null;
}

function amsterdamNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 2)), minute: (+parts.hour % 24) * 60 + +parts.minute };
}
const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const cache = new Map();
// -> { open: true, closes: '22:00' } | { open: false, opens: '08:00', inDays: 0|1|… } | null (unknown)
export function openStatus(text, date = new Date()) {
  if (!text) return null;
  if (!cache.has(text)) cache.set(text, parseHours(text));
  const week = cache.get(text);
  if (!week) return null;
  const { day, minute } = amsterdamNow(date);
  for (const [a, b] of week[(day + 6) % 7]) if (b > 1440 && minute < b - 1440) return { open: true, closes: hhmm(b) };
  for (const [a, b] of week[day]) if (minute >= a && minute < b) return { open: true, closes: hhmm(b) };
  for (let i = 0; i < 7; i++) {
    const next = week[(day + i) % 7].filter(([a]) => i > 0 || a > minute).sort((x, y) => x[0] - y[0])[0];
    if (next) return { open: false, opens: hhmm(next[0]), inDays: i };
  }
  return { open: false };
}
