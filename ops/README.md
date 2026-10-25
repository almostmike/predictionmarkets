# Scheduling (phase 9)

The daily session runs at 9:00 am on the operator's Mac through launchd, calling `scripts/daily.sh`. That script:
- starts only between 09:00 and 10:59 PT;
- runs at most once a day;
- skips the day if the Mac was off or asleep, including when launchd catches up late after a wake;
- pulls `main`, then runs `claude -p` with `ops/daily-prompt.md`.

The headless agent's tool permissions are in `.claude/settings.json`. It may run the project's scripts, write the journal and `.cache/`, and commit and push. It may not edit the mandate, strategy, config, code, or tests, may not read `.env`, and has no web access.

Logs are in `logs/` (gitignored):
- `launchd.log`: one line per trigger;
- `session-YYYY-MM-DD.log`: the full run.

## Install or reinstall
```sh
sed "s#__REPO__#$HOME/Code/predictionmarkets#g" ops/com.almostmike.predictionmarkets.daily.plist > ~/Library/LaunchAgents/com.almostmike.predictionmarkets.daily.plist
launchctl bootout gui/$(id -u)/com.almostmike.predictionmarkets.daily 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.almostmike.predictionmarkets.daily.plist
```

## Pause or remove
- To skip sessions without uninstalling, create `logs/ran-YYYY-MM-DD` for the day.
- To stop orders entirely, create a `STOP` file in the repo root (the executor rejects every order).
- To remove the job: `launchctl bootout gui/$(id -u)/com.almostmike.predictionmarkets.daily`

## Check
- `scripts/daily.sh --check` says what a run would do right now.
- `launchctl print gui/$(id -u)/com.almostmike.predictionmarkets.daily` shows the job.
