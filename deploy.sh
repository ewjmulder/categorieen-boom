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
  --only hosting,firestore:rules \
  --project "$PROJECT_ID" \
  --config firebase.json

SITE_URL="https://${PROJECT_ID}.web.app"

echo
echo "Cacheheaders controleren..."
for path in "/" "/styles.css" "/app.js"; do
  cache_control=""
  attempt=1

  while [ "$attempt" -le 5 ]; do
    cache_control="$(
      curl -fsSI "${SITE_URL}${path}" |
        awk 'BEGIN { IGNORECASE = 1 } /^cache-control:/ { sub(/\r$/, ""); print; exit }'
    )"

    case "$cache_control" in
      *no-store*) break ;;
    esac

    sleep 2
    attempt=$((attempt + 1))
  done

  echo "${path}: ${cache_control:-Cache-Control ontbreekt}"

  case "$cache_control" in
    *no-store*) ;;
    *)
      echo "Onverwachte cacheheader voor ${path}." >&2
      exit 1
      ;;
  esac
done
