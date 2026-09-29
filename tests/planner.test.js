import test from 'node:test';
import assert from 'node:assert/strict';
import {datesBetween, performances, reminders, recommend, overlaps, weekday} from '../planner.js';
const show = (id, name = id, rules = []) => ({id,name,week:Array.from({length:7},()=>['14:00','19:00']),policies:[{name:'Test',rules}]});
test('trip dates follow dates across week and year boundaries',()=>{
  assert.deepEqual(datesBetween('2026-10-02','2026-10-05'),['2026-10-02','2026-10-03','2026-10-04','2026-10-05']);
  assert.deepEqual(datesBetween('2026-12-31','2027-01-02'),['2026-12-31','2027-01-01','2027-01-02']);
  assert.equal(weekday('2026-10-05'),0);
  assert.deepEqual(datesBetween('2026-10-05','2026-10-02'),[]);
});
test('last-day cutoff accounts for the whole three-hour block',()=>{
  const events=performances([show('a')],['2026-10-02'],['a'],'13:00','17:00');
  assert.deepEqual(events.map(e=>e.time),['14:00']);
  assert.equal(performances([show('a')],['2026-10-02'],['a'],'15:00','20:00').length,0);
});
test('duration stays 180 minutes across daylight-saving dates',()=>{
  const events=performances([show('a')],datesBetween('2026-10-31','2026-11-02'),['a']);
  assert.ok(events.every(e=>e.end-e.start===180)); assert.equal(events.length,6);
});
test('daily lotteries include pretrip deadlines and deduplicate two performances',()=>{
  const s=show('a','A',[{kind:'offset',days:-1,time:'15:00',label:'Lottery closes'}]);
  const r=reminders(performances([s],['2026-10-02'],['a']),[s]);
  assert.equal(r.length,1); assert.equal(r[0].date,'2026-10-01');
});
test('weekend and Monday Lucky Seat deadlines land on Friday',()=>{
  const s=show('a','A',[{kind:'luckyseat',time:'09:30',label:'Lottery closes'}]);
  const r=reminders(performances([s],datesBetween('2026-10-03','2026-10-05'),['a']),[s]);
  assert.equal(r.length,1); assert.equal(r[0].date,'2026-10-02'); assert.equal(r[0].forDates.length,3);
});
test('Hamilton entry opens before Thursday deadline',()=>{
  const s=show('hamilton','Hamilton',[{kind:'weekBefore',weekday:4,time:'10:00',label:'Lottery opens'},{kind:'weekBefore',weekday:3,time:'12:00',label:'Lottery closes'}]);
  const r=reminders(performances([s],['2026-10-02'],['hamilton']),[s]);
  assert.deepEqual(r.map(x=>x.date),['2026-09-18','2026-09-24']);
});
test('Friday Forty uses previous Monday and Friday',()=>{
  const s=show('hp','Harry Potter',[{kind:'weekBefore',weekday:0,time:'00:01',label:'Lottery opens'},{kind:'weekBefore',weekday:4,time:'13:00',label:'Lottery closes'}]);
  const r=reminders(performances([s],['2026-10-02'],['hp']),[s]);
  assert.deepEqual(r.map(x=>x.date),['2026-09-21','2026-09-25']);
});
test('plans include priorities and preserve Confirmed',()=>{
  const events=performances(['a','b','c'].map(id=>show(id)),['2026-10-02'],['a','b','c']);
  const fixed=events.find(e=>e.showId==='a' && e.time==='19:00');
  const {plans}=recommend(events,['c'],[fixed.id]);
  assert.equal(plans.length,3); assert.ok(plans[0].items.some(e=>e.showId==='c'));
  for(const plan of plans){
    assert.ok(plan.items.some(e=>e.id===fixed.id));
    assert.equal(new Set(plan.items.map(e=>e.showId)).size,plan.items.length);
    if(plan.items.length>1) assert.ok(!overlaps(plan.items[0],plan.items[1]));
  }
});
test('conflicting Confirmed choices produce an actionable error',()=>{
  const events=performances([show('a'),show('b')],['2026-10-02'],['a','b']);
  const result=recommend(events,[],events.filter(e=>e.time==='14:00').map(e=>e.id));
  assert.match(result.error,/overlap/); assert.equal(result.plans.length,0);
});

test('ticket checklist merges rush types while retaining distinct times and shows',async()=>{
  const {groupReminders}=await import('../planner.js');
  const step=(showId,time,label)=>({showId,date:'2026-10-29',time,label,start:Number(time.slice(0,2))*60,forDates:['2026-10-29']});
  const result=groupReminders([
    step('gatsby','10:00','General Rush opens'),
    step('gatsby','10:00','Student Rush opens'),
    step('oh-mary','10:00','General Rush opens'),
    step('hadestown','10:00','Lottery closes'),
    step('gatsby','09:00','Digital Rush opens'),
    {...step('gatsby','10:00','Student Rush opens'),date:'2026-10-30',start:2040}
  ]);
  assert.equal(result.length,3);
  assert.equal(result[0].time,'09:00');
  assert.equal(result[1].items.length,3);
  assert.deepEqual(result[1].items.map(x=>x.label),['Rush opens','Rush opens','Lottery closes']);
  assert.equal(result[2].date,'2026-10-30');
});
test('policy ordering puts rush first and lotteries last without mutating source',async()=>{
  const {sortPolicies}=await import('../planner.js');
  const input=['Digital Lottery','Standing Room','Student Tickets','General Rush','Student Rush','Military Tickets','The Friday Forty'].map(name=>({name}));
  assert.deepEqual(sortPolicies(input).map(p=>p.name),['General Rush','Student Rush','Student Tickets','Military Tickets','Standing Room','Digital Lottery','The Friday Forty']);
  assert.equal(input[0].name,'Digital Lottery');
});

test('free periods exclude overlaps, respect boundaries, and restore when toggled off',async()=>{
  const {isKeptFree}=await import('../planner.js');
  const events=performances([show('a')],['2026-10-02'],['a']);
  const daytime={'2026-10-02':{daytime:true}};
  assert.deepEqual(events.filter(e=>!isKeptFree(e,daytime)).map(e=>e.time),['19:00']);
  const evening={'2026-10-02':{evening:true}};
  assert.deepEqual(events.filter(e=>!isKeptFree(e,evening)).map(e=>e.time),['14:00']);
  const lateMatinee={...events[0],start:events[0].start+60,end:events[0].end+60};
  assert.equal(isKeptFree(lateMatinee,evening),true);
  assert.equal(events.filter(e=>!isKeptFree(e,{'2026-10-02':{daytime:true,evening:true}})).length,0);
  assert.equal(events.filter(e=>!isKeptFree(e,{})).length,2);
  assert.equal(isKeptFree(events[0],{'2026-10-03':{daytime:true,evening:true}}),false);
});
test('all suggested plans avoid days kept free',async()=>{
  const {isKeptFree}=await import('../planner.js');
  const events=performances([show('a'),show('b')],datesBetween('2026-10-02','2026-10-03'),['a','b']);
  const free={'2026-10-02':{daytime:true,evening:true}};
  const {plans}=recommend(events.filter(e=>!isKeptFree(e,free)),[],[]);
  assert.ok(plans.length>0);
  assert.ok(plans.every(p=>p.items.every(e=>e.date==='2026-10-03')));
});
