import './android-runtime.css';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, FilePlus2, Folder, FolderPlus, RefreshCcw, Save, Square, Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import {
  AndroidRuntime,
  isAndroidRuntimeAvailable,
  type RuntimeExitEvent,
  type RuntimeOutputEvent,
  type WorkspaceEntry,
} from '@workspace/android-runtime';

function RuntimeUnavailable({ feature }: { feature: string }) {
  return (
    <div className="content-wrap">
      <div className="runtime-panel runtime-unavailable">
        <div className="runtime-panel-icon"><TerminalIcon size={21} /></div>
        <div>
          <p className="eyebrow">ANDROID-ONLY FEATURE</p>
          <h2>{feature} needs the installed Android APK</h2>
          <p>This feature uses the APK's native plugin and is not available in a desktop or mobile browser preview.</p>
        </div>
      </div>
    </div>
  );
}

function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function safeRelativeJoin(base: string, child: string) {
  if (child.startsWith('/') || child.includes('\0')) throw new Error('Use a path inside the workspace.');
  const parts = base.split('/').filter(Boolean);
  for (const segment of child.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error('The path must stay inside the private workspace.');
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

export function WorkspacePage() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const available = isAndroidRuntimeAvailable();

  const refresh = useCallback(async (nextPath: string) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await AndroidRuntime.listFiles({ path: nextPath });
      setPath(result.path === '.' ? '' : result.path);
      setEntries(result.entries);
      setSelectedPath('');
      setContent('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load this folder.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (available) void refresh('');
  }, [available, refresh]);

  const openEntry = async (entry: WorkspaceEntry) => {
    if (entry.directory) {
      await refresh(entry.path);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await AndroidRuntime.readFile({ path: entry.path });
      setSelectedPath(result.path);
      setContent(result.content);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open this file.');
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    if (!selectedPath) return;
    setBusy(true);
    setMessage('');
    try {
      await AndroidRuntime.writeFile({ path: selectedPath, content });
      setMessage(`Saved ${selectedPath}`);
      await refresh(path);
      setSelectedPath(selectedPath);
      setContent(content);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this file.');
    } finally {
      setBusy(false);
    }
  };

  const createFile = async () => {
    const name = window.prompt('New file name (workspace-relative):');
    if (!name?.trim()) return;
    try {
      const filePath = safeRelativeJoin(path, name.trim());
      await AndroidRuntime.writeFile({ path: filePath, content: '' });
      await refresh(path);
      setSelectedPath(filePath);
      setContent('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create this file.');
    }
  };

  const createFolder = async () => {
    const name = window.prompt('New folder name:');
    if (!name?.trim()) return;
    try {
      const folderPath = safeRelativeJoin(path, name.trim());
      await AndroidRuntime.createDirectory({ path: folderPath });
      await refresh(path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create this folder.');
    }
  };

  const deleteEntry = async (entry: WorkspaceEntry) => {
    if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
    try {
      await AndroidRuntime.deletePath({ path: entry.path });
      if (selectedPath === entry.path) {
        setSelectedPath('');
        setContent('');
      }
      await refresh(path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this item.');
    }
  };

  if (!available) return <RuntimeUnavailable feature="The private workspace" />;

  return (
    <div className="content-wrap">
      <div className="runtime-intro">
        <div>
          <p className="eyebrow">APP-PRIVATE STORAGE</p>
          <h2>Files that stay inside this app</h2>
          <p>Browse and edit text files in the APK's private workspace. Paths are confined to this folder.</p>
        </div>
        <button className="secondary-button runtime-refresh" onClick={() => void refresh(path)} disabled={busy} aria-label="Refresh workspace">
          <RefreshCcw size={15} className={busy ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <section className="runtime-panel">
        <div className="runtime-toolbar">
          <div className="runtime-breadcrumb">
            <button onClick={() => void refresh('')} className="runtime-breadcrumb-root">workspace</button>
            {path.split('/').filter(Boolean).map((part, index, parts) => {
              const crumbPath = parts.slice(0, index + 1).join('/');
              return <span key={crumbPath}><ChevronRight size={14} /><button onClick={() => void refresh(crumbPath)}>{part}</button></span>;
            })}
          </div>
          <div className="runtime-actions">
            <button className="secondary-button" onClick={() => void createFolder()}><FolderPlus size={15} /> Folder</button>
            <button className="secondary-button" onClick={() => void createFile()}><FilePlus2 size={15} /> File</button>
          </div>
        </div>
        {message ? <p className="runtime-message" role="status">{message}</p> : null}
        <div className="runtime-file-layout">
          <div className="runtime-file-list">
            {path ? <button className="runtime-file-row runtime-parent" onClick={() => void refresh(parentPath(path))}><ArrowLeft size={16} /> ..</button> : null}
            {entries.map((entry) => (
              <div className={`runtime-file-row ${selectedPath === entry.path ? 'runtime-file-selected' : ''}`} key={entry.path}>
                <button className="runtime-file-open" onClick={() => void openEntry(entry)}>
                  {entry.directory ? <Folder size={16} /> : <span className="runtime-file-glyph">TXT</span>}
                  <span className="runtime-file-name">{entry.name}</span>
                  {!entry.directory ? <small>{entry.size} B</small> : null}
                </button>
                <button className="runtime-icon-button" onClick={() => void deleteEntry(entry)} aria-label={`Delete ${entry.name}`}><Trash2 size={15} /></button>
              </div>
            ))}
            {!entries.length && !busy ? <div className="runtime-empty">This folder is empty. Create a file or folder to start.</div> : null}
          </div>
          <div className="runtime-editor">
            {selectedPath ? (
              <>
                <div className="runtime-editor-head"><strong>{selectedPath}</strong><button className="primary-button" onClick={() => void saveFile()} disabled={busy}><Save size={15} /> Save</button></div>
                <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} aria-label={`Edit ${selectedPath}`} />
              </>
            ) : (
              <div className="runtime-empty runtime-editor-empty">Choose a text file to view or edit it.</div>
            )}
          </div>
        </div>
        <p className="runtime-footnote">Only app-private files are visible here. This does not browse shared phone storage or other apps' data.</p>
      </section>
    </div>
  );
}

type TerminalLine = { kind: 'command' | 'stdout' | 'stderr' | 'system'; text: string };

export function TerminalPage() {
  const [cwd, setCwd] = useState('');
  const [command, setCommand] = useState('');
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([
    { kind: 'system', text: 'Android shell runs as this app, without root. Commands can access only what the app UID can access.' },
    { kind: 'system', text: 'This is a streamed shell process, not a PTY. Full-screen/TTY-dependent CLI tools may not work.' },
  ]);
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const outputRef = useRef<HTMLPreElement>(null);
  const available = isAndroidRuntimeAvailable();

  useEffect(() => {
    if (!available) return;
    let outputListener: { remove: () => Promise<void> } | undefined;
    let exitListener: { remove: () => Promise<void> } | undefined;
    let active = true;
    void AndroidRuntime.addListener('runtimeOutput', (event: RuntimeOutputEvent) => {
      if (!active) return;
      setLines((current) => [...current, { kind: event.stream, text: event.text }]);
    }).then((listener) => {
      outputListener = listener;
    });
    void AndroidRuntime.addListener('runtimeExit', (event: RuntimeExitEvent) => {
      if (!active) return;
      setLines((current) => [...current, {
        kind: 'system',
        text: event.timedOut ? 'Command stopped after its time limit.' : `Command exited with code ${event.exitCode}.`,
      }]);
      setSessionId((current) => current === event.sessionId ? '' : current);
      setBusy(false);
    }).then((listener) => {
      exitListener = listener;
    });
    return () => {
      active = false;
      void outputListener?.remove();
      void exitListener?.remove();
    };
  }, [available]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;

    if (sessionId) {
      try {
        await AndroidRuntime.sendInput({ sessionId, text: `${value}\n` });
        setLines((current) => [...current, { kind: 'command', text: value }]);
      } catch (error) {
        setLines((current) => [...current, { kind: 'system', text: error instanceof Error ? error.message : 'Could not send input.' }]);
      }
      setCommand('');
      return;
    }

    if (value === 'clear') {
      setLines([]);
      setCommand('');
      return;
    }
    if (value === 'help') {
      setLines((current) => [...current,
        { kind: 'command', text: value },
        { kind: 'system', text: 'Run Android shell commands here. `cd folder` changes the app-private working folder; `clear` clears this view. Set an optional timeout in the field below.' },
      ]);
      setCommand('');
      return;
    }
    if (/^cd(?:\s+|$)/.test(value)) {
      const destination = value.replace(/^cd\s*/, '').trim();
      try {
        const nextPath = destination ? safeRelativeJoin(cwd, destination) : '';
        await AndroidRuntime.listFiles({ path: nextPath });
        setCwd(nextPath);
        setLines((current) => [...current, { kind: 'command', text: value }, { kind: 'system', text: `Working folder: /workspace${nextPath ? `/${nextPath}` : ''}` }]);
      } catch (error) {
        setLines((current) => [...current, { kind: 'command', text: value }, { kind: 'stderr', text: error instanceof Error ? error.message : 'Folder not found.' }]);
      }
      setCommand('');
      return;
    }

    setBusy(true);
    setLines((current) => [...current, { kind: 'command', text: `/workspace${cwd ? `/${cwd}` : ''} $ ${value}` }]);
    setCommand('');
    try {
      const session = await AndroidRuntime.startCommand({ command: value, cwd, timeoutMs });
      setSessionId(session.sessionId);
    } catch (error) {
      setBusy(false);
      setLines((current) => [...current, { kind: 'stderr', text: error instanceof Error ? error.message : 'Could not start command.' }]);
    }
  };

  const checkCliBinaries = () => {
    setCommand('for tool in git python python3 node npm claude codex gemini aider; do command -v "$tool" 2>/dev/null || true; done');
  };

  if (!available) return <RuntimeUnavailable feature="The Android shell" />;

  return (
    <div className="content-wrap">
      <div className="runtime-intro">
        <div>
          <p className="eyebrow">USER-RUN ANDROID COMMANDS</p>
          <h2>Run commands in the private workspace</h2>
          <p>Commands start in the private workspace and run as this app's Android user, without root. The shell is not jailed to that folder and can access other files Android permits to this app.</p>
        </div>
        <button className="secondary-button runtime-refresh" onClick={checkCliBinaries} disabled={busy}>Insert CLI check</button>
      </div>
      <section className="runtime-panel terminal-panel">
        <div className="terminal-topline">
          <span className="terminal-led" />
          <strong>Android shell</strong>
          <span className="terminal-cwd">/workspace{cwd ? `/${cwd}` : ''}</span>
          {sessionId ? <button className="secondary-button terminal-stop" onClick={() => void AndroidRuntime.closeInput({ sessionId })}>End input</button> : null}
          {sessionId ? <button className="secondary-button terminal-stop" onClick={() => void AndroidRuntime.stopCommand({ sessionId })}><Square size={13} /> Stop</button> : null}
        </div>
        <pre className="terminal-output" ref={outputRef} aria-live="polite">
          {lines.map((line, index) => <span className={`terminal-line terminal-${line.kind}`} key={`${index}-${line.text.slice(0, 20)}`}>{line.text.endsWith('\n') ? line.text : `${line.text}\n`}</span>)}
          {busy ? <span className="terminal-cursor">▌</span> : null}
        </pre>
        <form className="terminal-input-row" onSubmit={submit}>
          <span className="terminal-prompt">{sessionId ? 'input ›' : '$'}</span>
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={sessionId ? 'Send input to running command' : 'Try: pwd, ls, mkdir notes'} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Android shell command" />
          <button className="primary-button" type="submit" disabled={!command.trim()}>{sessionId ? 'Send' : 'Run'}</button>
        </form>
        <div className="terminal-options">
          <label>Timeout
            <select aria-label="Command timeout" onChange={(event) => setTimeoutMs(Number(event.target.value) * 1_000)} value={String(timeoutMs / 1_000)}>
              <option value="15">15 seconds</option><option value="60">60 seconds</option><option value="180">3 minutes</option>
            </select>
          </label>
          <span>Manual commands only. App data is accessible to the shell; no AI agent runs commands automatically.</span>
        </div>
      </section>
    </div>
  );
}

