#!/usr/bin/env bash
# adr-ledger.sh — run the estate's canonical ADR ledger checker against docs/adr.
#
# The checker is NOT vendored here. It lives in DreamLab-AI/agentbox
# (scripts/adr-index-gen.js) and is fetched at the commit pinned below; the
# download is verified against the pinned sha256 BEFORE node runs it, so a moved
# tag, a force-pushed branch or a tampered mirror fails closed. To adopt a newer
# checker, change both pins in one reviewed commit.
#
#   bash scripts/adr-ledger.sh check   validate the records and fail if the
#                                      generated docs/adr/README.md is stale (CI)
#   bash scripts/adr-ledger.sh write   regenerate docs/adr/README.md
#
# Configuration for this ledger (allowed `repo` values, excluded files) is
# docs/adr/.ledger.json.
set -euo pipefail

ADR_CHECKER_REPO="DreamLab-AI/agentbox"
ADR_CHECKER_SHA="8bd4314d19bb72236a8eeb09e53636a22831cc5b"
ADR_CHECKER_SHA256="667c90dbbf730bfba3291a2b2106a75f2f446712204571237f343d97590a7e62"
# Overridable only to point at a mirror or a file:// copy; the sha256 still applies.
ADR_CHECKER_URL="${ADR_CHECKER_URL:-https://raw.githubusercontent.com/${ADR_CHECKER_REPO}/${ADR_CHECKER_SHA}/scripts/adr-index-gen.js}"

mode="${1:-check}"
cd "$(git rev-parse --show-toplevel)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --silent --show-error --location --retry 3 "$ADR_CHECKER_URL" -o "$tmp/adr-index-gen.js"
echo "${ADR_CHECKER_SHA256}  $tmp/adr-index-gen.js" | sha256sum --check --strict --status \
  || { echo "error: adr-index-gen.js from ${ADR_CHECKER_URL} does not match the pinned sha256 ${ADR_CHECKER_SHA256}" >&2; exit 1; }

case "$mode" in
  check) node "$tmp/adr-index-gen.js" docs/adr --check-index ;;
  write) node "$tmp/adr-index-gen.js" docs/adr ;;
  *) echo "usage: bash scripts/adr-ledger.sh [check|write]" >&2; exit 2 ;;
esac
