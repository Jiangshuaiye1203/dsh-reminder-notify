# Desktop reminder dsh-reminder-notify

Adds a `notify_user` tool to DeepSeek Harness: a "done" card when a task finishes, a "decide" card before the model needs your call. Bottom-right, with sound, never steals focus, auto-closes on a timer. Cards are drawn by a bundled PowerShell script, so no exe ships.

**Everything is configured in the panel below**: change the look in "Basic", press a "try it" button to see a sample card instantly, and read the rest under "How it works (expand to read)". Release notes live in the README.
- 0.28: `options` on a decide card — picking one lands in history and in my next-turn context.
- 0.31: a master "Pop-up cards" switch at the top of Basic; the daily digest is no longer repeated within a day, and is skipped on days with no reminders.
- 0.32 adds a “downloads” block (public npm stats) and a “feedback” block (saved locally, one click to open a prefilled GitHub issue).
- 0.33: "Backup & restore" panel block (daily auto backup, export/import/restore) + one-command `scripts/release.ps1`.
- 0.34: decide cards take an “other…” free-text answer, recurring reminders can be limited to weekdays/weekend/picked days, and each kind can be muted (desktop panel and mobile page).
- 0.35: cross-platform — macOS uses osascript and Linux uses notify-send for native notifications (no card buttons, reply box or snooze); doctor gained a native-notifier check.

- 0.35.1: the mobile entry and unread replies are only readable from the host machine or with the token; the manifest no longer leaks the token. Also fixed `hostMode=native` never running on macOS/Linux and recurring jobs ignoring the weekday filter after the first run.
