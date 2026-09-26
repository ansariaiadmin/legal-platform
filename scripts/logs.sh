#!/usr/bin/env bash
# Follow the logs of all services, or of the ones given as arguments.
#   ./scripts/logs.sh            # everything
#   ./scripts/logs.sh api worker # selected services
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec docker compose logs --tail=100 -f "$@"
