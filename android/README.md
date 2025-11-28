# Vickey Android App

## Project Structure

```
android/
├── app/                                    # Main application module
│   ├── src/main/
│   │   ├── java/org/whimsies/vickey/      # Java entry point (MainActivity)
│   │   ├── kotlin/org/whimsies/vickey/security/  # Kotlin security plugins
│   │   │   ├── SecureHttpPlugin.kt       # SSL Pinning + OkHttp
│   │   │   ├── EnvCheckPlugin.kt         # Root/Xposed/Frida detection
│   │   │   ├── SecureStoragePlugin.kt    # Keystore encrypted storage
│   │   │   └── IntegrityCheckPlugin.kt   # Signature verification
│   │   ├── res/                           # Android resources
│   │   └── AndroidManifest.xml
│   ├── build.gradle                       # App build configuration
│   └── proguard-rules.pro                 # Code obfuscation rules
├── capacitor-cordova-android-plugins/     # Cordova compatibility layer
└── build.gradle                           # Project-level build configuration
```

## Security Plugin Features

### 1. SecureHttpPlugin

* **SSL Pinning**: Uses OkHttp `CertificatePinner`
* **Request Interception**: Checks environment security before each request
* **Man-in-the-Middle Protection**: Verifies certificate chain

Configure SSL Pinning:

```kotlin
// In SecureHttpPlugin.kt, configure your certificate pins
val certificatePinner = CertificatePinner.Builder()
    .add("your-domain.com", "sha256/YOUR_PIN_HERE")
    .build()
```

Get pin with:

```bash
openssl s_client -connect your-domain.com:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
```

### 2. EnvCheckPlugin

Detects unsafe environments:

* Root/Magisk (checks `su` binary, root apps)
* Emulator (checks `Build` properties)
* Debug mode (`ApplicationInfo.FLAG_DEBUGGABLE`)
* Xposed framework (stack trace detection)
* Frida (port 27042 detection, memory mapping detection)

### 3. SecureStoragePlugin

* Stores keys in Android Keystore
* Uses `EncryptedSharedPreferences` for encrypted storage
* AES256-GCM encryption
* Hardware-backed key storage (if supported)

### 4. IntegrityCheckPlugin

* APK signature verification
* Certificate fingerprint retrieval (for server validation)
* Repackaging prevention

## Build and Run

### Prerequisites

* Android Studio Ladybug or later
* JDK 17+
* Android SDK 24-35

### Development Build

```bash
# From project root
cd packages/frontend
pnpm build
npx cap sync android
npx cap open android
```

### Production Build

```bash
# In Android Studio:
# 1. Build > Generate Signed Bundle/APK
# 2. Select release variant
# 3. Configure signing key
```

## Configuration

### 1. SSL Certificate Pinning

Edit `app/src/main/kotlin/org/whimsies/vickey/security/SecureHttpPlugin.kt`:

```kotlin
val certificatePinner = CertificatePinner.Builder()
    .add("your-api-domain.com", "sha256/PRIMARY_PIN")
    .add("your-api-domain.com", "sha256/BACKUP_PIN")  // Backup pin
    .build()
```

### 2. Signature Verification

Edit `app/src/main/kotlin/org/whimsies/vickey/security/IntegrityCheckPlugin.kt`:

```kotlin
private val EXPECTED_SIGNATURE_SHA256 = "YOUR_RELEASE_CERT_SHA256"
```

Get signature:

```bash
keytool -list -v -keystore your-release-key.keystore
```

### 3. App Icon

Current icons are placeholders, replace:

* `app/src/main/res/mipmap-*/ic_launcher.png` (all DPIs)
* `app/src/main/res/mipmap-*/ic_launcher_round.png`

Recommended tool: Android Asset Studio

### 4. Security Policy

Adjust behavior on detection (warning vs blocking) as needed

## ProGuard Obfuscation

Release builds automatically enable R8/ProGuard obfuscation, rules in `app/proguard-rules.pro`

## Package Name

* Application ID: `org.whimsies.vickey`
* Deep links: `vickey://`