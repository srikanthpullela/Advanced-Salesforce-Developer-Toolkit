#!/bin/bash
# Build script: minify all JS source files into dist/
# Source files remain readable, dist/ gets minified versions
set -e
cd "/Users/spullela/AI Projects/Advanced Salesforce Developer Toolkit"

TERSER_OPTS="--compress --mangle"

# Ensure dist directories exist
mkdir -p dist/background dist/content dist/popup dist/utils dist/components dist/services dist/icons

echo "Copying static assets..."
cp manifest.json dist/manifest.json
cp popup/popup.html dist/popup/popup.html
cp -r icons/*.png dist/icons/ 2>/dev/null || true
echo "  ✓ manifest.json, popup.html, icons"

echo "Minifying JS files..."

# Background
terser background/background.js $TERSER_OPTS -o dist/background/background.js
echo "  ✓ background/background.js"

# Content
terser content/salesforceContentScript.js $TERSER_OPTS -o dist/content/salesforceContentScript.js
echo "  ✓ content/salesforceContentScript.js"

# Popup
terser popup/popup.js $TERSER_OPTS -o dist/popup/popup.js
echo "  ✓ popup/popup.js"

# Utils
for f in utils/*.js; do
  terser "$f" $TERSER_OPTS -o "dist/$f"
  echo "  ✓ $f"
done

# Components
for f in components/*.js; do
  terser "$f" $TERSER_OPTS -o "dist/$f"
  echo "  ✓ $f"
done

# Services
for f in services/*.js; do
  terser "$f" $TERSER_OPTS -o "dist/$f"
  echo "  ✓ $f"
done

# Show size comparison
echo ""
echo "Size comparison:"
SRC_SIZE=$(find . -name "*.js" -not -path "./dist/*" -not -path "./node_modules/*" -not -path "./devtools/*" -not -path "./icons/*" -exec cat {} + | wc -c)
DIST_SIZE=$(find ./dist -name "*.js" -exec cat {} + | wc -c)
echo "  Source: $(echo $SRC_SIZE | awk '{printf "%.1f KB", $1/1024}')"
echo "  Minified: $(echo $DIST_SIZE | awk '{printf "%.1f KB", $1/1024}')"
echo "  Reduction: $(echo "$SRC_SIZE $DIST_SIZE" | awk '{printf "%.0f%%", (1 - $2/$1) * 100}')"
echo ""
echo "✓ Build complete"
