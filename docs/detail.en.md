# Desktop reminder (dsh-reminder-notify)

Adds a `notify_user` tool to DeepSeek Harness: when work is done (`kind=done`) or a decision is needed (`kind=decide`), a reminder card pops in the bottom-right with the matching voice — never stealing focus, auto-dismissing after N seconds.

The card host is the bundled `host/ReminderHost.ps1`, drawn with the system PowerShell 5.1 + WinForms at run time, so the package ships no exe and is not blocked by SmartScreen or antivirus.

## Settings

Open "Desktop reminder" in the Plugins page; the panel sits right under the description and has four groups:

- **Basics**: duration, position, sound on/off
- **Sounds**: audio directory ("Browse…" picks a directory), the three per-kind file names (wav / mp3). Once a directory is picked the dropdown lists the audio files in it.
- **Look**: background image, title icon, accent colours, title/message templates (`{title}` `{message}` `{kind}` `{time}`), plus per-kind overrides for background, icon and templates
- **Host**: script or exe host, script path, PowerShell path

Changes apply on "Save" — no restart needed.

## Known limits

- Windows only (`os: ["win32"]`): the card host is WinForms.
- Each card spawns a PowerShell process; `Add-Type` compilation takes about 0.6 s before the card appears.
- The card lives with the DSH host process; closing DSH closes a card that is still on screen.
