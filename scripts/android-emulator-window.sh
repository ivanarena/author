#!/usr/bin/env bash
set -euo pipefail

sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "${sdk_root}" ]]; then
  echo "Set ANDROID_HOME or ANDROID_SDK_ROOT to your Android SDK path." >&2
  exit 1
fi

emulator_bin="${sdk_root}/emulator/emulator"
if [[ ! -x "${emulator_bin}" ]]; then
  emulator_bin="$(command -v emulator || true)"
fi

if [[ -z "${emulator_bin}" || ! -x "${emulator_bin}" ]]; then
  echo "Could not find the Android emulator binary." >&2
  exit 1
fi

avd="${ANDROID_AVD:-}"
if [[ -z "${avd}" ]]; then
  avd="$("${emulator_bin}" -list-avds | sed '/^$/d' | head -n 1)"
fi

if [[ -z "${avd}" ]]; then
  echo "No Android AVD found. Create one in Android Studio or with avdmanager." >&2
  exit 1
fi

echo "Starting Android emulator: ${avd}"
exec "${emulator_bin}" "@${avd}" -no-boot-anim "$@"
