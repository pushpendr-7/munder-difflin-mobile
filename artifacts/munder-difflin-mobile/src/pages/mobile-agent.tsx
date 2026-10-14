import './mobile-agent.css';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ArrowUp, Check, ChevronDown, Code2, LoaderCircle, RotateCcw, Settings2, ShieldCheck, Square, WandSparkles, X } from 'lucide-react';
import { AndroidRuntime, isAndroidRuntimeAvailable } from '@workspace/android-runtime';
import { getOmniRouteConfig } from '@/lib/local-api';
import {
  runMobileAgentTurn,
  type AgentApprovalRequest,
  type MobileAgentCallbacks,
  type MobileAgentMessage,
} from '@/lib/mobile-agent';

const STORAGE_KEY = 'munder-difflin-mobile-agent-thread-v1';

type ApprovalResolver = {
  resolve: (approved: boolean) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

function loadThread(): MobileAgentMessage[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((message): message is MobileAgentMessage => {
      if (!message || typeof message !== 'object') return false;
      const item = message as Record<string, unknown>;
      if (!['user', 'assistant', 'tool'].includes(String(item.role))) return false;
      if (item.role === 'assistant') return item.content === null || typeof item.content === 'string';
      return typeof item.content === 'string';
    }).slice(-60);
  } catch {
    return [];
  }
}

function toolLabel(name?: string) {
  return (name ?? 'workspace tool').replaceAll('_', ' ');
}

export function MobileAgentPage() {
  const [messages, setMessages] = useState<MobileAgentMessage[]>(loadThread);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [approval, setApproval] = useState<AgentApprovalRequest | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const approvalRef = useRef<ApprovalResolver | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const androidAvailable = isAndroidRuntimeAvailable();
  const runtimeConfigured = Boolean(getOmniRouteConfig().baseUrl && getOmniRouteConfig().apiKey);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
    } catch {
      setError('Could not save this conversation on the phone. The current thread will remain until the app closes.');
    }
  }, [messages]);

  useEffect(() => () => {
    const pending = approvalRef.current;
    if (pending) {
      pending.signal.removeEventListener('abort', pending.onAbort);
      approvalRef.current = null;
      pending.resolve(false);
    }
    controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, approval]);

  const finishApproval = useCallback((accepted: boolean) => {
    const pending = approvalRef.current;
    approvalRef.current = null;
    if (pending) {
      pending.signal.removeEventListener('abort', pending.onAbort);
      pending.resolve(accepted);
    }
    setApproval(null);
  }, []);

  const requestApproval = useCallback((request: AgentApprovalRequest, signal: AbortSignal) => new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      if (approvalRef.current?.signal === signal) {
        approvalRef.current = null;
        setApproval(null);
        resolve(false);
      }
    };
    approvalRef.current = { resolve, signal, onAbort };
    signal.addEventListener('abort', onAbort, { once: true });
    setApproval(request);
  }), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy || !androidAvailable || !runtimeConfigured) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setInput('');
    setBusy(true);
    setError('');
    setStatus('Starting the local agent…');

    const callbacks: MobileAgentCallbacks = {
      requestApproval: (request) => requestApproval(request, controller.signal),
      onTranscript: (nextMessages) => setMessages(nextMessages.slice(-60)),
      onStatus: setStatus,
      onCommandSession: setActiveSessionId,
    };

    try {
      await runMobileAgentTurn(messages, prompt, callbacks, controller.signal);
    } catch (runError) {
      if (!controller.signal.aborted) {
        setError(runError instanceof Error ? runError.message : 'The mobile agent could not finish this task.');
      }
    } finally {
      finishApproval(false);
      if (controllerRef.current === controller) controllerRef.current = null;
      setActiveSessionId(null);
      setBusy(false);
      setStatus('');
    }
  };

  const stopRun = () => {
    controllerRef.current?.abort();
    if (activeSessionId) void AndroidRuntime.stopCommand({ sessionId: activeSessionId }).catch(() => undefined);
    finishApproval(false);
    setStatus('Stopping…');
  };

  const clearThread = () => {
    if (busy) return;
    setMessages([]);
    setError('');
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage may be disabled */ }
  };

  if (!androidAvailable) {
    return (
      <div className="content-wrap">
        <section className="mobile-agent-unavailable">
          <div className="mobile-agent-icon"><Code2 size={21} /></div>
          <div>
            <p className="eyebrow">ANDROID APK FEATURE</p>
            <h2>Mobile coding agent</h2>
            <p>The agent uses the APK's private workspace and native Android runtime. Install the Android APK to use it; browser/PWA preview cannot run those native tools.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="content-wrap mobile-agent-page">
      <section className="mobile-agent-header">
        <div className="mobile-agent-title">
          <div className="mobile-agent-icon"><WandSparkles size={20} /></div>
          <div>
            <p className="eyebrow">ON-DEVICE CODING ASSISTANT</p>
            <h2>Build in your private workspace</h2>
            <p>OmniRoute provides the model. Files stay in the APK's private workspace unless you ask the model to read them.</p>
          </div>
        </div>
        <div className="mobile-agent-header-actions">
          {busy ? (
            <button className="secondary-button mobile-agent-stop" onClick={stopRun}><Square size={14} /> Stop</button>
          ) : (
            <button className="secondary-button mobile-agent-stop" onClick={clearThread} disabled={!messages.length} title="Clear this saved conversation">
              <RotateCcw size={14} /> Clear
            </button>
          )}
        </div>
      </section>

      {!runtimeConfigured ? (
        <section className="agent-setup-note">
          <Settings2 size={18} />
          <div><strong>Connect OmniRoute to start</strong><p>Add your OpenAI-compatible URL, API key, and a tool-calling model in Settings.</p></div>
          <Link href="/settings" className="secondary-button">Open settings</Link>
        </section>
      ) : null}

      <div className="agent-safety-note" role="note">
        <ShieldCheck size={17} />
        <p>Every file write and shell command waits for your approval. The Android shell is <strong>not sandboxed to the workspace</strong>; only approve commands you trust. Prompts and file contents sent to the model go to your configured OmniRoute endpoint.</p>
      </div>

      <section className="mobile-agent-console" aria-label="Coding agent conversation">
        <div className="mobile-agent-transcript" ref={scrollRef} aria-live="polite">
          {!messages.length ? (
            <div className="agent-empty-state">
              <div className="mobile-agent-icon"><Code2 size={21} /></div>
              <h3>What should we work on?</h3>
              <p>Ask the agent to inspect the workspace, plan a change, or edit a file. It will ask before writing files or running commands.</p>
              <div className="agent-suggestions">
                <button onClick={() => setInput('List the files in my workspace and explain what this project does.')} disabled={!runtimeConfigured || busy}>Explain my project</button>
                <button onClick={() => setInput('Review the current workspace and suggest the next useful improvement. Do not change files yet.')} disabled={!runtimeConfigured || busy}>Suggest an improvement</button>
              </div>
            </div>
          ) : messages.map((message, index) => {
            if (message.role === 'tool') {
              return (
                <details className="agent-tool-result" key={`tool-${index}`}>
                  <summary><ChevronDown size={14} /> {toolLabel(message.name)} result</summary>
                  <pre>{message.content}</pre>
                </details>
              );
            }
            if (!message.content) return null;
            return (
              <article className={`agent-message agent-message-${message.role}`} key={`${message.role}-${index}`}>
                <div className="agent-message-label">{message.role === 'user' ? 'You' : 'Munder agent'}</div>
                <p>{message.content}</p>
              </article>
            );
          })}
          {busy && status ? <div className="agent-thinking"><LoaderCircle size={15} className="spin" /> {status}</div> : null}
          <div />
        </div>

        {error ? <div className="agent-error" role="alert"><AlertTriangle size={15} />{error}</div> : null}

        <form className="agent-composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={runtimeConfigured ? 'Describe the coding task…' : 'Connect OmniRoute in Settings first'}
            aria-label="Task for the mobile coding agent"
            rows={3}
            maxLength={12_000}
            disabled={!runtimeConfigured || busy}
          />
          <div className="agent-composer-footer">
            <span>Android APK only · {input.length.toLocaleString()} / 12,000</span>
            <button className="primary-button agent-send" type="submit" disabled={!input.trim() || !runtimeConfigured || busy}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={16} />}
              {busy ? 'Working…' : 'Send task'}
            </button>
          </div>
        </form>
      </section>

      {approval ? (
        <div className="agent-approval-backdrop" role="presentation">
          <section className="agent-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-approval-title">
            <div className="agent-approval-heading">
              <span className={approval.kind === 'run_command' ? 'agent-approval-icon agent-approval-risk' : 'agent-approval-icon'}>{approval.kind === 'run_command' ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}</span>
              <div>
                <p className="eyebrow">REVIEW BEFORE THE AGENT ACTS</p>
                <h3 id="agent-approval-title">
                  {approval.kind === 'write_file' ? `Write ${approval.path}?` : approval.kind === 'create_directory' ? `Create ${approval.path}?` : 'Run this Android command?'}
                </h3>
              </div>
              <button className="mobile-agent-close" onClick={() => finishApproval(false)} aria-label="Decline action"><X size={18} /></button>
            </div>
            {approval.kind === 'run_command' ? (
              <>
                <div className="agent-approval-warning"><AlertTriangle size={16} /><p>This command runs as the app's Android UID. It is not jailed to the workspace and may access other files available to this app. Do not approve commands you cannot trust.</p></div>
                <pre className="agent-approval-preview agent-command-preview">{approval.command}</pre>
              </>
            ) : approval.kind === 'write_file' ? (
              <>
                <p className="agent-approval-detail">{approval.previousContent === null ? 'No readable previous text was found; this may be a new file.' : 'This will replace the current file contents.'} Proposed file size: {new TextEncoder().encode(approval.content).byteLength.toLocaleString()} bytes.</p>
                <details className="agent-approval-existing"><summary>{approval.previousContent === null ? 'No previous file content' : 'Show current content'}</summary><pre>{approval.previousContent ?? ''}</pre></details>
                <details className="agent-approval-proposed" open><summary>Proposed content</summary><pre>{approval.content}</pre></details>
              </>
            ) : (
              <p className="agent-approval-detail">The agent wants to create this folder inside the APK's private workspace.</p>
            )}
            <div className="agent-approval-actions">
              <button className="secondary-button" onClick={() => finishApproval(false)}><X size={14} /> Decline</button>
              <button className="primary-button" onClick={() => finishApproval(true)}><Check size={14} /> Approve this action</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
