#!/bin/zsh
# Builds build/海边球场.app from BeachCourt.swift and ../web.
set -euo pipefail
cd "$(dirname "$0")"
APP="build/海边球场.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target arm64-apple-macos14 \
  -framework AppKit -framework WebKit -framework QuickLookThumbnailing \
  -o "$APP/Contents/MacOS/BeachCourt" BeachCourt.swift
cp Info.plist "$APP/Contents/Info.plist"
rsync -a --delete --exclude '.DS_Store' ../web/ "$APP/Contents/Resources/web/"
# Sign with the Apple Development certificate when there is one: a stable identity keeps the
# permissions granted to the app (Input Monitoring, controlling Finder) across rebuilds.
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)
if [[ -n "$IDENTITY" ]]; then
  codesign --force --sign "$IDENTITY" --identifier local.beachcourt "$APP"
else
  codesign --force --sign - "$APP"
fi
echo "built $APP"
