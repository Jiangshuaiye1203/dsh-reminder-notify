# Desktop reminder dsh-reminder-notify

Adds a `notify_user` tool to DeepSeek Harness: the model pops a "done" card when a task finishes and a "decide" card before it needs your call. Bottom-right corner, with sound, never steals focus, auto-closes on a timer.

Cards are drawn by the bundled `host/ReminderHost.ps1` with the built-in PowerShell 5.1, so the package ships no exe and never triggers SmartScreen.

## How to use

- **Just want a different look or stay time**: change the "Basic" group below and press Save.
- **Want to see it now**: press one of the three "try it" buttons; a sample card closes itself after 20 seconds.
- **Want it on your phone**: open push under "Digest & push", pick the format, paste your own webhook URL (WeCom bot or Server Chan), then press "Send one now".
- **Everything else**: folded into "How it works (expand to read)" inside the settings panel below, one topic at a time.
- **For other plugins**: this plugin exposes a `reminder` service (`notify` / `digest` / `stats` / `config`); see the README.
