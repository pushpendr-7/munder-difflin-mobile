# Munder Difflin Mobile

A phone-first Munder Difflin workspace for Android and mobile browsers. The app runs on the phone as a Capacitor Android app or installable PWA; it is not just a remote-control screen for the desktop UI.

## What the mobile app includes

- Responsive agent floor and session status
- Task board with search, filters, and status updates
- Agent inbox, message composer, and conversation threads
- Persistent phone-side message queue with retries and resume handling
- Shared-memory and activity views
- Android-only app-private file browser/editor and user-run shell command screen
- Settings for appearance, installation guidance, and an OmniRoute AI endpoint
- PWA manifest/service worker and a Capacitor Android wrapper
- GitHub Actions workflow that builds a debug APK and uploads it as an artifact

## Run it in phone-only mode

Leave `api_base_url` empty when building the APK. The mobile workspace starts on the phone without a desktop API. Its phone-mode snapshot, queue, sessions, and threads are stored in the WebView's local storage and remain available after reloads.

To generate AI replies, open **Settings** in the app and enter an OpenAI-compatible OmniRoute base URL, API key, and model. Messages sent from the phone are queued and processed by the phone-side queue worker; replies are saved into the phone's inbox and thread. The AI request requires network access. If OmniRoute is not configured or reachable, messages remain queued, retry, or show as blocked rather than being sent to a desktop runtime.

The OmniRoute URL can be a base such as `https://your-host/v1` or a full `.../chat/completions` URL. The key is stored in the phone's local WebView storage and is not committed to this repository or bundled into the APK. Anyone with access to the unlocked device or its app data may be able to access it, so do not use a shared or untrusted device for a sensitive key.

## Android private workspace and shell

The Android APK includes a Capacitor native plugin that creates a workspace inside the app's private files directory. The **Files** screen can list folders and create, read, edit, save, or delete text files there. File-browser operations reject absolute paths, traversal outside the workspace, and symbolic-link paths; the editor is limited to 1 MiB per file.

The **Terminal** screen starts a user-entered command in `/system/bin/sh`, initially from that workspace, and streams stdout/stderr back into the app. Commands run as the app's Android UID, without root. This is not a security jail around the workspace: a command can access other files Android permits to this app. Only run commands you trust. No AI agent runs terminal commands automatically.

This first native shell is a streamed subprocess, **not a pseudo-terminal (PTY)**. It does not support terminal resizing, job control, or full-screen TTY programs. The APK does not bundle Node.js, Python, Git, Claude Code, Codex, Gemini CLI, Aider, or other third-party CLI providers; the terminal can only run commands that are already available to the Android app. The “Insert CLI check” button puts a `command -v` probe into the input for the user to run. Provider binaries, Android-compatible packaging, and their authentication flows need to be added separately before those providers can run standalone.

The native Files and Terminal screens work only in the installed Android APK. A mobile browser/PWA has no access to this plugin, and the Android app's private workspace is separate from shared phone storage. Phone-only mode still uses the configured AI service for agent-style replies; it does not run the desktop Electron app's local PTY, SQLite, Git integration, or autonomous coding-agent tools.

## On-device mobile coding agent

The Android APK includes a **Code agent** screen that uses the configured OmniRoute OpenAI-compatible chat-completions endpoint. The selected model must support OpenAI-style tool calling. The agent can list and read files inside the APK's private workspace; it asks for approval before creating or replacing a file, creating a folder, or running a shell command. A turn is capped at eight model/tool rounds and twelve tool actions.

Prompts and any workspace file contents the agent reads are sent to the OmniRoute endpoint configured on the phone. The API key remains in the phone's WebView local storage. Do not use a shared or untrusted device for a sensitive key.

**Command warning:** Approved shell commands run as the Android app's UID. The shell is not jailed to the workspace and can access other files Android permits to this app; a command could expose local app data, including the configured key. Review every command and approve only commands you trust. The agent never runs a command without a separate in-app approval.

The Code agent and native workspace tools are Android-APK-only; the PWA/browser does not have the Capacitor runtime. Commands are still limited by the programs available on Android: the APK does not bundle Node.js, Python, Git, or provider CLIs.

## Optional connection to a deployed office API

To load live office data from an already deployed API, set `api_base_url` when manually running the **Build Android APK** workflow, or configure the repository variable `MUNDER_API_BASE_URL`. In this mode the deployed API is the source of truth and the phone-only queue worker is not installed. This connection is optional; it is not required to launch the phone app in phone-only mode.

This repository contains the mobile client and APK workflow, not the desktop office server/API. A deployed office API must already exist to use this optional connected mode.

## Build and download the Android APK

1. Open the repository's **Actions** tab.
2. Select **Build Android APK**.
3. Choose **Run workflow**. Leave `api_base_url` empty for phone-only mode, or provide a deployed office API URL for connected mode.
4. After the run succeeds, download `munder-difflin-mobile-debug-apk` from its artifacts.

The `main` branch also triggers an APK build on each push. For a mobile browser, serve the built web app over HTTPS and use the browser's **Install app** or **Add to home screen** option when available.
