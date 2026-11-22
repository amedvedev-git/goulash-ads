#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID == 0 && $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Run via sudo on the Selectel x86_64 host.' >&2; exit 1; }
exec 9>/run/lock/goulash-ads-deploy.lock
flock -n 9 || { echo 'Another ads deployment is running.' >&2; exit 1; }
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export GOULASH_DEPLOY_LOCKED=1
exec "${GOULASH_BOOTSTRAP_NODE:-/opt/goulash-ads/bin/node}" "$release/deploy/manage-release.ts" update "$release"
