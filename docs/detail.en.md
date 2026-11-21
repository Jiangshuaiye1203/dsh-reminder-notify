# Desktop reminder dsh-reminder-notify

Adds a `notify_user` tool to DeepSeek Harness: the model pops a "done" card when a task finishes and a "decide" card before it needs your call. Bottom-right corner, with sound, never steals focus, auto-closes on a timer.

Cards are drawn by the bundled `host/ReminderHost.ps1` with the built-in PowerShell 5.1, so the package ships no exe and never triggers SmartScreen.

## How to use

- **Just want a different look or stay time**: change the "Basic" group below and press Save.
- **Want to see it now**: press one of the three "try it" buttons; a sample card closes itself after 20 seconds.
- **Want it on your phone**: open push under "Digest & push", pick the format, paste your own webhook URL (WeCom bot or Server Chan), then press "Send one now".
- **Everything else**: folded into "How it works (expand to read)" inside the settings panel below, one topic at a time.
- **For other plugins**: this plugin exposes a `reminder` service (`notify` / `digest` / `stats` / `config`); see the README.
- The self-check now has a **GitHub reachability** item (it flags hosts entries pointing github.com at 127.0.0.1, i.e. the Steam++ acceleration table) plus a **Test GitHub** button; `scripts/github-push.ps1` repairs that state around a push and restores hosts afterwards.
- 0.17 adds scheduled reminders (`at` / `inMinutes`), `decide` priority, a max card lifetime, an "Open link" button with Enter/S/Esc shortcuts, CSV/JSON history export, Telegram/Feishu/DingTalk push formats, and service contract v2.
- 0.18 adds conditional reminders (balance / queue backlog / host failures / quiet hours / daily count, each switchable), native Windows notifications (`toastEnabled`), and a tray icon with a global hotkey (`Ctrl+Alt+R`); the "Reliability: self-check" block starts and stops the tray and sends a test notification.
- 0.19 adds: recurring reminders (`every: "30m"` plus `times`; see the next run and cancel them in History), and a 30-day bar chart of how many reminders each day.
- 0.20 adds: reply straight from the card (`replyEnabled` — type and press Enter, the line goes back to the model, lands in history and can be pushed with `pushReply`), custom buttons (`customButtons`, "label|url" separated by semicolons; a single reminder can carry its own buttons), and Focus Assist muting (`focusAssistMute` — cards still show but stay silent while Focus Assist or presentation mode is on).
- 0.21 adds a phone page: the panel group "Advanced: history, balance, host" shows a LAN URL (guarded by `mobileToken`); open it on a phone in the same Wi-Fi to read recent reminders and send a line back, which lands in history and can be pushed with `pushReply`. No public host, no ICP filing.

- 0.22 adds: the phone page can be installed to the home screen (PWA: icon, standalone window, offline cache); replies sent from the phone are injected into the model's next prompt automatically (consumed once, `GET/POST /dsh-reminder-notify/mobile/inbox` shows or clears the unread ones).

- 0.22.1 fix: on a plain-http LAN address the phone page no longer pretends to be installable as a PWA — over http it explains the manual add-to-home-screen route (Safari share sheete / Chrome menu), and the service worker plus offline cache only engage on https or localhost.
- 0.23 adds: phone replies can carry 1-3 images or voice clips (stored locally under `~/.dsh/dsh-reminder-notify/uploads/`); history shows `files N` and the prompt lists the file names.
