import {datesBetween, addDays, weekday, minutes, performances, reminders, recommend, overlaps, groupReminders, sortPolicies, freePeriods, isKeptFree} from './planner.js?v=3';

const app = document.querySelector('#app');
const dialog = document.querySelector('#details');
const palette = ['#b44635', '#466c65', '#78618e', '#967128', '#416b91', '#9f4c70', '#54783d', '#a35d2c'];
let data, shows = [], byId = {}, allEvents = [], state;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const prettyDate = (d, opts = {}) => new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', ...opts}).format(new Date(d + 'T12:00:00Z'));
const prettyTime = t => `${Number(t.slice(0,2)) % 12 || 12}${t.slice(3) === '00' ? '' : ':' + t.slice(3)}${Number(t.slice(0,2)) >= 12 ? 'pm' : 'am'}`;
const color = id => palette[shows.findIndex(s => s.id === id) % palette.length];
const isFixed = id => state.confirmed.includes(id);
function freshState() {
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {screen:'setup',selected:[],priorities:[],confirmed:[],hidden:[],start:today,end:addDays(today,3),after:'',before:'',view:'calendar',group:'day',deadlines:false,free:{}};
}
function save() { try {localStorage.setItem('putting-it-together-v1', JSON.stringify(state));} catch {} }
function dates() { return datesBetween(state.start, state.end); }
function getEvents() {return performances(shows, dates(), state.selected, state.after, state.before);}
function findEvent(id) { const show = byId[id.split('@')[0]]; return show && performances([show], dates(), [show.id], state.after, state.before).find(e => e.id === id); }
function freeTimeControls() {
  const conflicts = getEvents().filter(e => isFixed(e.id) && isKeptFree(e, state.free));
  return `<section class="free-time"><div class="free-time-heading"><h2>Keep some time free</h2><p>Toggle any period on or off. Shows overlapping those hours are left out of your calendar and plans.</p></div><div class="free-days">${dates().map(date => {
    const free = state.free[date] || {};
    return `<div class="free-day"><b>${prettyDate(date, {weekday:'short'})}</b><div>${[['all','Whole day',free.daytime && free.evening],['daytime','Before 5pm',free.daytime],['evening','5pm onward',free.evening]].map(([slot,label,active]) => `<button data-action="free" data-date="${date}" data-id="${slot}" aria-label="Keep ${prettyDate(date, {weekday:'short'})} ${label.toLowerCase()} free" aria-pressed="${Boolean(active)}" class="${active ? 'active' : ''}">${active ? '✓ ' : ''}${label}</button>`).join('')}</div></div>`;
  }).join('')}</div></section>${conflicts.length ? `<div class="free-conflict" role="status"><p>A Confirmed performance overlaps time you’re keeping free. Reopen that period or unconfirm the performance to generate plans.</p>${conflicts.map(e => `<div><span>${esc(byId[e.showId].name)} · ${prettyDate(e.date)} · ${prettyTime(e.time)}</span><button class="text-button" data-action="confirm" data-id="${esc(e.id)}">Unconfirm</button></div>`).join('')}</div>` : ''}`;
}
function freeTimeShading(date, startHour, endHour) {
  return freePeriods(date, state.free).map(p => {
    const from = Math.max(p.from, startHour * 60), to = Math.min(p.to, endHour * 60);
    return to > from ? `<div class="free-shading" style="top:${(from-startHour*60)*64/60}px;height:${(to-from)*64/60}px"><span>${p.label}</span></div>` : '';
  }).join('');
}
function infoButton(id, label = 'Ticket info') {return `<button class="text-button" data-action="info" data-id="${esc(id)}">${esc(label)} ↗</button>`;}
function choice(s) {
  const checked = state.selected.includes(s.id), priority = state.priorities.includes(s.id);
  return `<div class="show-choice ${checked ? 'chosen' : ''}"><label><input type="checkbox" data-select="${esc(s.id)}" ${checked ? 'checked' : ''}><span>${esc(s.name)}</span></label><button class="star ${priority ? 'active' : ''}" data-action="star" data-id="${esc(s.id)}" aria-label="High priority: ${esc(s.name)}" aria-pressed="${priority}">${priority ? '★' : '☆'}</button>${infoButton(s.id, 'Policies')}</div>`;
}
function tripFields() {
  return `<div class="date-fields"><label>First day<input type="date" id="start" value="${esc(state.start)}" required></label><span class="date-arrow">→</span><label>Last day<input type="date" id="end" value="${esc(state.end)}" required></label></div><details class="availability" ${state.after || state.before ? 'open' : ''}><summary>Only available for part of your first or last day?</summary><div class="date-fields"><label>First day: available after<input type="time" id="after" value="${esc(state.after)}"></label><label>Last day: free until<input type="time" id="before" value="${esc(state.before)}"></label></div></details>`;
}
function setup() {
  app.innerHTML = `<section class="setup"><div class="setup-intro"><div><p class="eyebrow">LET’S MAKE A LITTLE THEATRE TIME</p><h1>So many shows.<br><em>One great trip.</em></h1><p class="intro-copy">Pick your possibilities. Star your can’t-miss shows.<br>We’ll help you put the pieces together.</p></div><div class="ticket-stamp" aria-hidden="true"><span>NEW YORK CITY</span><b>YOUR<br>NEXT<br>ACT.</b><span>ADMIT YOUR POSSIBILITIES</span></div></div><div class="section-heading"><h2><span class="step">01</span> What’s on your list?</h2><span id="selection-count">${state.selected.length} selected · ★ high priority</span></div><div class="show-grid">${shows.map(choice).join('')}</div><form id="trip-form" class="trip-form"><div><h2><span class="step">02</span> When’s your trip?</h2><p>Choose the dates you want to see on your calendar.</p></div><div>${tripFields()}<p id="form-error" class="error" role="alert"></p></div><button class="primary" type="submit">Put it together <span>↗</span></button></form></section>`;
  document.querySelector('#trip-form').addEventListener('submit', e => {
    e.preventDefault();
    state.start = document.querySelector('#start').value;
    state.end = document.querySelector('#end').value;
    state.after = document.querySelector('#after').value;
    state.before = document.querySelector('#before').value;
    let error = !state.selected.length ? 'Choose at least one show to start planning.' : !dates().length ? 'Choose a last day on or after your first day, within one year.' : '';
    if (!error && state.start === state.end && state.after && state.before && state.after >= state.before) error = 'Your available-until time must be later than your available-after time.';
    if (error) {document.querySelector('#form-error').textContent = error; return;}
    state.confirmed = state.confirmed.filter(id => getEvents().some(e => e.id === id));
    state.screen = 'planner'; save(); render(); window.scrollTo(0, 0);
  });
}
function planner() {
  allEvents = getEvents().filter(e => !isKeptFree(e, state.free));
  const selected = shows.filter(s => state.selected.includes(s.id));
  app.innerHTML = `<section class="planner"><div class="planner-top"><div><p class="eyebrow">YOUR BROADWAY LINEUP</p><h1>${prettyDate(state.start)} <span class="dash">—</span> ${prettyDate(state.end, {year: 'numeric'})}</h1><p>${dates().length} ${dates().length === 1 ? 'day' : 'days'} in New York · ${selected.length} shows on your list</p></div><button class="secondary" data-action="edit">Edit shows & dates</button></div><div class="workspace"><aside><div class="sidebar-heading"><h2>Your shows</h2><span>${selected.length}</span></div><p class="small muted">Toggle to change the view.<br>★ gives a show higher priority in plans.</p><div class="sidebar-shows">${selected.map(s => `<div class="sidebar-show" style="--show-color:${color(s.id)}"><label><input type="checkbox" data-visible="${esc(s.id)}" ${state.hidden.includes(s.id) ? '' : 'checked'}><span>${esc(s.name)}</span></label><button class="star ${state.priorities.includes(s.id) ? 'active' : ''}" data-action="star" data-id="${esc(s.id)}" aria-label="High priority: ${esc(s.name)}" aria-pressed="${state.priorities.includes(s.id)}">${state.priorities.includes(s.id) ? '★' : '☆'}</button></div>`).join('')}</div><div class="sidebar-note"><span class="mini-mark">✓</span><p><b>Confirmed = fixed in your plan.</b><br>Use it for a ticket you have—or a possibility you want to build around.</p></div><button class="text-button" data-action="edit">+ Change your shortlist</button></aside><section class="workspace-main"><div class="toolbar"><nav class="tabs" aria-label="Planner views">${[['calendar','Calendar'], ['table','Table'], ['plans','Suggested plans']].map(([v, t]) => `<button data-action="tab" data-id="${v}" aria-pressed="${state.view === v}" class="${state.view === v ? 'active' : ''}">${t}</button>`).join('')}</nav>${state.view === 'calendar' ? `<label class="toggle"><input type="checkbox" id="deadlines" ${state.deadlines ? 'checked' : ''}>Rush & lottery times</label>` : state.view === 'table' ? `<label class="group-label">Group by <select id="group"><option value="day" ${state.group === 'day' ? 'selected' : ''}>Day</option><option value="show" ${state.group === 'show' ? 'selected' : ''}>Show</option></select></label>` : ''}</div><div id="view"></div>${freeTimeControls()}</section></div></section>`;
  if (state.view === 'calendar') renderCalendar();
  if (state.view === 'table') renderTable();
  if (state.view === 'plans') renderPlans();
}
function render() { state.screen === 'planner' && state.selected.length && dates().length ? planner() : setup(); }
function eventButton(e, cls = '') {
  return `<button class="${cls}" data-action="event" data-id="${esc(e.id)}" style="--show-color:${color(e.showId)}"><strong>${esc(byId[e.showId].name)}</strong><span>${prettyTime(e.time)}${isFixed(e.id) ? ' · ✓ Confirmed' : ''}</span></button>`;
}
function reminderSlot(slot) {
  return `<div class="reminder-slot"><time>${prettyTime(slot.time)}</time><div>${slot.items.map(r => `<button class="reminder-item" data-action="info" data-id="${esc(r.showId)}">${esc(byId[r.showId].name)} <span>· ${esc(r.label)}</span></button>`).join('')}</div></div>`;
}
function checklist(slots) {
  const days = [...new Set(slots.map(s => s.date))];
  return `<div class="grouped-checklist">${days.map(date => `<section class="checklist-day"><h4>${prettyDate(date, {weekday:'short'})}${date < state.start ? '<small>Before your trip</small>' : ''}</h4>${slots.filter(s => s.date === date).map(reminderSlot).join('')}</section>`).join('')}</div>`;
}
function tripPerformances(s) {
  if (!dates().length) return '';
  const events = performances([s], dates(), [s.id], state.after, state.before).filter(e => !isKeptFree(e, state.free));
  return `<section class="trip-performances"><h3>During your trip</h3><p class="small muted">${prettyDate(state.start)} – ${prettyDate(state.end)} · Your available times</p>${events.length ? [...new Set(events.map(e => e.date))].map(date => `<div class="trip-performance-day"><b>${prettyDate(date, {weekday:'short'})}</b><div>${events.filter(e => e.date === date).map(e => `<button class="performance-choice ${isFixed(e.id) ? 'on' : ''}" data-action="event" data-id="${esc(e.id)}">${prettyTime(e.time)}${isFixed(e.id) ? ' · ✓ Confirmed' : ''}</button>`).join('')}</div></div>`).join('') : '<p class="small muted">No performances fit your trip dates and availability.</p>'}</section>`;
}
function layout(events) {
  const ends = [], positioned = [];
  for (const e of events) {
    let lane = ends.findIndex(end => end <= e.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = e.end; positioned.push({...e, lane});
  }
  return {positioned, lanes: Math.max(1, ends.length)};
}
function renderCalendar() {
  const visible = allEvents.filter(e => !state.hidden.includes(e.showId));
  const steps = groupReminders(reminders(visible, shows)), before = steps.filter(r => r.date < state.start);
  const startHour = Math.min(12, ...visible.map(e => Math.floor(minutes(e.time) / 60)));
  const endHour = Math.max(23, ...visible.map(e => Math.ceil((minutes(e.time) + 180) / 60)));
  const height = (endHour - startHour) * 64;
  const dayLayouts = dates().map(date => ({date, ...layout(visible.filter(e => e.date === date))}));
  const columns = `55px ${dayLayouts.map(d => `minmax(${Math.max(210, Math.min(660, d.lanes * 106))}px,1fr)`).join(' ')}`;
  document.querySelector('#view').innerHTML = `${state.deadlines && before.length ? `<details class="before-trip"><summary>↗ Before your trip <span>${before.length} time slots</span></summary>${checklist(before)}</details>` : ''}<div class="calendar-scroll"><div class="calendar" style="grid-template-columns:${columns}"><div class="time-column"><div class="day-heading">NYC</div>${state.deadlines ? '<div class="deadline-rack axis-label">TICKET<br>TIMES</div>' : ''}<div class="hour-axis" style="height:${height}px">${Array.from({length: endHour - startHour}, (_, i) => `<span style="top:${i * 64}px">${prettyTime(String(i+startHour).padStart(2,'0')+':00')}</span>`).join('')}</div></div>${dayLayouts.map(({date, positioned, lanes}) => `<div class="calendar-day"><div class="day-heading"><span>${prettyDate(date, {weekday:'short'}).split(',')[0]}</span><b>${prettyDate(date)}</b></div>${state.deadlines ? `<div class="deadline-rack">${steps.filter(r => r.date === date).map(reminderSlot).join('') || '<span class="small muted">No timed ticket steps</span>'}</div>` : ''}<div class="day-track" style="height:${height}px">${freeTimeShading(date, startHour, endHour)}${positioned.map(e => `<div class="event-position" style="top:${(minutes(e.time)-startHour*60)*64/60}px;height:188px;left:${e.lane / lanes *100}%;width:${100/lanes}%">${eventButton(e, `calendar-event ${isFixed(e.id) ? 'fixed' : ''}`)}</div>`).join('')}${!positioned.length && !freePeriods(date, state.free).length ? '<p class="day-empty">A little breathing room.</p>' : ''}</div></div>`).join('')}</div></div><p class="view-hint">Click a performance for ticket options and to mark it Confirmed. Scroll sideways for more dates.</p>${!visible.length ? '<p class="empty">No performances to display. Try showing more of your selected shows or adjusting your dates.</p>' : ''}`;
}
function renderTable() {
  const visible = allEvents.filter(e => !state.hidden.includes(e.showId));
  const groups = state.group === 'day' ? dates().map(d => [prettyDate(d, {weekday:'long'}), visible.filter(e => e.date === d)]) : shows.filter(s => state.selected.includes(s.id) && !state.hidden.includes(s.id)).map(s => [s.name, visible.filter(e => e.showId === s.id)]);
  document.querySelector('#view').innerHTML = `<div class="table-view">${groups.map(([title, events]) => `<section><h2>${esc(title)}</h2>${events.length ? `<table><thead><tr><th>${state.group === 'day' ? 'Show' : 'Date'}</th><th>Start</th><th>Plan</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${events.map(e => `<tr><td><span class="dot" style="background:${color(e.showId)}"></span>${state.group === 'day' ? esc(byId[e.showId].name) : prettyDate(e.date, {weekday:'short'})}</td><td>${prettyTime(e.time)}</td><td><button class="confirm ${isFixed(e.id) ? 'on' : ''}" data-action="confirm" data-id="${esc(e.id)}" aria-pressed="${isFixed(e.id)}">${isFixed(e.id) ? '✓ Confirmed' : 'Confirm'}</button></td><td><button class="text-button" data-action="event" data-id="${esc(e.id)}">Details ↗</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No performances in your available time.</p>'}</section>`).join('')}</div>`;
}
function renderPlans() {
  if (getEvents().some(e => isFixed(e.id) && isKeptFree(e, state.free))) {
    document.querySelector('#view').innerHTML = '<p class="empty muted">Resolve the Confirmed choice below to see suggested plans.</p>';
    return;
  }
  const result = recommend(allEvents, state.priorities, state.confirmed);
  if (result.error) {document.querySelector('#view').innerHTML = `<p class="error empty">${esc(result.error)}</p>`; return;}
  document.querySelector('#view').innerHTML = `<div class="plans-intro"><p class="eyebrow">A FEW WAYS TO PUT IT TOGETHER</p><h2>Your trip, with possibilities.</h2><p>High priorities first, no overlapping three-hour blocks, and your Confirmed choices kept in place. Plans use your whole shortlist, including shows hidden from the calendar.</p></div>${result.plans.length ? result.plans.map((plan, i) => {
    const steps = groupReminders(reminders(plan.items, shows));
    const picked = new Set(plan.items.map(e => e.id));
    const different = i ? plan.items.filter(e => !result.plans[0].items.some(f => f.id === e.id)) : [];
    return `<article class="plan"><div class="plan-heading"><span class="plan-number">0${i+1}</span><div><h2>${i ? `Alternative ${i}` : 'Preferred plan'}</h2><p>${plan.items.length} shows${plan.priorities ? ` · ${plan.priorities} high ${plan.priorities === 1 ? 'priority' : 'priorities'}` : ''}</p></div></div><p class="plan-reason">${i ? (different.length ? `Another arrangement: ${esc(different.map(e => `${byId[e.showId].name} on ${prettyDate(e.date)} at ${prettyTime(e.time)}`).join('; '))}.` : 'A lighter version of your preferred plan.') : `This combination fits ${plan.items.length} different shows${plan.priorities ? `, including ${plan.priorities} of your starred choices` : ''}, without overlapping performances.`}</p><div class="plan-list">${plan.items.map(e => {
      const rest = plan.items.filter(f => f.id !== e.id);
      const backups = allEvents.filter(b => b.date === e.date && !picked.has(b.id) && !rest.some(f => f.showId === b.showId || overlaps(f, b))).sort((a,b) => Number(state.priorities.includes(b.showId))-Number(state.priorities.includes(a.showId))).slice(0,3);
      return `<div class="plan-item"><div class="plan-date"><b>${prettyDate(e.date, {weekday:'short'})}</b><span>${prettyTime(e.time)}</span></div><div class="plan-show">${eventButton(e, 'plan-event')}<div class="plan-policy-links">${byId[e.showId].policies.length ? esc([...new Set(sortPolicies(byId[e.showId].policies).map(p => p.name))].join(' · ')) : 'See show details for source links'}</div>${!isFixed(e.id) && backups.length ? `<details class="backups"><summary>If this doesn’t work out…</summary>${backups.map(b => `<p><button class="text-button" data-action="event" data-id="${esc(b.id)}">${esc(byId[b.showId].name)} · ${prettyTime(b.time)} ↗</button></p>`).join('')}<p class="small muted">Check backup entry deadlines ahead of time; a lottery may close before your first result arrives.</p></details>` : ''}</div><button class="confirm ${isFixed(e.id) ? 'on' : ''}" data-action="confirm" data-id="${esc(e.id)}" aria-pressed="${isFixed(e.id)}">${isFixed(e.id) ? '✓ Confirmed' : 'Confirm'}</button></div>`;
    }).join('')}</div><details class="plan-checklist"><summary>Your ticket checklist <span>${steps.length} time slots</span></summary><p class="small">Choose which ticket options to attempt; these are alternatives, not a requirement to do them all. Click a step for eligibility, purchase windows, and entry links.</p>${steps.length ? checklist(steps) : '<p>No timed ticket steps are listed for these shows.</p>'}<p class="small">For ticket options without a fixed time, open the show’s policy details.</p></details></article>`;
  }).join('') : '<p class="empty">No shows fit these dates and available times. Edit your trip to explore more options.</p>'}`;
}
function openDetails(id, eventId) {
  const s = byId[id]; if (!s) return;
  const event = eventId && findEvent(eventId);
  document.querySelector('#details-content').innerHTML = `<p class="eyebrow">THE DETAILS</p><h2 id="details-title">${esc(s.name)}</h2><p class="venue">${esc(s.venue || 'Venue not listed in the ticket-policy source.')}</p>${event ? `<div class="performance-detail"><div><b>${prettyDate(event.date, {weekday:'long'})} · ${prettyTime(event.time)}</b><p>Three-hour planning block</p></div><button class="confirm ${isFixed(event.id) ? 'on' : ''}" data-action="confirm" data-id="${esc(event.id)}" aria-pressed="${isFixed(event.id)}">${isFixed(event.id) ? '✓ Confirmed' : 'Mark Confirmed'}</button></div><p class="small muted">Confirmed keeps this performance fixed when generating plans.</p>` : ''}${tripPerformances(s)}<div class="policies">${s.policies.length ? sortPolicies(s.policies).map(p => `<section><div class="policy-heading"><h3>${esc(p.name)}</h3><span>${esc(p.fields.Price || '')}</span></div><dl>${Object.entries(p.fields).filter(([k])=>k !== 'Price').map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="policy-links">${[...new Map(p.links.map(l=>[l.url,l])).values()].map(l=>`<a class="external" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || 'Entry website')} ↗</a>`).join('')}</div></section>`).join('') : '<p>No ticket policy is listed for this show in the saved source.</p>'}</div><a class="external" href="${esc(data.sources.policies)}" target="_blank" rel="noopener">Open Playbill’s ticket-policy guide ↗</a>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
document.querySelector('#close-dialog').onclick = () => dialog.close();
dialog.addEventListener('click', e => {if (e.target === dialog) dialog.close();});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]'); if (!b || !state) return;
  const {action, id} = b.dataset;
  if (action === 'start-over') {document.querySelector('#reset-dialog').showModal(); return;}
  if (action === 'cancel-reset') {document.querySelector('#reset-dialog').close(); return;}
  if (action === 'reset') {
    document.querySelector('#reset-dialog').close();
    if (dialog.open) dialog.close();
    state = freshState(); allEvents = []; save(); render();
    window.scrollTo(0, 0);
    const heading = app.querySelector('h1');
    if (heading) {heading.tabIndex = -1; heading.focus({preventScroll:true});}
    return;
  }
  if (action === 'info') {openDetails(id); return;}
  if (action === 'event') {const item = findEvent(id); if (item) openDetails(item.showId,id); return;}
  if (action === 'star') {
    state.priorities = state.priorities.includes(id) ? state.priorities.filter(x=>x!==id) : [...state.priorities,id];
    if (!state.selected.includes(id)) state.selected.push(id);
  }
  if (action === 'free') {
    const date = b.dataset.date;
    const day = state.free[date] || {daytime:false, evening:false};
    if (id === 'all') { const active = !(day.daytime && day.evening); day.daytime = active; day.evening = active; }
    else day[id] = !day[id];
    state.free[date] = day;
  }
  if (action === 'edit') state.screen = 'setup';
  if (action === 'tab') state.view = id;
  if (action === 'confirm') {
    const item = findEvent(id);
    if (!item) return;
    if (!state.selected.includes(item.showId)) state.selected.push(item.showId);
    state.confirmed = isFixed(id) ? state.confirmed.filter(x=>x!==id) : [...state.confirmed,id];
    if (dialog.open) dialog.close();
  }
  save(); render();
});
document.addEventListener('change', e => {
  if (!state) return;
  const t = e.target;
  if (t.dataset.select) {
    const id = t.dataset.select;
    state.selected = t.checked ? [...new Set([...state.selected,id])] : state.selected.filter(x=>x!==id);
    if (!t.checked) {state.priorities=state.priorities.filter(x=>x!==id); state.confirmed=state.confirmed.filter(x=>!x.startsWith(id+'@'));}
  } else if (t.dataset.visible) state.hidden = t.checked ? state.hidden.filter(x=>x!==t.dataset.visible) : [...new Set([...state.hidden,t.dataset.visible])];
  else if (t.id === 'deadlines') state.deadlines = t.checked;
  else if (t.id === 'group') state.group = t.value;
  else if (['start','end','after','before'].includes(t.id)) {state[t.id]=t.value; save(); return;}
  else return;
  save(); render();
});
async function init() {
  try {
    const response = await fetch('./data/shows.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('Data could not be loaded');
    data = await response.json(); shows = data.shows; byId = Object.fromEntries(shows.map(s=>[s.id,s]));
    state = freshState();
    try {
      const stored = JSON.parse(localStorage.getItem('putting-it-together-v1') || 'null');
      if (stored && Array.isArray(stored.selected) && Array.isArray(stored.priorities) && Array.isArray(stored.confirmed) && Array.isArray(stored.hidden)) {
        state = {...state,...stored};
        if (!state.free || typeof state.free !== "object" || Array.isArray(state.free)) state.free = {};
        for (const k of ['selected','priorities','hidden']) state[k]=state[k].filter(id=>byId[id]);
        if (!['calendar','table','plans'].includes(state.view)) state.view='calendar';
        if (!dates().length) state.screen='setup';
        state.confirmed=state.confirmed.filter(id=>getEvents().some(e=>e.id===id));
      }
    } catch {}
    document.querySelector('#updated').textContent = 'Data refreshed ' + new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'}).format(new Date(data.updatedAt));
    render();
  } catch (error) {
    app.innerHTML = '<div class="empty"><h1>The curtain hasn’t lifted yet.</h1><p>We couldn’t load the show list. Please reload the page in a moment.</p><button class="secondary" id="retry">Try again</button></div>';
    document.querySelector('#retry').onclick=init;
  }
}
init();
