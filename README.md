# Munder Difflin Mobile

A phone-first Munder Difflin workspace for Android and mobile browsers. The app runs on the phone as a Capacitor Android app or installable PWA; it is not just a remote-control screen for the desktop UI.

## What the mobile app includes

- Responsive agent floor and session status
- Task board with search, filters, and status updates
- Agent inbox, message composer, and conversation threads
- Persistent phone-side message queue with retries and resume handling
- Shared-memory and activity views
- Settings for appearance, installation guidance, and an OmniRoute AI endpoint
- PWA manifest/service worker and a Capacitor Android wrapper
- GitHub Actions workflow that builds a debug APK and uploads it as an artifact

## Run it in phone-only mode

Leave `api_base_url` empty when building the APK. The mobile workspace starts on the phone without a desktop API. Its phone-mode snapshot, queue, sessions, and threads are stored in the WebView's local storage and remain available after reloads.

To generate AI replies, open **Settings** in the app and enter an OpenAI-compatible OmniRoute base URL, API key, and model. Messages sent from the phone are queued and processed by the phone-side queue worker; replies are saved into the phone's inbox and thread. The AI request requires network access. If OmniRoute is not configured or reachable, messages remain queued, retry, or show as blocked rather than being sent to a desktop runtime.

The OmniRoute URL can be a base such as `https://your-host/v1` or a full `.../chat/completions` URL. The key is stored in the phone's local WebView storage and is not committed to this repository or bundled into the APK. Anyone with access to the unlocked device or its app data may be able to access it, so do not use a shared or untrusted device for a sensitive key.

Phone-only mode uses the configured AI service for replies; it does not run the desktop Electron app's local PTY, filesystem, SQLite, or Git tools on Android. Those desktop-specific capabilities are not included in this mobile repository.

## Optional connection to a deployed office API

To load live office data from an already deployed API, set `api_base_url` when manually running the **Build Android APK** workflow, or configure the repository variable `MUNDER_API_BASE_URL`. In this mode the deployed API is the source of truth and the phone-only queue worker is not installed. This connection is optional; it is not required to launch the phone app in phone-only mode.

This repository contains the mobile client and APK workflow, not the desktop office server/API. A deployed office API must already exist to use this optional connected mode.

## Build and download the Android APK

1. Open the repository's **Actions** tab.
2. Select **Build Android APK**.
3. Choose **Run workflow**. Leave `api_base_url` empty for phone-only mode, or provide a deployed office API URL for connected mode.
4. After the run succeeds, download `munder-difflin-mobile-debug-apk` from its artifacts.

The `main` branch also triggers an APK build on each push. For a mobile browser, serve the built web app over HTTPS and use the browser's **Install app** or **Add to home screen** option when available.
