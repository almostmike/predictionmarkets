#!/bin/zsh
# launchd entry point for the daily session (CLAUDE.md "Daily session", phase 9).
#   scripts/daily.sh            scheduled run: only starts between 09:00 and 10:59 PT, once per day
#   scripts/daily.sh --check    report what a run would do right now, without running it
#   scripts/daily.sh --force    run now regardless of the window (still once per day)
set -u
REPO="${PM_REPO:-$HOME/Code/predictionmarkets}"
export PATH="$HOME/.local/bin:$HOME/.local/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO" || exit 1
mkdir -p logs
DATE=$(TZ=America/Los_Angeles date +%F)
HHMM=${PM_NOW_HHMM:-$(TZ=America/Los_Angeles date +%H%M)}
MODE=${1:-}
note() { print -r -- "$(date '+%F %T') $*" >> logs/launchd.log; [[ $MODE == --check ]] && print -r -- "$*"; }

# A run that starts after 11:00 PT (for example, launchd catching up after the Mac wakes) does nothing.
if [[ $MODE != --force ]] && (( 10#$HHMM < 900 || 10#$HHMM >= 1100 )); then
  note "outside the 09:00-11:00 PT window ($HHMM); skipping $DATE"; exit 0
fi
if [[ -e logs/ran-$DATE ]]; then note "already ran $DATE; skipping"; exit 0; fi
if ! command -v claude >/dev/null; then note "claude CLI not found; skipping $DATE"; exit 1; fi
if [[ $MODE == --check ]]; then note "would run the daily session for $DATE now ($HHMM PT)"; exit 0; fi

if ! mkdir logs/.lock 2>/dev/null; then note "another run holds logs/.lock; skipping"; exit 0; fi
trap 'rmdir logs/.lock 2>/dev/null' EXIT
touch logs/ran-$DATE
LOG=logs/session-$DATE.log
note "starting the daily session for $DATE"
{
  git pull --ff-only -q || { print "git pull failed; not running"; exit 1; }
  claude -p "$(<ops/daily-prompt.md)" --max-turns 250 < /dev/null
  print "claude exit $?"
} >> "$LOG" 2>&1
note "finished $DATE (log: $LOG)"
