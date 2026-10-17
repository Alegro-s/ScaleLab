#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flutter create --platforms=android --org ru.masshtablab --project-name masshtablab_mobile .
cp android-overrides/AndroidManifest.xml android/app/src/main/AndroidManifest.xml
flutter pub get
