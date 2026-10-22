#!/bin/sh
# Secret scan: the full git history plus anything not yet committed.
# A non-zero exit blocks the push (see .githooks/pre-push).
set -e
cd "$(git rev-parse --show-toplevel)"
PATH="$HOME/.local/bin:$PATH"
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not found; refusing to continue" >&2
  exit 1
fi
if git rev-parse --verify -q HEAD >/dev/null; then
  gitleaks git --config .gitleaks.toml --redact --no-banner .
fi
gitleaks dir --config .gitleaks.toml --redact --no-banner .
