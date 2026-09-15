# Tweaking — Requirements

## Overview

**Tweaking** is a dead-simple web app for logging how bad you're tweaking (e.g. over a girl) in the moment. Open it, slide to a number, optionally vent in one line or snap a selfie, done. Over time you can look back at a list of your entries and a chart of your spiral.

Anyone can use it from any device via a link. First-time users **register an account** (username + password, optional profile picture); a device can hold several accounts, each with its own private log. Everything is **stored on the device itself** — no server ever sees the data, passwords included.

## Goals

- Logging an entry takes **under 10 seconds** from opening the app.
- Works on any modern device (phone, tablet, laptop) through the browser.
- Installable to the home screen like a real app (PWA).
- Low friction: one-time register (username + password), then the app opens straight to the slider.

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

### Accounts

9. On first run the app shows a **register screen**: pick a username, a password (min 4 chars), and an optional profile picture. No email, no confirmation field, no recovery flow.
10. Returning to the app while signed in skips login (the session is remembered per device). **Sign out** returns to a login screen listing the device's accounts; logging in or switching accounts requires that account's password.
11. Each account has a **username** (unique per device) and optional **profile picture** (≤256px, on-device). The header shows the active account's picture or initial; tapping it opens the panel to switch, add, edit, sign out, or delete.
12. Each account sees only its own entries and chart.
13. Deleting an account requires typing its password and deletes its entire log. Accounts created before passwords existed are asked to set one on their next login.
14. Honest limits, stated in the UI: accounts live only on this device, there is no password reset, and passwords gate the app's screens — the underlying data is hashed-password-gated, not encrypted, so this is privacy from casual snooping, not real security against someone with the device and technical skill.

### Data & privacy

15. All data — entries, photos, profiles — is stored **locally on the device** (IndexedDB). Nothing is ever sent to a server.
16. The app states this plainly (footer: "Your log never leaves this device").
17. Because storage is on-device: clearing browser data wipes everything, and a log does not follow the user to a new device. Accepted trade-off, not a bug.

## Non-functional requirements

### Platform & delivery

18. Delivered as a **Progressive Web App**: a single URL that works in any modern mobile or desktop browser.
19. Installable to the home screen (manifest with name, icon, theme color; standalone display mode).
20. Works **fully offline** after first load. Page loads are network-first with cache fallback so new deploys appear on the next open.

### Usability

21. Dark theme only — one committed charcoal-and-orange look.
22. Mobile-first layout; comfortably usable one-handed at ~400px wide. Also fine on desktop.
23. Fast: interactive in well under 2 seconds on a mid-range phone.
24. Beyond the one-time register (and login after a sign-out), nothing stands between the user and the slider — no cookie banners, popups, or interstitials, and no login on every open.

### Tech constraints

25. Static site (HTML/CSS/JS), no build step, no backend, no database server, no auth service.

## Data model

`profiles` store:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | UUID |
| `name` | string | Username, unique per device, ≤ 30 chars |
| `passSalt`, `passHash` | string | Salted SHA-256 of the password |
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
