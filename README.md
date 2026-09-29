# Putting It Together

A small Broadway trip planner for you and your friends. Static HTML, CSS, and JavaScript; no AI service, account system, or paid backend.

## Features

- Choose shows and star high priorities.
- Pick trip dates and optional first/last-day availability.
- Browse a calendar in actual date order or a table grouped by day/show.
- Toggle individual shows and rush/lottery times.
- Keep whole days, time before 5pm, or time from 5pm onward free using controls in every planner view. Overlapping three-hour performances are excluded, with Confirmed conflicts surfaced for resolution.
- Open show details for all performances during your trip, ticket policies, addresses, eligibility, and entry links.
- Mark a performance **Confirmed** to keep it fixed in suggested plans.
- Compare a preferred plan and alternatives, with ticket checklists grouped by date/time and backup choices. Simultaneous rush types for a show share one reminder.

Performances use three-hour planning blocks. Plans prioritize starred shows, avoid overlaps, and do not repeat a show. The bounded search produces useful options, not a guarantee of mathematical optimality. Ticket availability is not tracked. Choices are saved only in the current browser's local storage.

## Publish on GitHub Pages

1. Put these files in the repository root, preserving the `.github/workflows`, `data`, `scripts`, and `tests` folders.
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open **Actions → Publish planner → Run workflow** on `main`.
5. After a successful run, the site will be at https://yacrupni.github.io/putting-it-together/ .

If the first run happened before enabling Pages, rerun it after changing the setting. No custom domain is needed.

## Daily refresh

`Refresh Broadway data` runs daily at 11:17 UTC (7:17 a.m. New York during daylight saving time; 6:17 a.m. in winter). You can also run it manually from Actions. GitHub may delay scheduled runs. Public-repository schedules can be disabled after extended inactivity; re-enable them in Actions when needed.

The updater reads Playbill's robots instructions, downloads the two source pages, extracts and validates structured information, and only then replaces `data/shows.json`. A failed download or validation preserves the previous data. GitHub reports failed runs in Actions.

The refresh workflow publishes its own Pages artifact because commits made with GitHub's automatic workflow token do not trigger another push workflow. Repository rules that prohibit direct workflow commits to `main` require an adjusted update process.

## Preview locally

Serve the folder rather than opening `index.html` directly, because the app loads its JSON data:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 . The app has no JavaScript dependencies. Google Fonts are optional; system fonts are the fallback.

## Tests and updating

Node 22+ can run scheduling tests with `npm test`.

To test or run the updater (Python 3.10+):

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
python scripts/update_data.py
```

For offline tests, put saved pages in a folder as `schedule.html` and `policies.html`, then pass `--source-dir /path/to/folder`. Unrecognized timing rules stay readable in show details instead of being guessed into the calendar. If a source changes its layout, the extractor may need maintenance.

## Sources and license

- [Playbill weekly schedule](https://playbill.com/article/weekly-schedule-of-current-broadway-shows)
- [Playbill ticket policies](https://playbill.com/article/broadway-rush-lottery-and-standing-room-only-policies-com-116003)

The MIT license applies to this project's original code. Source content remains attributable to its original publisher. This is an approximate planning tool; information is not independently verified and may be incomplete or inaccurate.
