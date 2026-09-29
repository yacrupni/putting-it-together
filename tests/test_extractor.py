import json
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from update_data import parse_schedule, parse_policies, timing_rules, times

class ExtractorTests(unittest.TestCase):
    def test_noon_midnight_and_minutes(self):
        self.assertEqual(times('12am, noon, 7:30 PM, 12:01am'), ['00:00','12:00','19:30','00:01'])
    def test_schedule_columns_and_blank_cells(self):
        header = '<tr><td>SHOW</td>' + ''.join(f'<td>{d}</td>' for d in ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) + '</tr>'
        rows = ''.join(f'<tr><td>Show {i}</td><td>DARK</td><td>7pm</td><td></td><td>OPENING</td><td>8pm</td><td>2pm, 8pm</td><td>1pm</td></tr>' for i in range(10))
        shows, _ = parse_schedule('<table>' + header + rows + '</table>')
        self.assertEqual(shows[0]['week'], [[],['19:00'],[],[],['20:00'],['14:00','20:00'],['13:00']])
        self.assertEqual(shows[0]['scheduleNotes'][3], 'OPENING')
        with self.assertRaises(ValueError):
            parse_schedule('<table>' + header.replace('Mon','Tue') + rows + '</table>')
    def test_known_stray_source_row_is_filtered(self):
        header = '<tr><td>SHOW</td>' + ''.join(f'<td>{d}</td>' for d in ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) + '</tr>'
        row = '<tr><td>{}</td>' + '<td>7pm</td>' * 7 + '</tr>'
        titles = ['860', '1984'] + [f'Show {i}' for i in range(10)]
        shows, _ = parse_schedule('<table>' + header + ''.join(row.format(title) for title in titles) + '</table>')
        self.assertNotIn('860', [s['name'] for s in shows])
        self.assertIn('1984', [s['name'] for s in shows])

    def test_error_page_rejected(self):
        with self.assertRaises(ValueError): parse_schedule('<html>Access denied</html>')
        with self.assertRaises(ValueError): parse_policies('<html>Access denied</html>')
    def test_special_heading_does_not_overwrite_previous(self):
        section = '<p><a href="https://playbill.com/production/test">Show {}</a> (Theatre - Address)<br>General Rush<br>Price: $40<br>Time: 10 AM<br>Tickets Per Person: 2<br>$30 Under 30<br>Price: $30<br>Time: noon Sunday</p>'
        result = parse_policies('<div class="prose">' + ''.join(section.format(i) for i in range(10)) + '</div>')
        policies = result['show-0']['policies']
        self.assertEqual(len(policies), 2)
        self.assertEqual(policies[0]['fields']['Price'], '$40')
        self.assertEqual(policies[1]['fields']['Price'], '$30')
    def test_overnight_lottery(self):
        rules = timing_rules('Digital Lottery', {'Time':'The lottery will open at 5PM on the day before the performance and close at 9AM the day of the performance.'})
        self.assertEqual([(r['days'],r['time']) for r in rules], [(-1,'17:00'),(0,'09:00')])
    def test_unknown_policy_stays_unconverted(self):
        self.assertEqual(timing_rules('Digital Lottery', {'Time':'See the official website for available dates.'}), [])
    def test_saved_data_is_consistent(self):
        data = json.loads((ROOT / 'data/shows.json').read_text())
        self.assertGreaterEqual(len(data['shows']), 10)
        for show in data['shows']:
            self.assertEqual(len(show['week']), 7)
            for policy in show['policies']:
                self.assertIn('Price', policy['fields'])
                self.assertTrue(all(link['url'].startswith('https://') for link in policy['links']))

if __name__ == '__main__': unittest.main()
