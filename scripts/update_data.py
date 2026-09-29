"""Collect Playbill's two planning sources. No AI or browser service required."""
import argparse
import json
import re
import time
import unicodedata
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
URLS = {
    'schedule': 'https://playbill.com/article/weekly-schedule-of-current-broadway-shows',
    'policies': 'https://playbill.com/article/broadway-rush-lottery-and-standing-room-only-policies-com-116003',
}
AGENT = 'PuttingItTogether/1.0 (+https://github.com/yacrupni/putting-it-together)'
# Known stray row in the source table, not a Broadway production.
EXCLUDED_TITLES = {'860'}
TIME = r'(?<!\d)(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b'

def clean(text):
    return ' '.join(text.split())

def key(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    return {'mj-the-musical': 'mj', 'six-the-musical': 'six'}.get(text, text)

def times(text):
    text = re.sub(r'\bnoon\b', '12pm', text, flags=re.I)
    text = re.sub(r'\bmidnight\b', '12am', text, flags=re.I)
    result = []
    for hour, minute, meridian in re.findall(TIME, text, re.I):
        hour, minute = int(hour), int(minute or 0)
        if not 1 <= hour <= 12 or not 0 <= minute <= 59:
            raise ValueError('Invalid source time: ' + text)
        result.append(f'{hour % 12 + (12 if meridian.lower() == "p" else 0):02d}:{minute:02d}')
    return result

def parse_schedule(html):
    soup = BeautifulSoup(html, 'html.parser')
    table = next((t for t in soup.find_all('table') if 'SHOW' in t.get_text()), None)
    if table is None:
        raise ValueError('Schedule table is missing')
    rows = table.find_all('tr')
    header = [clean(c.get_text()) for c in rows[0].find_all(['td', 'th'])]
    if len(header) != 8 or not all(header[i+1].lower().startswith(day) for i, day in enumerate(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])):
        raise ValueError('Schedule columns changed; refusing to replace saved data')
    shows = []
    for row in rows[1:]:
        cells = row.find_all(['td', 'th'], recursive=False)
        if not cells:
            continue
        if len(cells) != 8:
            raise ValueError('Unexpected schedule row width')
        title = clean(cells[0].get_text(' ', strip=True))
        if title in EXCLUDED_TITLES:
            continue
        if not title:
            raise ValueError('Empty show title')
        week, notes = [], []
        for cell in cells[1:]:
            text = clean(cell.get_text(' ', strip=True))
            found = times(text)
            if text and not found and text.upper() not in ('DARK', 'OPENING', 'CLOSED', 'NO PERFORMANCE', '—', '-'):
                raise ValueError(f'Unrecognized schedule cell for {title}: {text}')
            week.append(sorted(set(found)))
            notes.append(text if text and not found and text.upper() != 'DARK' else '')
        shows.append({'id': key(title), 'name': title, 'week': week, 'scheduleNotes': notes})
    if not 10 <= len(shows) <= 70 or len({s['id'] for s in shows}) != len(shows):
        raise ValueError('Unexpected number of shows or duplicate names')
    return shows, header[1:]

def timing_rules(name, fields):
    """Recognize explicit time patterns; retain unfamiliar policies as text."""
    text = fields.get('Time', '')
    low = text.lower()
    tt = times(text)
    rules = []
    if 'lottery' in name.lower() or 'friday forty' in name.lower():
        if 'friday at' in low and 'following thursday' in low:
            return [{'kind': 'weekBefore', 'weekday': 4, 'time': '10:00', 'label': 'Lottery opens'},
                    {'kind': 'weekBefore', 'weekday': 3, 'time': '12:00', 'label': 'Lottery closes'}]
        if 'each monday' in low and 'each friday' in low and 'following week' in low and len(tt) >= 2:
            return [{'kind': 'weekBefore', 'weekday': 0, 'time': tt[0], 'label': 'Lottery opens'},
                    {'kind': 'weekBefore', 'weekday': 4, 'time': tt[1], 'label': 'Lottery closes'}]
        if 'friday before' in low and '9:30' in low:
            return [{'kind': 'luckyseat', 'time': '09:30', 'label': 'Lottery closes'}]
        prior = any(x in low for x in ['day before', 'day prior', 'day the prior'])
        if prior and 'beginning 10:30' in low:
            return [{'kind': 'offset', 'days': -1, 'time': '10:30', 'label': 'Lottery opens'}]
        if prior and len(tt) >= 2 and any(x in low for x in ['close', 'closing', 'cutoff']):
            close_day = 0 if re.search(r'close[^.]*day of the performance', low) else -1
            return [{'kind': 'offset', 'days': -1, 'time': tt[0], 'label': 'Lottery opens'},
                    {'kind': 'offset', 'days': close_day, 'time': tt[1], 'label': 'Lottery closes'}]
    elif 'rush' in name.lower() or 'standing' in name.lower():
        label = name + ' opens'
        if '1/2 hour prior' in low:
            return [{'kind': 'relative', 'minutes': -30, 'label': label}]
        if 'matinees' in low and 'evening' in low and len(tt) == 2:
            return [{'kind': 'performanceType', 'matinee': tt[0], 'evening': tt[1], 'label': label}]
        if 'sunday' in low and len(tt) == 2:
            days = [1, 2, 3, 4, 5, 6] if 'tuesday' in low else list(range(7))
            return [{'kind': 'daily', 'time': tt[0], 'sunday': tt[1], 'weekdays': days, 'label': label}]
        if len(tt) == 1 and not any(w in low for w in ['before', 'prior', 'week']):
            return [{'kind': 'daily', 'time': tt[0], 'weekdays': list(range(7)), 'label': label}]
    return rules

def parse_policies(html):
    soup = BeautifulSoup(html, 'html.parser')
    body = next((p for p in soup.select('.prose') if 'Tickets Per Person' in p.get_text()), None)
    if body is None:
        raise ValueError('Ticket policy content missing')
    result = {}
    current = None
    policy = None
    for paragraph in body.find_all('p', recursive=False):
        production = paragraph.find('a', href=re.compile(r'/production/'))
        if production:
            title = clean(production.get_text(' ', strip=True))
            current = {'name': title, 'venue': '', 'policies': []}
            result[key(title)] = current
            policy = None
        if current is None:
            continue
        links = [{'label': clean(a.get_text(' ', strip=True)), 'url': a['href']} for a in paragraph.find_all('a', href=True)
                 if a['href'].startswith('https://') and '/production/' not in a['href']]
        for br in paragraph.find_all('br'):
            br.replace_with('\n')
        lines = [clean(x) for x in paragraph.get_text().splitlines() if clean(x)]
        if production and lines:
            venue = lines.pop(0)
            current['venue'] = venue[len(title):].strip().strip('()')
        for index, line in enumerate(lines):
            next_line = lines[index + 1] if index + 1 < len(lines) else ''
            if (re.fullmatch(r'[\w /&()–-]*(?:Rush|Lottery|Standing Room|Discounts?)[\w /&()–-]*', line, re.I) and ':' not in line) or (':' not in line and re.match(r'Price\s*:', next_line, re.I)):
                policy = {'name': line, 'fields': {}, 'links': links, 'rules': []}
                current['policies'].append(policy)
                continue
            if policy is not None and ':' in line:
                label, value = line.split(':', 1)
                if len(label) < 40:
                    label = clean(label).title()
                    policy['fields'][label] = clean(value)
    for show in result.values():
        for policy in show['policies']:
            policy['rules'] = timing_rules(policy['name'], policy['fields'])
    if len(result) < 10 or sum(len(s['policies']) for s in result.values()) < 15:
        raise ValueError('Too little policy data; refusing update')
    return result

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': AGENT})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read(5000000).decode('utf-8')

def build(schedule, policies):
    shows, headers = parse_schedule(schedule)
    details = parse_policies(policies)
    for show in shows:
        info = details.get(show['id'], {})
        show['venue'] = info.get('venue', '')
        show['policies'] = info.get('policies', [])
    if sum(bool(s['policies']) for s in shows) < len(shows) * .6:
        raise ValueError('Too few policies matched to shows')
    return {'updatedAt': datetime.now(timezone.utc).isoformat(), 'sources': URLS,
            'sourceWeek': headers, 'durationMinutes': 180, 'shows': shows}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, help='Use saved schedule.html and policies.html for testing')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/shows.json')
    args = parser.parse_args()
    if args.source_dir:
        documents = {name: (args.source_dir / f'{name}.html').read_text() for name in URLS}
    else:
        robots = fetch('https://playbill.com/robots.txt')
        if not re.search(r'^\s*User-agent:', robots, re.I | re.M):
            raise ValueError('Could not read robots instructions')
        rules = urllib.robotparser.RobotFileParser()
        rules.parse(robots.splitlines())
        documents = {}
        for name, url in URLS.items():
            if not rules.can_fetch(AGENT, url):
                raise ValueError('Robots instructions exclude ' + url)
            time.sleep(max(2, rules.crawl_delay(AGENT) or 0))
            documents[name] = fetch(url)
    data = build(documents['schedule'], documents['policies'])
    if args.output.exists():
        old = json.loads(args.output.read_text())
        if len(data['shows']) < len(old['shows']) * .75:
            raise ValueError('Unexpected drop in show count; review source before replacing data')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(args.output)
    print(f"Saved {len(data['shows'])} shows, {sum(len(s['policies']) for s in data['shows'])} ticket policies")
    print('Shows without listed policies: ' + ', '.join(s['name'] for s in data['shows'] if not s['policies']))

if __name__ == '__main__':
    main()
