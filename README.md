# Munder Difflin Mobile

Android-ready browser/PWA control surface for the Munder Difflin desktop office.

## What this repository contains

- Responsive mobile command center
- Agent floor, tasks, inbox, shared memory, activity, settings
- PWA manifest and service worker
- Capacitor Android wrapper
- GitHub Actions workflow that builds a debug APK and uploads it as an artifact

The original desktop runtime remains desktop-only. Android browsers and APKs cannot provide the original Electron app's local PTY, filesystem, SQLite, or Git capabilities. The mobile app is the remote control surface; the desktop office remains the execution environment.

## Build the APK in GitHub

1. Open the **Actions** tab.
2. Choose **Build Android APK**.
3. Select **Run workflow**.
4. Optionally enter the public API base URL in `api_base_url`.
5. Download `munder-difflin-mobile-debug-apk` from the completed run.

If `api_base_url` is left empty, the APK still builds, but it will only connect when the API is available at the WebView origin. For live floor data, provide the deployed API URL.

The `main` branch also builds automatically on every push.