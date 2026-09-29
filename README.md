# Munder Difflin Mobile

Android-ready browser/PWA control surface for the Munder Difflin desktop office.

## What this repository contains

- Responsive mobile command center
- Agent floor, tasks, inbox, shared memory, activity, settings
- PWA manifest and service worker
- Capacitor Android wrapper
- GitHub Actions workflow that builds a debug APK and uploads it as an artifact
- Phone-local OmniRoute queue worker with retries, resume handling, and persisted threads

The original desktop runtime remains desktop-only. Android browsers and APKs cannot provide the original Electron app's local PTY, filesystem, SQLite, or Git capabilities. The mobile app is the remote control surface; the desktop office remains the execution environment.

## Build the APK in GitHub

1. Open the **Actions** tab.
2. Choose **Build Android APK**.
3. Select **Run workflow**.
4. Optionally enter the public API base URL in `api_base_url`.
5. Download `munder-difflin-mobile-debug-apk` from the completed run.

If `api_base_url` is left empty, the APK runs in phone-only mode. The command center, message queue, and threads work locally; adding an OpenAI-compatible OmniRoute base URL and key in **Settings** lets the phone drain queued messages and write real replies back into the thread. The queue survives reloads, retries transient runtime failures, and resumes when the app comes back online.

The OmniRoute setting accepts either a base such as `https://your-host/v1` or a full `.../chat/completions` URL. The key is entered as a password field and is stored only in the device's local WebView storage; it is not committed to the repository or bundled into the APK.

For live floor data from the desktop office, provide the deployed API URL through `api_base_url` instead. In that mode the desktop API remains the source of truth and the phone-local queue worker is not installed.

The `main` branch also builds automatically on every push.