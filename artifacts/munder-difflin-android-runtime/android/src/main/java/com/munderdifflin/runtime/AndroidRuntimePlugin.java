package com.munderdifflin.runtime;

import android.content.Context;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AndroidRuntime")
public class AndroidRuntimePlugin extends Plugin {
    private static final int MAX_TEXT_FILE_BYTES = 1_048_576;
    private static final int MAX_COMMAND_CHARS = 8_192;
    private static final int DEFAULT_TIMEOUT_MS = 30_000;
    private static final int MAX_TIMEOUT_MS = 300_000;

    private final ExecutorService ioExecutor = Executors.newCachedThreadPool();
    private final ScheduledExecutorService timeoutExecutor = Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentHashMap<String, CommandSession> sessions = new ConcurrentHashMap<>();

    private static final class CommandSession {
        final Process process;
        final BufferedOutputStream stdin;

        CommandSession(Process process) {
            this.process = process;
            this.stdin = new BufferedOutputStream(process.getOutputStream());
        }
    }

    @PluginMethod
    public void getWorkspaceInfo(PluginCall call) {
        try {
            File root = workspaceRoot();
            JSObject result = new JSObject();
            result.put("root", root.getAbsolutePath());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not open the private workspace.", error);
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        try {
            File directory = resolvePath(call.getString("path"), true);
            if (!directory.isDirectory()) {
                call.reject("The requested workspace path is not a directory.");
                return;
            }

            File[] children = directory.listFiles();
            JSArray entries = new JSArray();
            if (children != null) {
                java.util.Arrays.sort(children, new Comparator<File>() {
                    @Override
                    public int compare(File left, File right) {
                        if (left.isFile() != right.isFile()) return left.isFile() ? 1 : -1;
                        return String.CASE_INSENSITIVE_ORDER.compare(left.getName(), right.getName());
                    }
                });
                for (File child : children) {
                    if (isSymbolicLink(child)) continue;
                    JSObject entry = new JSObject();
                    entry.put("name", child.getName());
                    entry.put("path", relativePath(child));
                    entry.put("directory", child.isDirectory());
                    entry.put("size", child.isFile() ? child.length() : 0);
                    entry.put("modifiedAt", child.lastModified());
                    entries.put(entry);
                }
            }

            JSObject result = new JSObject();
            result.put("path", relativePath(directory));
            result.put("entries", entries);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not list this workspace folder."), error);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("A workspace-relative file path is required.");
            return;
        }

        try {
            File file = resolvePath(path, false);
            if (!file.isFile()) {
                call.reject("The requested path is not a file.");
                return;
            }
            long size = file.length();
            if (size > MAX_TEXT_FILE_BYTES) {
                call.reject("Files larger than 1 MiB cannot be opened in the editor.");
                return;
            }
            byte[] bytes = readBytes(file);
            JSObject result = new JSObject();
            result.put("path", relativePath(file));
            result.put("content", decodeUtf8(bytes));
            result.put("size", bytes.length);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not read this workspace file."), error);
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String content = call.getString("content");
        if (path == null || path.trim().isEmpty() || content == null) {
            call.reject("A workspace-relative path and file content are required.");
            return;
        }

        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_TEXT_FILE_BYTES) {
            call.reject("Files larger than 1 MiB cannot be saved from the editor.");
            return;
        }

        try {
            File file = resolvePath(path, false);
            File parent = file.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                call.reject("Could not create the parent folder.");
                return;
            }
            // Re-check after creating folders so a symlink cannot redirect a write outside the workspace.
            file = resolvePath(path, false);
            AtomicFile atomicFile = new AtomicFile(file);
            FileOutputStream output = null;
            try {
                output = atomicFile.startWrite();
                output.write(bytes);
                atomicFile.finishWrite(output);
            } catch (IOException writeError) {
                if (output != null) atomicFile.failWrite(output);
                throw writeError;
            }

            JSObject result = new JSObject();
            result.put("path", relativePath(file));
            result.put("size", bytes.length);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not save this workspace file."), error);
        }
    }

    @PluginMethod
    public void createDirectory(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("A workspace-relative folder path is required.");
            return;
        }
        try {
            File directory = resolvePath(path, false);
            if (directory.exists() || !directory.mkdirs()) {
                call.reject("The folder already exists or could not be created.");
                return;
            }
            JSObject result = new JSObject();
            result.put("path", relativePath(directory));
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not create this workspace folder."), error);
        }
    }

    @PluginMethod
    public void deletePath(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("The workspace root cannot be deleted.");
            return;
        }
        try {
            File target = resolvePath(path, false);
            if (!target.exists()) {
                call.reject("The requested workspace item does not exist.");
                return;
            }
            deleteRecursively(target);
            JSObject result = new JSObject();
            result.put("path", path);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not delete this workspace item."), error);
        }
    }

    @PluginMethod
    public void startCommand(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.trim().isEmpty() || command.length() > MAX_COMMAND_CHARS) {
            call.reject("Enter a command of 1–8192 characters.");
            return;
        }

        try {
            File cwd = resolvePath(call.getString("cwd"), true);
            if (!cwd.isDirectory()) {
                call.reject("The command working directory is not a folder.");
                return;
            }

            Process process = new ProcessBuilder("/system/bin/sh", "-c", command)
                .directory(cwd)
                .redirectErrorStream(false)
                .start();
            String sessionId = UUID.randomUUID().toString();
            CommandSession session = new CommandSession(process);
            sessions.put(sessionId, session);
            Integer requestedTimeout = call.getInt("timeoutMs");
            int timeoutMs = requestedTimeout == null
                ? DEFAULT_TIMEOUT_MS
                : Math.max(1_000, Math.min(MAX_TIMEOUT_MS, requestedTimeout));

            streamOutput(sessionId, process.getInputStream(), "stdout");
            streamOutput(sessionId, process.getErrorStream(), "stderr");
            AtomicBoolean timedOut = new AtomicBoolean(false);
            ScheduledFuture<?> timeoutTask = timeoutExecutor.schedule(() -> {
                timedOut.set(true);
                process.destroy();
            }, timeoutMs, TimeUnit.MILLISECONDS);
            ioExecutor.execute(() -> {
                int exitCode = -1;
                try {
                    exitCode = process.waitFor();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    process.destroy();
                } finally {
                    timeoutTask.cancel(false);
                    try {
                        session.stdin.close();
                    } catch (IOException ignored) {
                        // Process completion can close stdin before this cleanup runs.
                    }
                    sessions.remove(sessionId);
                    JSObject event = new JSObject();
                    event.put("sessionId", sessionId);
                    event.put("exitCode", exitCode);
                    event.put("timedOut", timedOut.get());
                    notifyListeners("runtimeExit", event);
                }
            });

            JSObject result = new JSObject();
            result.put("sessionId", sessionId);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(messageFor(error, "Could not start the Android shell command."), error);
        }
    }

    @PluginMethod
    public void sendInput(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String text = call.getString("text");
        CommandSession session = sessionId == null ? null : sessions.get(sessionId);
        if (session == null || text == null) {
            call.reject("The command session is no longer running.");
            return;
        }
        try {
            session.stdin.write(text.getBytes(StandardCharsets.UTF_8));
            session.stdin.flush();
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not send input to the command.", error);
        }
    }

    @PluginMethod
    public void closeInput(PluginCall call) {
        String sessionId = call.getString("sessionId");
        CommandSession session = sessionId == null ? null : sessions.get(sessionId);
        if (session == null) {
            call.reject("The command session is no longer running.");
            return;
        }
        try {
            session.stdin.close();
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not close command input.", error);
        }
    }

    @PluginMethod
    public void stopCommand(PluginCall call) {
        String sessionId = call.getString("sessionId");
        CommandSession session = sessionId == null ? null : sessions.get(sessionId);
        if (session == null) {
            call.resolve();
            return;
        }
        session.process.destroy();
        call.resolve();
    }

    private void streamOutput(String sessionId, InputStream stream, String name) {
        ioExecutor.execute(() -> {
            try (InputStreamReader input = new InputStreamReader(new BufferedInputStream(stream), StandardCharsets.UTF_8)) {
                char[] buffer = new char[2_048];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    JSObject event = new JSObject();
                    event.put("sessionId", sessionId);
                    event.put("stream", name);
                    event.put("text", new String(buffer, 0, count));
                    notifyListeners("runtimeOutput", event);
                }
            } catch (IOException error) {
                // Closing a stream while stopping a process is expected.
            }
        });
    }

    private File workspaceRoot() throws IOException {
        Context context = getContext();
        if (context == null) throw new IOException("Android app context is unavailable.");
        File appFiles = context.getFilesDir().getCanonicalFile();
        File root = new File(appFiles, "workspace");
        if (isSymbolicLink(root)) throw new IOException("The private workspace cannot be a symbolic link.");
        if (!root.exists() && !root.mkdirs()) throw new IOException("Could not create the private workspace.");
        File canonicalRoot = root.getCanonicalFile();
        if (!canonicalRoot.getPath().startsWith(appFiles.getPath() + File.separator)) {
            throw new IOException("The private workspace resolves outside app storage.");
        }
        return canonicalRoot;
    }

    private File resolvePath(String input, boolean allowRoot) throws IOException {
        File rootFile = workspaceRoot();
        String value = input == null ? "" : input.trim();
        String normalized = normalizeRelativePath(value);
        File target = normalized.isEmpty() ? rootFile : new File(rootFile, normalized);
        File cursor = rootFile;
        if (isSymbolicLink(cursor)) throw new IOException("Symbolic links are not allowed in workspace paths.");
        if (!normalized.isEmpty()) {
            for (String segment : normalized.split(java.util.regex.Pattern.quote(File.separator))) {
                cursor = new File(cursor, segment);
                if (isSymbolicLink(cursor)) throw new IOException("Symbolic links are not allowed in workspace paths.");
            }
        }
        String rootPath = rootFile.getCanonicalPath();
        String targetPath = target.getCanonicalPath();
        if (!targetPath.equals(rootPath) && !targetPath.startsWith(rootPath + File.separator)) {
            throw new IOException("The path must stay inside the private workspace.");
        }
        if (!targetPath.equals(target.getAbsolutePath())) {
            throw new IOException("Symbolic links are not allowed in workspace paths.");
        }
        if (!allowRoot && target.equals(rootFile)) {
            throw new IOException("The workspace root cannot be changed or deleted.");
        }
        return target;
    }

    private String relativePath(File file) throws IOException {
        File root = workspaceRoot();
        String rootPath = root.getCanonicalPath();
        String targetPath = file.getCanonicalPath();
        if (!targetPath.equals(rootPath) && !targetPath.startsWith(rootPath + File.separator)) {
            throw new IOException("The path resolves outside the private workspace.");
        }
        if (!targetPath.equals(file.getAbsolutePath())) throw new IOException("Symbolic links are not allowed in workspace paths.");
        String value = targetPath.equals(rootPath) ? "" : targetPath.substring(rootPath.length() + 1);
        return value.replace(File.separatorChar, '/').isEmpty() ? "." : value.replace(File.separatorChar, '/');
    }

    private String normalizeRelativePath(String input) throws IOException {
        if (input.startsWith("/") || input.indexOf('\0') >= 0) throw new IOException("Only workspace-relative paths are allowed.");
        Deque<String> parts = new ArrayDeque<>();
        for (String part : input.replace('\\', '/').split("/")) {
            if (part.isEmpty() || ".".equals(part)) continue;
            if ("..".equals(part)) {
                if (parts.isEmpty()) throw new IOException("The path must stay inside the private workspace.");
                parts.removeLast();
            } else {
                parts.addLast(part);
            }
        }
        StringBuilder normalized = new StringBuilder();
        for (String part : parts) {
            if (normalized.length() > 0) normalized.append(File.separator);
            normalized.append(part);
        }
        return normalized.toString();
    }

    private boolean isSymbolicLink(File file) throws IOException {
        try {
            StructStat stat = Os.lstat(file.getAbsolutePath());
            return (stat.st_mode & OsConstants.S_IFMT) == OsConstants.S_IFLNK;
        } catch (ErrnoException error) {
            if (error.errno == OsConstants.ENOENT || error.errno == OsConstants.ENOTDIR) return false;
            throw new IOException("Could not inspect workspace path.", error);
        }
    }

    private byte[] readBytes(File file) throws IOException {
        try (InputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8_192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_TEXT_FILE_BYTES) {
                    throw new IOException("Files larger than 1 MiB cannot be opened in the editor.");
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String decodeUtf8(byte[] bytes) throws IOException {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException invalidText) {
            throw new IOException("Only valid UTF-8 text files can be opened in the editor.", invalidText);
        }
    }

    private void deleteRecursively(File file) throws IOException {
        if (isSymbolicLink(file)) throw new IOException("Symbolic links cannot be deleted from the workspace browser.");
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursively(child);
            }
        }
        if (!file.delete()) throw new IOException("Could not delete the requested workspace item.");
    }

    private String messageFor(Exception error, String fallback) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    @Override
    protected void handleOnDestroy() {
        for (CommandSession session : sessions.values()) session.process.destroy();
        sessions.clear();
        ioExecutor.shutdownNow();
        timeoutExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}

