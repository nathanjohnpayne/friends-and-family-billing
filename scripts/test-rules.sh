#!/usr/bin/env bash
# `npm run test:rules` — boots the Firestore emulator and runs the security-rules
# suite (tests/rules/, vitest.rules.config.mjs) against the local firestore.rules.
#
# Needs a Java 21+ runtime (the Firestore emulator is a JVM process) and the
# Firebase CLI. Uses `firebase` from PATH when present, otherwise runs a pinned
# firebase-tools via npx. Extra arguments are forwarded to vitest, e.g.
#   npm run test:rules -- -t "mailQueue"
set -euo pipefail

JAVA_MIN_MAJOR=21

java_major() {
  local banner
  banner="$(java -Duser.language=en -version 2>&1)" || return 1
  printf '%s\n' "$banner" | awk -F'"' '/version "/ { v = $2; sub(/[^0-9].*/, "", v); if (v != "") { print v + 0; exit } }'
}

java_ok() {
  local major
  major="$(java_major)" || return 1
  [ -n "$major" ] && [ "$major" -ge "$JAVA_MIN_MAJOR" ]
}

# macOS ships a /usr/bin/java stub that fails when run, and Homebrew's openjdk
# kegs are not on PATH by default, so probe for a runnable JDK 21+.
if ! java_ok; then
  original_path="$PATH"
  for candidate in \
    "${JAVA_HOME:-}/bin" \
    "$(/usr/libexec/java_home -v "${JAVA_MIN_MAJOR}+" 2>/dev/null || true)/bin" \
    /opt/homebrew/opt/openjdk@21/bin /opt/homebrew/opt/openjdk/bin \
    /usr/local/opt/openjdk@21/bin /usr/local/opt/openjdk/bin; do
    if [ -x "${candidate}/java" ]; then
      PATH="${candidate}:${original_path}"
      export PATH
      if java_ok; then break; fi
      PATH="$original_path"
      export PATH
    fi
  done
  if ! java_ok; then
    echo "test-rules: no Java ${JAVA_MIN_MAJOR}+ runtime found; the Firestore emulator requires one (e.g. brew install openjdk@21)." >&2
    exit 1
  fi
fi

if command -v firebase >/dev/null 2>&1; then
  FIREBASE=(firebase)
else
  FIREBASE=(npx --yes firebase-tools@15)
fi

cmd="vitest run --config vitest.rules.config.mjs"
for arg in "$@"; do
  cmd+=" $(printf '%q' "$arg")"
done

exec "${FIREBASE[@]}" emulators:exec --only firestore --project demo-ffb-rules "$cmd"
