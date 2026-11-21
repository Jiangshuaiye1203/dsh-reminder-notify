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
