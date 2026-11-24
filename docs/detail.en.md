# Desktop reminder dsh-reminder-notify

Adds a `notify_user` tool to DeepSeek Harness: a "done" card when a task finishes, a "decide" card before the model needs your call. Bottom-right, with sound, never steals focus, auto-closes on a timer. Cards are drawn by a bundled PowerShell script, so no exe ships.

**Everything is configured in the panel below**: the first row of "Basic" holds the three sample cards, other groups expand when you click their title, and everything else is under "How it works (expand to read)". Release notes live in the README.
- 0.36: custom rules (JSON, validated before saving) and response-speed stats (avg / median / ignored share, split by kind).
- 0.37: cards can carry time buttons (`pickTimes`) — one tap re-fires the same card at that time.
- 0.38: short delays (1 min / 10 min) no longer take their own button — they fold into Snooze (threshold `pickShortMinutes`, default 60 min); later times such as Today 23:00 or Tomorrow 09:00 keep their own button.
