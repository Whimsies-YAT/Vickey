# Android Overrides

This folder contains files that will **override** the corresponding files in the frontend build during the Android build process.

## Use Cases

### 1. Platform-specific HTML modifications

For example, adding Android-specific meta tags:

**overrides/index.html**:

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="format-detection" content="telephone=no">
    <!-- Android-specific: disable long-press menu -->
    <meta name="msapplication-tap-highlight" content="no">
    <!-- Other content copied from the original index.html -->
</head>
<body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### 2. Modify PWA manifest

**overrides/manifest.json**:

```json
{
  "name": "Vickey (Android)",
  "short_name": "Vickey",
  "start_url": "/",
  "display": "fullscreen",
  "orientation": "portrait"
}
```

### 3. Inject native bridge code

**overrides/native-bridge.js**:

```javascript
// Injected before Web code loads
window.NATIVE_PLATFORM = 'android';
window.CAPACITOR_ENABLED = true;
```

## Configuration

Define override rules in `android/overrides.json`:

```json
{
  "overrides": [
    {
      "source": "overrides/index.html",
      "target": "app/src/main/assets/public/index.html",
      "description": "Android-specific HTML"
    }
  ]
}
```

## Build Flow

```bash
# 1. Build frontend
cd packages/frontend
pnpm build  # → dist/

# 2. Capacitor sync (copies dist to Android)
npx cap sync android  # → android/app/src/main/assets/public/

# 3. Apply overrides (automatic)
# Build script reads overrides.json and overwrites target files
```

## Notes

1. **Do not modify frontend code directly**: Keep frontend code platform-agnostic
2. **Only override necessary files**: Most files should remain unchanged
3. **Version control**: Commit overrides folder to git
4. **Test web version**: Ensure overrides do not break web builds