# Desktop reminder (dsh-reminder-notify)

Adds a `notify_user` tool to DeepSeek Harness: when work is done (`kind=done`) or a decision is needed (`kind=decide`), a reminder card pops in the bottom-right with the matching voice — never stealing focus, auto-dismissing after N seconds.

The card host is the bundled `host/ReminderHost.ps1`, drawn with the system PowerShell 5.1 + WinForms at run time, so the package ships no exe and is not blocked by SmartScreen or antivirus.

## Settings

The panel holds only what you might change; the instructions live on this page.

**Three small things at the top**

- A one-line status summary: position · duration · sound, plus `push · serverchan` and `digest · 09:00` when those are on
- **Try it** — three buttons (done card / decision card / plain card) so you can check position, colours and sound
  without waiting for a real reminder. Each sample closes itself in 20 seconds
- **Save** / **Discard** at the bottom; saving applies immediately, no restart

**Common groups** (open by default)

- **Basics**: duration, position, sound on/off
- **Digest & push**: push switch, URL, format, digest switch, digest time; below it today's digest preview and a "send one now" button

**Advanced** (collapsed; click the header to expand)

- **Look**: background image, title icon, accent colours, title/message templates (`{title}` `{message}` `{kind}` `{time}`), plus per-kind overrides
- **Sounds**: audio directory ("Browse…"), the three per-kind file names (wav / mp3)
- **Queue & quiet hours**: spoken alerts, card buttons, snooze minutes, queue on/off and limit, merge window, quiet hours and their behaviour, compact card on fullscreen
- **History, balance & host**: history switch and kept entries (with counts, last 8 entries, refresh / clear), DeepSeek balance (thresholds, interval, spoken alerts, check now, set baseline), host (script or exe, script path, PowerShell path, per-kind cooldown)

## Digest and phone push (0.12+)

- **Daily digest**: with `digestEnabled` on, one card goes out after `digestTime` (default 09:00): how many reminders
  fired today, per kind, how they were handled, plus the current balance if `digestIncludeBalance` is on.
  `digestLastDate` keeps it to one per day; a missed day is not replayed.
- **Volume alert**: with `digestAlertCount` above 0, one extra "a lot of reminders" card fires the first time today
  passes the threshold (`digestAlertDate` keeps it to once a day).
- **Phone push**: `pushEnabled` + `pushUrl` + `pushFormat` — `wecom` (WeCom bot), `serverchan` (ServerChan),
  `json` (generic webhook), `text` (plain text). `pushDecide` and `pushDigest` decide whether decisions and the
  digest are pushed. Delivery is fire-and-forget: 8s timeout, failures only show up in the return value.
  Since 0.12.1 the `errcode` / `code` in the response is parsed, so a WeCom "invalid webhook url" (HTTP 200)
  counts as a failure, and "Send one now" reports the result or the reason in the panel.

## Card behaviour (0.11+)

- **Queue**: one card at a time; later reminders wait in a queue (`queueEnabled` / `queueMax`) instead of stacking.
- **Merge**: the same kind fired again within `mergeWindowMs` (3 s by default) joins the queued entry — bodies are joined line by line, capped at 600 characters.
- **Buttons**: "Got it" closes immediately; "Snooze" re-fires in `snoozeMinutes` (10 by default). Ignoring it just auto-closes.
- **Quiet hours**: with `quietEnabled`, no "done" or plain reminders between `quietStart` and `quietEnd` (midnight crossing supported): `hold` delivers them after the window, `skip` drops them. **"Needs your call" always shows.**
- **Fullscreen fallback**: a narrower card is drawn when a fullscreen app is in front (`compactOnFullscreen`).
- **Speech**: `speakEnabled` reads title and body through `System.Speech` (needs a Chinese voice pack).
- **History**: every reminder result is appended (auto-close / card click / got it / snoozed / quiet-skip) to `~/.dsh/dsh-reminder-notify/history.json`, trimmed to `historyLimit`. The panel shows totals, the last 8 entries, and a Clear button.

## DeepSeek balance alerts

The balance comes from the signed-in DSH account on this machine (host `deepseekAccount` service); no API key is needed.

"20% left" needs a denominator, and the plugin uses a **baseline**: the balance right after the last top-up. The first check records the current balance as the baseline; if the balance later rises above it (a top-up), the baseline is raised automatically. When the balance falls below baseline × threshold%, the card pops (and optionally speaks), once per threshold.

Baseline rules (0.10.1):

- **Recharge wallet only** — bonus credit is shown separately and never counted, so bonus expiry cannot fake a plunge;
- the baseline stores the **account id and set time**: switching DeepSeek accounts resets it, and the panel shows `baseline ¥x (auto/manual · time)`;
- no alert for **30 minutes after a top-up**, and an alert needs **two consecutive readings** below the threshold, which filters out top-up reversals and similar jitter;
- when the balance cannot be read (signed out, service error) the last snapshot is kept and marked stale instead of being treated as ¥0.

## What was verified on a real machine (0.11.1 note)

Verified on Windows 11 · PowerShell 5.1 · 3440×1440 at 125%:

- **Queueing**: a second call while a card is open returns `queued:true, position_in_queue:1`, and it moves up once the first card closes.
- **Merging**: the same kind inside the merge window returns `merged:true, count:2` with one joined body.
- **Card buttons**: clicking "Got it" closes with `action:"ok"` and shows up in history (`elapsedMs:22413` on the real click).
- **Snooze**: when a host returns `{"action":"snooze","snooze":N}` the first record is `snoozed:false`, then the card returns N minutes later and records `snoozed:true`. Checked with a stub host that answers `snooze` immediately (`scriptPath` pointed at it) — same code path a real click takes.
- **Quiet hours**: `raw` inside the window returns `quiet:true`; `skip` returns `skipped:"quiet"` and shows nothing; `hold` re-fires exactly when the window ends (22:30–22:38 window, card appeared 22:38:00, history `quiet:true`); `decide` stays `quiet:false` and is never swallowed.
- **History**: `/dsh-reminder-notify/history` and the panel counters stay in sync, and `byAction` separates `timeout / ok / snooze / dismiss / quiet-skip`.

Not verifiable from code:

- Synthetic clicks cannot reach the card: it is a `WS_EX_NOACTIVATE` window, so `mouse_event` and `PostMessage(WM_LBUTTONDOWN)` never arrive (no `MouseDown` at all). Buttons need a human click; the hit-test maths is covered by unit tests.
- Whether speech is actually audible: logs prove `-Speak` reaches the host and `Microsoft Huihui Desktop (zh-CN)` is installed, but nothing can confirm the speaker played it.

## Known limits

- Windows only (`os: ["win32"]`): the card host is WinForms.
- Each card spawns a PowerShell process; `Add-Type` compilation takes about 0.6 s before the card appears.
- The card lives with the DSH host process; closing DSH closes a card that is still on screen.
