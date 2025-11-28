#!/bin/bash
set -e

# Generate app icons for Android and iOS from source icon
# Source: packages/frontend/assets/about-icon-vk-2.png (192x192)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/packages/frontend/assets/about-icon-vk-2.png"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick is not installed"
    echo "   Install: sudo apt install imagemagick"
    exit 1
fi

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ Source icon not found: $SOURCE_ICON"
    exit 1
fi

echo "📱 Generating app icons from: about-icon-vk-2.png"
echo ""

# ============================================================================
# Android Icons
# ============================================================================

echo "🤖 Generating Android icons..."

ANDROID_RES="$ROOT_DIR/android/app/src/main/res"

# Android launcher icon sizes
declare -A ANDROID_SIZES=(
    ["mipmap-mdpi"]=48
    ["mipmap-hdpi"]=72
    ["mipmap-xhdpi"]=96
    ["mipmap-xxhdpi"]=144
    ["mipmap-xxxhdpi"]=192
)

for dir in "${!ANDROID_SIZES[@]}"; do
    size="${ANDROID_SIZES[$dir]}"
    mkdir -p "$ANDROID_RES/$dir"

    # Generate ic_launcher.png
    convert "$SOURCE_ICON" -resize ${size}x${size} "$ANDROID_RES/$dir/ic_launcher.png"
    echo "  ✓ $dir/ic_launcher.png (${size}x${size})"

    # Generate ic_launcher_round.png
    convert "$SOURCE_ICON" -resize ${size}x${size} \
        \( +clone -threshold -1 -negate -fill white -draw "circle $((size/2)),$((size/2)) $((size/2)),0" \) \
        -alpha off -compose copy_opacity -composite \
        "$ANDROID_RES/$dir/ic_launcher_round.png"
    echo "  ✓ $dir/ic_launcher_round.png (${size}x${size})"
done

# Foreground icon for adaptive icon (API 26+)
for dir in "${!ANDROID_SIZES[@]}"; do
    size="${ANDROID_SIZES[$dir]}"
    mkdir -p "$ANDROID_RES/$dir"

    # Foreground should be 108dp with 72dp safe zone
    # Scale icon to fit in safe zone
    safe_size=$((size * 72 / 108))
    padding=$(((size - safe_size) / 2))

    convert "$SOURCE_ICON" -resize ${safe_size}x${safe_size} \
        -background none -gravity center -extent ${size}x${size} \
        "$ANDROID_RES/$dir/ic_launcher_foreground.png"
    echo "  ✓ $dir/ic_launcher_foreground.png (${size}x${size})"
done

echo ""

# ============================================================================
# iOS Icons (if iOS project exists)
# ============================================================================

IOS_ASSETS="$ROOT_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset"

if [ -d "$ROOT_DIR/ios/App" ]; then
    echo "🍎 Generating iOS icons..."

    mkdir -p "$IOS_ASSETS"

    # iOS App Icon sizes (all variants)
    declare -A IOS_SIZES=(
        # iPhone Notification
        ["icon-20@2x"]=40
        ["icon-20@3x"]=60
        # iPhone Settings
        ["icon-29@2x"]=58
        ["icon-29@3x"]=87
        # iPhone Spotlight
        ["icon-40@2x"]=80
        ["icon-40@3x"]=120
        # iPhone App
        ["icon-60@2x"]=120
        ["icon-60@3x"]=180
        # iPad Notifications
        ["icon-20"]=20
        # iPad Settings
        ["icon-29"]=29
        # iPad Spotlight
        ["icon-40"]=40
        # iPad App
        ["icon-76"]=76
        ["icon-76@2x"]=152
        # iPad Pro App
        ["icon-83.5@2x"]=167
        # App Store
        ["icon-1024"]=1024
    )

    for name in "${!IOS_SIZES[@]}"; do
        size="${IOS_SIZES[$name]}"
        convert "$SOURCE_ICON" -resize ${size}x${size} "$IOS_ASSETS/${name}.png"
        echo "  ✓ ${name}.png (${size}x${size})"
    done

    # Generate Contents.json for iOS
    cat > "$IOS_ASSETS/Contents.json" << 'EOF'
{
  "images" : [
    {
      "filename" : "icon-20@2x.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "filename" : "icon-20@3x.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "20x20"
    },
    {
      "filename" : "icon-29@2x.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "filename" : "icon-29@3x.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "29x29"
    },
    {
      "filename" : "icon-40@2x.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "filename" : "icon-40@3x.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "40x40"
    },
    {
      "filename" : "icon-60@2x.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "60x60"
    },
    {
      "filename" : "icon-60@3x.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "60x60"
    },
    {
      "filename" : "icon-20.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "20x20"
    },
    {
      "filename" : "icon-20@2x.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "filename" : "icon-29.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "29x29"
    },
    {
      "filename" : "icon-29@2x.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "filename" : "icon-40.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "40x40"
    },
    {
      "filename" : "icon-40@2x.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "filename" : "icon-76.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "76x76"
    },
    {
      "filename" : "icon-76@2x.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "76x76"
    },
    {
      "filename" : "icon-83.5@2x.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "83.5x83.5"
    },
    {
      "filename" : "icon-1024.png",
      "idiom" : "ios-marketing",
      "scale" : "1x",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF
    echo "  ✓ Contents.json"

else
    echo "⚠️  iOS project not found, skipping iOS icons"
fi

echo ""
echo "✅ Icon generation complete!"
echo ""
echo "📱 Next steps:"
echo "   - Android: Icons placed in android/app/src/main/res/mipmap-*/"
echo "   - iOS: Icons placed in ios/App/App/Assets.xcassets/AppIcon.appiconset/"
echo "   - Rebuild the app to see the new icons"