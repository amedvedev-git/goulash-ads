#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID == 0 && $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Use root on Linux x64.' >&2; exit 1; }
exec 9>/run/lock/goulash-ads-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ ${1:-} == --config && -n ${2:-} ]] || { echo 'Usage: install-clean.sh --config /etc/goulash-ads/deployment.json' >&2; exit 1; }
# Bootstrap Node is an explicit prerequisite. No downloads or credentials are requested by this script.
exec "${GOULASH_BOOTSTRAP_NODE:-/opt/goulash-ads/bin/node}" "$release/deploy/install-clean.ts" "$release" "$2"
