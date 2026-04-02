#!/usr/bin/env bash
# Upload a local image to the issue-assets branch and print the raw URL.
# Usage: scripts/gh-upload-image.sh <file> <dest-name> [issue-number]
#
# Example:
#   scripts/gh-upload-image.sh ~/Desktop/screenshot.png members-loading 86
#   → https://raw.githubusercontent.com/.../screenshots/issue-86-members-loading.png
#
# Requires: gh (authenticated), python3

set -euo pipefail

REPO="nathanjohnpayne/friends-and-family-billing"
BRANCH="issue-assets"

FILE="${1:?Usage: gh-upload-image.sh <file> <dest-name> [issue-number]}"
DEST_NAME="${2:?Provide a short descriptive name (e.g. members-loading)}"
ISSUE="${3:-}"

if [[ ! -f "$FILE" ]]; then
  echo "Error: file not found: $FILE" >&2
  exit 1
fi

EXT="${FILE##*.}"
if [[ -n "$ISSUE" ]]; then
  DEST_PATH="screenshots/issue-${ISSUE}-${DEST_NAME}.${EXT}"
  COMMIT_MSG="Add screenshot ${DEST_NAME} for issue #${ISSUE}"
else
  DEST_PATH="screenshots/${DEST_NAME}.${EXT}"
  COMMIT_MSG="Add screenshot ${DEST_NAME}"
fi

TMPJSON=$(mktemp /tmp/gh-upload.XXXXXX.json)
trap 'rm -f "$TMPJSON"' EXIT

python3 -c "
import base64, json, sys
with open(sys.argv[1], 'rb') as f:
    b64 = base64.b64encode(f.read()).decode()
json.dump({
    'message': sys.argv[2],
    'content': b64,
    'branch': sys.argv[3]
}, open(sys.argv[4], 'w'))
" "$FILE" "$COMMIT_MSG" "$BRANCH" "$TMPJSON"

gh api "repos/${REPO}/contents/${DEST_PATH}" \
  --method PUT \
  --input "$TMPJSON" \
  --jq '.content.download_url'
