#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flutter build apk --release --dart-define=API_URL="${1:-http://72.56.244.26:47310}"
echo build/app/outputs/flutter-apk/app-release.apk
