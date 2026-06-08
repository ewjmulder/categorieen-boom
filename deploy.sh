#!/bin/sh

set -eu

PROJECT_ID="categorieen-boom"

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI niet gevonden." >&2
  echo "Installeer deze met: npm install -g firebase-tools" >&2
  exit 1
fi

if ! firebase login:list 2>/dev/null | grep -q "@"; then
  firebase login
fi

firebase deploy \
  --only hosting \
  --project "$PROJECT_ID" \
  --config firebase.json
