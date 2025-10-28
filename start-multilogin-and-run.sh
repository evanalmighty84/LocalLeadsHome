#!/usr/bin/env bash
# Usage:
#   MULTILOGIN_TOKEN="..." ./start-multilogin-and-run.sh <PROFILE_ID> "Name Here" "City, ST"

set -euo pipefail

PROFILE_ID="${1:?Usage: $0 <PROFILE_ID> [NAME] [ADDR]}"
NAME="${2:-William Ligon}"
ADDR="${3:-Plano, TX}"
API_BASE="https://launcher.mlx.yt:45001/api/v2/profile/f/default/p"

if [ -z "${MULTILOGIN_TOKEN:-}" ]; then
  echo "ERROR: MULTILOGIN_TOKEN not set. Run: export MULTILOGIN_TOKEN='...'"
  exit 2
fi

echo "🛑 Stopping profile $PROFILE_ID (if running)..."
# Launcher expects GET for stop/start; don't force POST
curl -s "$API_BASE/$PROFILE_ID/stop" \
  -H "Authorization: Bearer $MULTILOGIN_TOKEN" \
  -H "Accept: application/json" || true
sleep 1

echo "🚀 Starting profile $PROFILE_ID (Playwright, headless=false)..."
START_RESP="$(curl -s "$API_BASE/$PROFILE_ID/start?automation_type=playwright&headless_mode=false" \
  -H "Authorization: Bearer $MULTILOGIN_TOKEN" \
  -H "Accept: application/json")"

# BSD/macOS-friendly sed: print the wsEndpoint capture if present
WS="$(printf '%s' "$START_RESP" \
  | tr -d '\n' \
  | sed -n 's/.*"wsEndpoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "$WS" ]; then
  echo "❌ Failed to extract wsEndpoint. Raw response follows:"
  echo "$START_RESP"
  exit 3
fi

echo "✅ Got wsEndpoint:"
echo "$WS"
export MULTILOGIN_WS="$WS"

echo
echo "📡 MULTILOGIN_WS exported. Running 3.js with:"
echo "   NAME=\"$NAME\"  ADDR=\"$ADDR\""
echo

NAME="$NAME" ADDR="$ADDR" node 3.js
