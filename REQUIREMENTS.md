# Tweaking — Requirements

## Overview

**Tweaking** is a dead-simple web app for logging how bad you're tweaking (e.g. over a girl) in the moment. Open it, slide to a number, optionally vent in one line, done. Over time you can look back at a list of your entries and a chart of your spiral.

Anyone can use it from any device via a link. Each person's log is **private to them and stored on their own device** — there are no accounts, no sign-up, and no server that ever sees the data.

## Goals

- Logging an entry takes **under 10 seconds** from opening the app.
- Works on any modern device (phone, tablet, laptop) through the browser.
- Installable to the home screen like a real app (PWA).
- Zero friction: no accounts, no onboarding, no settings required.

## Non-goals

- No social features: no shared feeds, no seeing other people's logs, no leaderboards.
- No accounts or cross-device sync. A person's log lives on the device they logged it on.
- No tracking who the tweaking is *about* — entries are just level + note.
- No native iOS/Android apps.

## Functional requirements

### Logging an entry

1. The main screen is the logging screen — the app opens ready to log.
2. An entry consists of:
   - **Tweak level**: an integer from **1 to 10**, chosen via a slider or equivalent one-tap control. Plain numbers only — no emoji scale.
   - **Note** (optional): a short free-text one-liner (suggested cap: 200 characters).
   - **Timestamp**: captured automatically at save time. Not user-editable at log time.
3. Saving is a single action (one tap after picking the level). A brief confirmation shows the entry saved, then the app is ready for the next log.

### History

4. A history view shows all past entries as a **list, newest first**, each showing level, note (if any), and when it was logged (relative time like "2h ago" for recent entries, date otherwise).
5. A **trend chart** plots tweak level over time so the user can watch themselves spiral (or recover). It should handle both a handful of entries and hundreds gracefully.
6. Any past entry can be **edited** (level and note) or **deleted**. Deleting asks for a one-tap confirmation; there is no undo.

### Data & privacy

7. All data is stored **locally on the device** (IndexedDB preferred over localStorage for durability and capacity). Nothing is ever sent to a server.
8. The app must state this plainly somewhere visible (e.g. a footer line: "Your log never leaves this device").
9. Because storage is on-device: clearing browser data wipes the log, and a log does not follow the user to a new device. This is an accepted trade-off, not a bug.

## Non-functional requirements

### Platform & delivery

10. Delivered as a **Progressive Web App**: a single URL that works in any modern mobile or desktop browser.
11. Installable to the home screen (web app manifest with name, icon, theme color; standalone display mode).
12. Works **fully offline** after first load (service worker caches the app shell). Logging while offline must work — there's no backend to reach anyway.

### Usability

13. Mobile-first layout; must be comfortably usable one-handed on a ~400px-wide phone screen. Also fine on desktop.
14. Fast: interactive in well under 2 seconds on a mid-range phone.
15. No login walls, cookie banners, popups, or interstitials of any kind between the user and the slider.

### Tech constraints

16. Keep the stack as small as the implementation allows — a static site (HTML/CSS/JS, optionally one small chart library) with no backend is the target architecture. No database server, no API, no auth service.

## Data model

A single store of entries:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique per entry (e.g. UUID) |
| `level` | integer 1–10 | Required |
| `note` | string | Optional, ≤ 200 chars |
| `createdAt` | timestamp | Set automatically at save |
| `updatedAt` | timestamp | Set on edit |

## Assumptions (defaults taken; flag if wrong)

- The trend chart plots individual entries over time (not daily averages). If logs get dense, the chart may aggregate visually but the underlying data stays per-entry.
- Editing an entry does not change its position in history — `createdAt` stays fixed.
- No data export/import in v1. Could be added later (e.g. JSON download) as a cheap insurance policy against the on-device storage trade-off.
- App name is **Tweaking**; branding beyond the name (colors, icon) is left to the design/build phase.

## Out of scope for v1, possible later

- Export/import of the log (JSON file) for backup or device moves.
- Reminders/notifications ("you haven't tweaked in 3 days?").
- Tagging entries by who/what triggered them.
