// Date arithmetic uses date-only UTC values, never the visitor's time zone.
export const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const dayNumber = d => Date.parse(d + 'T00:00:00Z') / 86400000;
export const dateAt = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (d, n) => dateAt(dayNumber(d) + n);
export const weekday = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
export function datesBetween(start, end) {
  const a = dayNumber(start), b = dayNumber(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 365) return [];
  return Array.from({length: b - a + 1}, (_, i) => dateAt(a + i));
}
export function performances(shows, dates, selected, after = '', before = '') {
  const result = [];
  for (const date of dates) for (const show of shows) {
    if (!selected.includes(show.id)) continue;
    for (const time of show.week[weekday(date)]) {
      const start = dayNumber(date) * 1440 + minutes(time);
      if (date === dates[0] && after && minutes(time) < minutes(after)) continue;
      if (date === dates.at(-1) && before && minutes(time) + 180 > minutes(before)) continue;
      result.push({id: `${show.id}@${date}@${time}`, showId: show.id, date, time, start, end: start + 180});
    }
  }
  return result.sort((a, b) => a.start - b.start || a.showId.localeCompare(b.showId));
}
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;
export function freePeriods(date, free = {}) {
  const day = free[date] || {};
  if (day.daytime && day.evening) return [{from: 0, to: 1440, label: 'Whole day kept free'}];
  return [...(day.daytime ? [{from: 0, to: 1020, label: 'Before 5pm kept free'}] : []),
          ...(day.evening ? [{from: 1020, to: 1440, label: '5pm onward kept free'}] : [])];
}
export function isKeptFree(event, free = {}) {
  return freePeriods(event.date, free).some(p => overlaps(event, {
    start: dayNumber(event.date) * 1440 + p.from,
    end: dayNumber(event.date) * 1440 + p.to,
  }));
}
export function sortPolicies(policies) {
  const rank = name => /rush/i.test(name) ? 0 : /student|military|under\s*\d/i.test(name) ? 1 : /standing room/i.test(name) ? 2 : /lottery|friday forty/i.test(name) ? 4 : 3;
  return [...policies].sort((a, b) => rank(a.name) - rank(b.name));
}
export function groupReminders(steps) {
  const slots = new Map();
  for (const step of steps) {
    const key = `${step.date}@${step.time}`;
    if (!slots.has(key)) slots.set(key, {date: step.date, time: step.time, start: step.start, items: []});
    const slot = slots.get(key);
    const label = /rush opens$/i.test(step.label) ? 'Rush opens' : step.label;
    const existing = slot.items.find(item => item.showId === step.showId && item.label === label);
    if (existing) {
      existing.forDates = [...new Set([...existing.forDates, ...step.forDates])].sort();
    } else slot.items.push({...step, label, forDates: [...step.forDates]});
  }
  return [...slots.values()].sort((a, b) => a.start - b.start);
}
export function reminders(events, shows) {
  const byId = Object.fromEntries(shows.map(s => [s.id, s]));
  const result = new Map();
  for (const event of events) {
    const show = byId[event.showId];
    for (const [p, policy] of show.policies.entries()) for (const rule of policy.rules) {
      let date = event.date, time = rule.time;
      const wd = weekday(date);
      if (rule.kind === 'offset') date = addDays(date, rule.days);
      if (rule.kind === 'weekBefore') {
        // Hamilton opens one Friday before the Thursday that precedes performance week.
        const weeks = rule.weekday === 4 && rule.label === 'Lottery opens' && /hamilton/i.test(show.name) ? 2 : 1;
        date = addDays(date, -wd - 7 * weeks + rule.weekday);
      }
      if (rule.kind === 'luckyseat') date = addDays(date, wd === 0 ? -3 : wd >= 5 ? 4 - wd : -1);
      if (rule.kind === 'daily') {
        if (!rule.weekdays.includes(wd)) continue;
        if (wd === 6 && rule.sunday) time = rule.sunday;
      }
      if (rule.kind === 'performanceType') time = minutes(event.time) < 17 * 60 ? rule.matinee : rule.evening;
      if (rule.kind === 'relative') {
        const value = event.start + rule.minutes;
        date = dateAt(Math.floor(value / 1440));
        time = `${String(Math.floor(value % 1440 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      }
      if (!time) continue;
      const id = `${show.id}:${p}:${date}:${time}:${rule.label}`;
      const item = result.get(id) || {id, showId: show.id, date, time, label: rule.label, policy: p, forDates: [], start: dayNumber(date) * 1440 + minutes(time)};
      if (!item.forDates.includes(event.date)) item.forDates.push(event.date);
      result.set(id, item);
    }
  }
  return [...result.values()].sort((a, b) => a.start - b.start || a.showId.localeCompare(b.showId));
}
export function recommend(events, priorities, confirmedIds, limit = 3) {
  const fixed = events.filter(e => confirmedIds.includes(e.id));
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    if (overlaps(fixed[i], fixed[j]) || fixed[i].showId === fixed[j].showId)
      return {error: 'Your Confirmed choices overlap or repeat a show. Unconfirm one to generate plans.', plans: []};
  }
  const weight = e => priorities.includes(e.showId) ? 1000 : 10;
  let states = [{items: fixed, score: fixed.reduce((n, e) => n + weight(e), 0), used: new Set(fixed.map(e => e.showId))}];
  const candidates = events.filter(e => !fixed.some(f => f.showId === e.showId || overlaps(f, e)));
  // Bounded beam search keeps the planner responsive without a server or AI.
  for (const event of candidates) {
    const additions = [];
    for (const state of states) {
      if (state.used.has(event.showId) || state.items.some(e => overlaps(e, event))) continue;
      additions.push({items: [...state.items, event], score: state.score + weight(event), used: new Set([...state.used, event.showId])});
    }
    states = [...states, ...additions].sort((a, b) => b.score - a.score || b.items.length - a.items.length).slice(0, 240);
  }
  const plans = [], signatures = new Set();
  for (const state of states) {
    if (!state.items.length) continue;
    const items = [...state.items].sort((a, b) => a.start - b.start);
    const signature = items.map(e => e.id).join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    plans.push({items, score: state.score, priorities: items.filter(e => priorities.includes(e.showId)).length});
    if (plans.length === limit) break;
  }
  return {plans};
}
