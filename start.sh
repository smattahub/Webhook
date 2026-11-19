#!/usr/bin/env bash
# Starts the GitHub webhook server.
# The first run creates a secret and saves it in .env; later runs reuse it.
#
#   ./start.sh          start the server
#   ./start.sh secret   print the saved secret (to paste into GitHub)

set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"

if [[ ! -f "$ENV_FILE" ]]; then
  secret=$(openssl rand -hex 32)
  (umask 077 && echo "WEBHOOK_SECRET=$secret" > "$ENV_FILE")
  echo "Created a new webhook secret and saved it in $ENV_FILE:"
  echo
  echo "  $secret"
  echo
  echo "Paste it into GitHub: repo Settings -> Webhooks -> your webhook -> Secret."
  echo "Run './start.sh secret' to see it again."
  echo
fi

# Load WEBHOOK_SECRET (and PORT, if you add it) from .env.
set -a
source "$ENV_FILE"
set +a

if [[ -z "${WEBHOOK_SECRET:-}" ]]; then
  echo "WEBHOOK_SECRET is empty in $ENV_FILE. Delete the file and run ./start.sh again." >&2
  exit 1
fi

if [[ "${1:-}" == "secret" ]]; then
  echo "$WEBHOOK_SECRET"
  exit 0
fi

exec node webhook-server.js
