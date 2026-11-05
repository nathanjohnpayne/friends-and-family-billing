#!/bin/bash -p
# Invoke directly from trusted main, never through npm or `bash script`.
set -euo pipefail
# Fixed interpreter privileged mode ignores BASH_ENV and exported functions.
# No utility runs before this environment replacement.
if [ "${FFB_DEPLOY_SANITIZED:-}" != 1 ]; then
  for name in LD_PRELOAD LD_AUDIT LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH; do
    [ -z "${!name:-}" ] || { printf 'Refusing loader hook: %s\n' "$name" >&2; exit 1; }
  done
  keep=()
  for name in HOME USER LOGNAME LANG LC_ALL TERM GH_TOKEN GH_CONFIG_DIR; do
    [ -z "${!name:-}" ] || keep+=("$name=${!name}")
  done
  exec /usr/bin/env -i "${keep[@]}" FFB_DEPLOY_SANITIZED=1 PATH=/usr/bin:/bin /bin/bash -p "$0" "$@"
fi
for name in $(compgen -e); do
  case " HOME USER LOGNAME LANG LC_ALL TERM GH_TOKEN GH_CONFIG_DIR FFB_DEPLOY_SANITIZED PATH PWD OLDPWD SHLVL _ " in
    *" $name "*) ;;
    *) printf 'Unexpected environment name: %s\n' "$name" >&2; exit 1 ;;
  esac
done
PATH=/usr/bin:/bin
export PATH
umask 077
case "$-" in *p*) ;; *) exit 1 ;; esac
if [ "${1:-}" = --check-entry ]; then printf 'Sanitized entry; no credential acquisition or deployment.\n'; exit 0; fi
# Closed public interface: private controls and arbitrary forwarding are refused
# before any network call, artifact read or credential acquisition.
seen_sha=0; seen_target=0; seen_verify=0
args=("$@")
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) [ "$seen_sha" = 0 ] && [ "$#" -ge 2 ] && [[ "$2" =~ ^[0-9a-f]{40}$ ]] || exit 2; seen_sha=1; shift 2 ;;
    --target) [ "$seen_target" = 0 ] && [ "$#" -ge 2 ] || exit 2; case "$2" in functions|hosting|firestore:rules|storage) ;; *) exit 2 ;; esac; seen_target=1; shift 2 ;;
    --verify-only) [ "$seen_verify" = 0 ] || exit 2; seen_verify=1; shift ;;
    *) echo 'Unsupported deployment argument' >&2; exit 2 ;;
  esac
done
[ "$seen_sha" = 1 ] && [ "$seen_target" = 1 ] || exit 2
set -- "${args[@]}"
SAFE_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
GIT=/usr/bin/git
PYTHON=/usr/bin/python3
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
WORK="$(mktemp -d /tmp/ffb-deploy.XXXXXXXX)"
trap 'chmod -R u+w "$WORK" 2>/dev/null || true; rm -rf "$WORK"' EXIT
DRIVER=
stop_driver() {
  if [ -n "$DRIVER" ]; then
    kill -s "$1" "$DRIVER" 2>/dev/null || true
    wait "$DRIVER" 2>/dev/null || true
  fi
  exit "$2"
}
trap 'stop_driver HUP 129' HUP
trap 'stop_driver INT 130' INT
trap 'stop_driver TERM 143' TERM
mkdir "$WORK/home" "$WORK/run"
# Never load candidate repository configuration. Fetch the fixed public origin
# into a fresh bare database with no includes, hooks, credential or URL rewrites.
git_clean() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME="$WORK/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
    "$GIT" --git-dir="$WORK/repository.git" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c credential.helper= "$@"
}
/usr/bin/env -i PATH="$SAFE_PATH" HOME="$WORK/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  "$GIT" init --quiet --bare "$WORK/repository.git"
git_clean fetch --quiet --no-tags https://github.com/nathanjohnpayne/friends-and-family-billing.git refs/heads/main:refs/remotes/origin/main
MAIN="$(git_clean rev-parse refs/remotes/origin/main)"
[ "$(git_clean hash-object --no-filters "$ROOT/scripts/deploy-artifact.sh")" = "$(git_clean rev-parse "$MAIN:scripts/deploy-artifact.sh")" ] || { echo 'Run the reviewed entrypoint from current main' >&2; exit 1; }
git_clean cat-file blob "$MAIN:scripts/deploy-artifact.py" > "$WORK/run/deploy.py"
git_clean cat-file blob "$MAIN:scripts/check-functions-discovery.cjs" > "$WORK/run/check-functions-discovery.cjs"
# Repository/artifact paths never become Python's import directory.
cd "$WORK/run"
exec_env=(PATH="$SAFE_PATH" HOME="$HOME" FFB_TRUSTED_MAIN="$MAIN")
for name in USER LOGNAME LANG LC_ALL TERM GH_TOKEN GH_CONFIG_DIR; do
  [ -z "${!name:-}" ] || exec_env+=("$name=${!name}")
done
/usr/bin/env -i "${exec_env[@]}" "$PYTHON" -I -S "$WORK/run/deploy.py" --repository-dir "$WORK/repository.git" --work-dir "$WORK" "$@" &
DRIVER=$!
wait "$DRIVER"
