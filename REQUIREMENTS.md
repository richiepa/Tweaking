# Tweaking — Requirements

## Overview

**Tweaking** is a dead-simple web app for logging how bad you're tweaking (e.g. over a girl) in the moment. Open it, slide to a number, optionally vent in one line or snap a selfie, done. Over time you can look back at a list of your entries and a chart of your spiral.

Anyone can use it from any device via a link. The device can hold several **profiles** (accounts), each with its own private log and optional profile picture. Everything is **stored on the device itself** — no sign-up, no server that ever sees the data.

## Goals

- Logging an entry takes **under 10 seconds** from opening the app.
- Works on any modern device (phone, tablet, laptop) through the browser.
- Installable to the home screen like a real app (PWA).
- Zero friction: no sign-up, no onboarding, no settings required.

## Non-goals

- No social features: no shared feeds, no seeing other people's logs, no leaderboards.
- No cloud accounts or cross-device sync — profiles live on the device they were created on. (Cloud sync via a hosted backend is a possible later upgrade.)
- No native iOS/Android apps.

## Functional requirements

### Logging an entry

1. The main screen is the logging screen — the app opens ready to log.
2. An entry consists of:
   - **Tweak level**: a number from **1.0 to 10.0 in 0.1 steps**, chosen via a fluid slider. Plain numbers only — no emoji scale. The scale escalates visually: the readout and slider shift from quiet tan through orange to red as the level climbs, with a shake animation from 7 up and a red pulse from 9 up (both disabled under `prefers-reduced-motion`).
   - **Note** (optional): a short free-text one-liner (cap: 200 characters).
   - **Photo** (optional): a selfie/pic taken at log time via the camera button (front camera on phones). Downscaled to ≤800px JPEG before storing, on the device only.
   - **Timestamp**: captured automatically at save time.
3. Saving is a single action. A brief confirmation shows the entry saved, then the app is ready for the next log.

### History

4. A history view shows all past entries of the **active profile** as a list, newest first, each showing level, note, photo thumbnail (if any), and when it was logged (relative time for recent entries, date otherwise).
5. A **trend chart** plots the active profile's tweak level over time. It handles both a handful of entries and hundreds gracefully.
6. Any past entry can be **edited** (level, note; photo can be removed but not added later) or **deleted**. Deleting asks for a one-tap confirmation; there is no undo.
7. Tapping an entry selects it: the row highlights and the chart pins that point (crosshair + tooltip), scrolling the chart into view. Tapping again deselects.
8. Tapping an entry's photo thumbnail opens it full-size; tapping again closes it.

### Profiles (accounts)

9. The device holds one or more named profiles. A default profile ("Me") is created on first run, and entries logged before profiles existed are adopted by it.
10. Each profile has a **name** and an optional **profile picture** (downscaled to ≤256px, stored on-device).
11. The header shows the active profile's picture (or initial); tapping it opens the profile panel to **switch, add, edit, or delete** profiles.
12. Each profile sees only its own entries and chart. The active profile is remembered on the device.
13. Deleting a profile requires a one-tap confirmation and deletes its entries; the last remaining profile cannot be deleted. There are no passwords — profiles are for separating logs, not for security.

### Data & privacy

14. All data — entries, photos, profiles — is stored **locally on the device** (IndexedDB). Nothing is ever sent to a server.
15. The app states this plainly (footer: "Your log never leaves this device").
16. Because storage is on-device: clearing browser data wipes everything, and a log does not follow the user to a new device. Accepted trade-off, not a bug.

## Non-functional requirements

### Platform & delivery

17. Delivered as a **Progressive Web App**: a single URL that works in any modern mobile or desktop browser.
18. Installable to the home screen (manifest with name, icon, theme color; standalone display mode).
19. Works **fully offline** after first load. Page loads are network-first with cache fallback so new deploys appear on the next open.

### Usability

20. Dark theme only — one committed charcoal-and-orange look.
21. Mobile-first layout; comfortably usable one-handed at ~400px wide. Also fine on desktop.
22. Fast: interactive in well under 2 seconds on a mid-range phone.
23. No login walls, cookie banners, popups, or interstitials between the user and the slider.

### Tech constraints

24. Static site (HTML/CSS/JS), no build step, no backend, no database server, no auth service.

## Data model

`profiles` store:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `name` | string | ≤ 30 chars |
| `avatar` | Blob or null | JPEG ≤ 256px |
| `createdAt` | timestamp | |

`entries` store:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `profileId` | string | Owning profile |
| `level` | number 1.0–10.0 | One decimal place |
| `note` | string | Optional, ≤ 200 chars |
| `photo` | Blob or null | JPEG ≤ 800px |
| `createdAt` | timestamp | Set at save |
| `updatedAt` | timestamp | Set on edit |

## Out of scope for v1, possible later

- Cloud accounts + sync (log follows you across devices) — needs a hosted backend, e.g. Supabase.
- Export/import of the log (JSON file) for backup or device moves.
- Reminders/notifications.
- Tagging entries by who/what triggered them.
