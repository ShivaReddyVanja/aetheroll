#!/usr/bin/env bash

# replace_app_icons.sh
# Shell script to replace all Android and iOS app icons using mobile/AppIcons

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

node "${MOBILE_DIR}/scripts/replace-app-icons.js"
