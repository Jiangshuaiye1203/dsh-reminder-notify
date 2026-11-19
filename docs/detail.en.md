# Desktop reminder (dsh-reminder-notify)

Adds a `notify_user` tool to DeepSeek Harness: when work is done (`kind=done`) or a decision is needed (`kind=decide`), a reminder card pops in the bottom-right with the matching voice — never stealing focus, auto-dismissing after N seconds.

The card host is the bundled `host/ReminderHost.ps1`, drawn with the system PowerShell 5.1 + WinForms at run time, so the package ships no exe and is not blocked by SmartScreen or antivirus.

## Settings

Open "Desktop reminder" in the Plugins page; the panel sits right under the description and has five groups:

- **Basics**: duration, position, sound on/off
- **Sounds**: audio directory ("Browse…" picks a directory), the three per-kind file names (wav / mp3). Once a directory is picked the dropdown lists the audio files in it.
- **Look**: background image, title icon, accent colours, title/message templates (`{title}` `{message}` `{kind}` `{time}`), plus per-kind overrides for background, icon and templates
- **Host**: script or exe host, script path, PowerShell path

Changes apply on "Save" — no restart needed.

- **DeepSeek balance**: enable, thresholds (20/10/5 % by default), check interval, spoken alerts; the panel can check now and set the current balance as the baseline

## DeepSeek balance alerts

The balance comes from the signed-in DSH account on this machine (host `deepseekAccount` service); no API key is needed.

"20% left" needs a denominator, and the plugin uses a **baseline**: the balance right after the last top-up. The first check records the current balance as the baseline; if the balance later rises above it (a top-up), the baseline is raised automatically. When the balance falls below baseline × threshold%, the card pops (and optionally speaks), once per threshold.

Baseline rules (0.10.1):

- **Recharge wallet only** — bonus credit is shown separately and never counted, so bonus expiry cannot fake a plunge;
- the baseline stores the **account id and set time**: switching DeepSeek accounts resets it, and the panel shows `baseline ¥x (auto/manual · time)`;
- no alert for **30 minutes after a top-up**, and an alert needs **two consecutive readings** below the threshold, which filters out top-up reversals and similar jitter;
- when the balance cannot be read (signed out, service error) the last snapshot is kept and marked stale instead of being treated as ¥0.

## Known limits

- Windows only (`os: ["win32"]`): the card host is WinForms.
- Each card spawns a PowerShell process; `Add-Type` compilation takes about 0.6 s before the card appears.
- The card lives with the DSH host process; closing DSH closes a card that is still on screen.
