import type { Agent, MobileSnapshot } from '@workspace/api-client-react';

const STORAGE_KEY = 'munder-difflin-mobile-snapshot-v1';
const OMNIROUTE_CONFIG_KEY = 'munder-difflin-omniroute-config-v1';

export type OmniRouteConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type PhoneQueueItem = {
  id: string;
  agentId: string;
  subject: string;
  body: string;
  createdAt: string;
  status: 'queued' | 'processing' | 'waiting_for_engine' | 'failed';
  attempts?: number;
  lastError?: string;
  retryAt?: string;
};

export type PhoneThreadMessage = {
  id: string;
  agentId: string;
  subject: string;
  body: string;
  timestamp: string;
  direction: 'human' | 'agent' | 'system';
};

export type PhoneSession = {
  agentId: string;
  state: 'idle' | 'waiting' | 'working' | 'blocked';
  lastEvent: string;
  lastEventAt: string;
};

export type PhoneSnapshot = MobileSnapshot & {
  queue: PhoneQueueItem[];
  threads: Record<string, PhoneThreadMessage[]>;
  sessions: Record<string, PhoneSession>;
};

export function getOmniRouteConfig(): OmniRouteConfig {
  try {
    const stored = localStorage.getItem(OMNIROUTE_CONFIG_KEY);
    if (stored) {
      const value = JSON.parse(stored) as Partial<OmniRouteConfig>;
      return {
        baseUrl: value.baseUrl ?? '',
        apiKey: value.apiKey ?? '',
        model: value.model ?? 'auto',
      };
    }
  } catch {
    // Keep settings unavailable rather than breaking the app.
  }
  return { baseUrl: '', apiKey: '', model: 'auto' };
}

export function saveOmniRouteConfig(config: OmniRouteConfig): void {
  const normalized = {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || 'auto',
  };
  try { localStorage.setItem(OMNIROUTE_CONFIG_KEY, JSON.stringify(normalized)); } catch { /* memory-only mode */ }
}

const now = () => new Date().toISOString();
const makeId = (prefix: string) => {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return prefix + '-' + uuid;
};
const MAX_RUNTIME_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];
let queueDrainPromise: Promise<void> | null = null;
let queueDrainTimer: number | null = null;
let fallbackInstalled = false;

const seedAgents: Agent[] = [
  { id: 'michael', name: 'Michael', role: 'Regional Manager', provider: 'Phone mode', model: 'Local', status: 'idle', currentTask: null, progress: 0, color: '#e7a84b', lastActive: now() },
  { id: 'jim', name: 'Jim', role: 'Project Lead', provider: 'Phone mode', model: 'Local', status: 'idle', currentTask: null, progress: 0, color: '#5bb7ad', lastActive: now() },
  { id: 'pam', name: 'Pam', role: 'Coordinator', provider: 'Phone mode', model: 'Local', status: 'idle', currentTask: null, progress: 0, color: '#b98ad9', lastActive: now() },
];

function initialSnapshot(): PhoneSnapshot {
  const timestamp = now();
  return {
    workspaceName: 'Munder Difflin · Phone mode',
    connected: false,
    updatedAt: timestamp,
    agents: seedAgents,
    tasks: [],
    inbox: [],
    memory: [],
    activity: [{ id: makeId('activity'), label: 'Phone mode ready', detail: 'Local mobile workspace is ready to use.', timestamp, type: 'system' }],
    queue: [],
    threads: {},
    sessions: Object.fromEntries(seedAgents.map((agent) => [agent.id, {
      agentId: agent.id,
      state: 'idle' as const,
      lastEvent: 'Session ready',
      lastEventAt: timestamp,
    }])),
  };
}

function loadSnapshot(): PhoneSnapshot {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PhoneSnapshot>;
      const base = initialSnapshot();
      const restoredQueue = (parsed.queue ?? base.queue).map((item) =>
        item.status === 'processing' ? { ...item, status: 'queued' as const } : item,
      );
      const restoredSessions = parsed.sessions ?? base.sessions;
      return {
        ...base,
        ...parsed,
        queue: restoredQueue,
        threads: parsed.threads ?? base.threads,
        sessions: Object.fromEntries(Object.entries(restoredSessions).map(([agentId, session]) => [
          agentId,
          session.state === 'working' ? { ...session, state: 'waiting' as const, lastEvent: 'App resumed; queued work will continue', lastEventAt: now() } : session,
        ])),
      };
    }
  } catch {
    // A private browsing/WebView storage failure should not stop the app booting.
  }
  return initialSnapshot();
}

let snapshot = loadSnapshot();

function saveSnapshot(): void {
  snapshot = { ...snapshot, updatedAt: now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* memory-only mode */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('munder-snapshot-updated'));
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  try { return JSON.parse(init.body) as Record<string, unknown>; } catch { return {}; }
}

async function askOmniRoute(agent: Agent, subject: string, body: string): Promise<string> {
  const config = getOmniRouteConfig();
  if (!config.baseUrl || !config.apiKey) throw new Error('OmniRoute is not configured');

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages: [
          {
            role: 'system',
            content: `You are ${agent.name}, the ${agent.role} in a Munder Difflin multi-agent office. Reply briefly, clearly, and include the next concrete action when one is needed.`,
          },
          { role: 'user', content: `${subject}\n\n${body}` },
        ],
      }),
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('OmniRoute timed out after 45 seconds');
    }
    throw error instanceof Error ? error : new Error('Could not reach OmniRoute');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json() as { error?: { message?: string } | string; message?: string };
      detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? '';
    } catch {
      detail = (await response.text()).trim();
    }
    clearTimeout(timeout);
    throw new Error(`OmniRoute HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
  }

  const contentFromChoice = (choice: { delta?: { content?: unknown }; message?: { content?: unknown } }) => {
    const content = choice.delta?.content ?? choice.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => typeof part === 'string' ? part : typeof part === 'object' && part && 'text' in part && typeof part.text === 'string' ? part.text : '')
        .join('');
    }
    return '';
  };

  if (!response.body || typeof response.body.getReader !== 'function') {
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    clearTimeout(timeout);
    const answer = contentFromChoice(data.choices?.[0] ?? {}).trim();
    if (!answer) throw new Error('OmniRoute returned an empty reply');
    return answer;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  const consumeFrame = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> };
      answer += contentFromChoice(data.choices?.[0] ?? {});
    } catch {
      // Ignore malformed keep-alive frames; valid providers send JSON per data line.
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(consumeFrame);
  }
  buffer += decoder.decode();
  buffer.split(/\r?\n/).forEach(consumeFrame);
  clearTimeout(timeout);
  answer = answer.trim();
  if (!answer) throw new Error('OmniRoute returned an empty reply');
  return answer;
}

/**
 * The Android build has no desktop process behind /api. This small runtime
 * turns the phone into a durable queue worker when OmniRoute is configured.
 * It intentionally remains local to the WebView: no key is bundled in the APK
 * and no message is sent until the user configures a runtime endpoint.
 */
function scheduleQueueDrain(delay = 0): void {
  if (typeof window === 'undefined') return;
  if (queueDrainTimer !== null) window.clearTimeout(queueDrainTimer);
  queueDrainTimer = window.setTimeout(() => {
    queueDrainTimer = null;
    void drainQueue();
  }, delay);
}

function nextReadyQueueItem(): PhoneQueueItem | undefined {
  const timestamp = Date.now();
  return snapshot.queue.find((item) =>
    item.status === 'queued' && (!item.retryAt || Date.parse(item.retryAt) <= timestamp),
  );
}

function setQueueItem(itemId: string, update: Partial<PhoneQueueItem>): void {
  snapshot = {
    ...snapshot,
    queue: snapshot.queue.map((item) => item.id === itemId ? { ...item, ...update } : item),
  };
  saveSnapshot();
}

async function processQueueItem(item: PhoneQueueItem): Promise<void> {
  const agent = snapshot.agents.find((candidate) => candidate.id === item.agentId);
  if (!agent) {
    setQueueItem(item.id, { status: 'failed', lastError: 'The selected agent no longer exists.' });
    return;
  }

  const startedAt = now();
  snapshot = {
    ...snapshot,
    agents: snapshot.agents.map((candidate) => candidate.id === agent.id ? {
      ...candidate,
      status: 'working',
      currentTask: item.subject,
      lastActive: startedAt,
    } : candidate),
    queue: snapshot.queue.map((candidate) => candidate.id === item.id ? {
      ...candidate,
      status: 'processing',
      lastError: undefined,
      retryAt: undefined,
    } : candidate),
    sessions: {
      ...snapshot.sessions,
      [agent.id]: { agentId: agent.id, state: 'working', lastEvent: 'Generating a reply via OmniRoute', lastEventAt: startedAt },
    },
    activity: [{ id: makeId('activity'), label: 'Agent runtime started', detail: `${agent.name} is working on ${item.subject}.`, timestamp: startedAt, type: 'agent' }, ...snapshot.activity],
  };
  saveSnapshot();

  try {
    const reply = await askOmniRoute(agent, item.subject, item.body);
    const repliedAt = now();
    const replyInbox = {
      id: makeId('message'),
      agentId: agent.id,
      agentName: agent.name,
      subject: `Re: ${item.subject}`,
      body: reply,
      timestamp: repliedAt,
      unread: true,
      kind: 'update' as const,
    };
    const replyThread: PhoneThreadMessage = {
      id: makeId('thread'),
      agentId: agent.id,
      subject: `Re: ${item.subject}`,
      body: reply,
      timestamp: repliedAt,
      direction: 'agent',
    };
    snapshot = {
      ...snapshot,
      agents: snapshot.agents.map((candidate) => candidate.id === agent.id ? { ...candidate, status: 'idle', currentTask: null, lastActive: repliedAt } : candidate),
      inbox: [replyInbox, ...snapshot.inbox],
      queue: snapshot.queue.filter((candidate) => candidate.id !== item.id),
      threads: { ...snapshot.threads, [agent.id]: [...(snapshot.threads[agent.id] ?? []), replyThread] },
      sessions: { ...snapshot.sessions, [agent.id]: { agentId: agent.id, state: 'idle', lastEvent: 'Replied via OmniRoute', lastEventAt: repliedAt } },
      activity: [{ id: makeId('activity'), label: 'Agent replied', detail: `${agent.name} replied through OmniRoute.`, timestamp: repliedAt, type: 'agent' }, ...snapshot.activity],
    };
    saveSnapshot();
  } catch (error) {
    const attempts = (item.attempts ?? 0) + 1;
    const message = error instanceof Error ? error.message : 'OmniRoute request failed';
    const retryable = attempts < MAX_RUNTIME_ATTEMPTS;
    const retryAt = retryable ? new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString() : undefined;
    const failedAt = now();
    snapshot = {
      ...snapshot,
      agents: snapshot.agents.map((candidate) => candidate.id === agent.id ? {
        ...candidate,
        status: retryable ? 'waiting' : 'offline',
        currentTask: retryable ? 'Retrying agent runtime' : null,
        lastActive: failedAt,
      } : candidate),
      queue: snapshot.queue.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        status: retryable ? 'queued' : 'failed',
        attempts,
        lastError: message,
        retryAt,
      } : candidate),
      sessions: {
        ...snapshot.sessions,
        [agent.id]: {
          agentId: agent.id,
          state: retryable ? 'waiting' : 'blocked',
          lastEvent: retryable ? `Runtime retry ${attempts}/${MAX_RUNTIME_ATTEMPTS} scheduled` : message,
          lastEventAt: failedAt,
        },
      },
      activity: [{
        id: makeId('activity'),
        label: retryable ? 'Agent runtime retry scheduled' : 'Agent runtime blocked',
        detail: `${agent.name}: ${message}`,
        timestamp: failedAt,
        type: 'system',
      }, ...snapshot.activity],
    };
    saveSnapshot();
    if (retryable && retryAt) scheduleQueueDrain(Math.max(0, Date.parse(retryAt) - Date.now()));
  }
}

export function drainQueue(): Promise<void> {
  if (queueDrainPromise) return queueDrainPromise;
  queueDrainPromise = (async () => {
    const config = getOmniRouteConfig();
    if (!config.baseUrl || !config.apiKey) return;
    while (true) {
      const item = nextReadyQueueItem();
      if (!item) return;
      await processQueueItem(item);
    }
  })().finally(() => {
    queueDrainPromise = null;
  });
  return queueDrainPromise;
}

export function kickQueueDrain(): void {
  const config = getOmniRouteConfig();
  if (!config.baseUrl || !config.apiKey) return;
  const waiting = snapshot.queue.some((item) => item.status === 'waiting_for_engine');
  if (waiting) {
    snapshot = {
      ...snapshot,
      queue: snapshot.queue.map((item) => item.status === 'waiting_for_engine' ? { ...item, status: 'queued', attempts: 0, lastError: undefined } : item),
      sessions: Object.fromEntries(Object.entries(snapshot.sessions).map(([agentId, session]) => [
        agentId,
        session.state === 'blocked' || session.state === 'waiting' ? { ...session, state: 'waiting', lastEvent: 'Runtime configured; waiting to send', lastEventAt: now() } : session,
      ])),
    };
    saveSnapshot();
  }
  void drainQueue();
}

export function retryFailedQueue(): void {
  const retryable = snapshot.queue.some((item) => item.status === 'failed');
  if (!retryable) return;
  snapshot = {
    ...snapshot,
    queue: snapshot.queue.map((item) => item.status === 'failed' ? {
      ...item,
      status: 'queued',
      attempts: 0,
      lastError: undefined,
      retryAt: undefined,
    } : item),
  };
  saveSnapshot();
  kickQueueDrain();
}

export function installLocalApiFallback(): void {
  if (typeof window === 'undefined' || import.meta.env.VITE_API_BASE_URL || fallbackInstalled) return;
  fallbackInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(requestUrl(input), window.location.origin);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

    if (url.pathname === '/api/healthz') return jsonResponse({ status: 'local-phone-mode' });
    if (url.pathname === '/api/mobile/snapshot' && (init?.method ?? 'GET').toUpperCase() === 'GET') {
      return jsonResponse(snapshot);
    }

    const messageMatch = url.pathname.match(/^\/api\/mobile\/agents\/([^/]+)\/message$/);
    if (messageMatch && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      const body = requestBody(init);
      const agent = snapshot.agents.find((item) => item.id === decodeURIComponent(messageMatch[1]));
      if (!agent || typeof body.subject !== 'string' || typeof body.body !== 'string' || !body.subject.trim() || !body.body.trim()) {
        return jsonResponse({ message: 'Agent, subject and message are required.' }, 400);
      }
      const timestamp = now();
      const subject = body.subject.trim();
      const messageBody = body.body.trim();
      const runtime = getOmniRouteConfig();
      const configured = Boolean(runtime.baseUrl && runtime.apiKey);
      const threadMessage: PhoneThreadMessage = {
        id: makeId('thread'),
        agentId: agent.id,
        subject,
        body: messageBody,
        timestamp,
        direction: 'human',
      };
      snapshot = {
        ...snapshot,
        agents: snapshot.agents.map((item) => item.id === agent.id ? { ...item, status: 'waiting', currentTask: 'Waiting for agent runtime', lastActive: timestamp } : item),
        inbox: [{ id: makeId('message'), agentId: agent.id, agentName: agent.name, subject, body: messageBody, timestamp, unread: false, kind: 'sent' }, ...snapshot.inbox],
        queue: [{ id: makeId('queue'), agentId: agent.id, subject, body: messageBody, createdAt: timestamp, status: configured ? 'queued' : 'waiting_for_engine', attempts: 0 }, ...snapshot.queue],
        threads: { ...snapshot.threads, [agent.id]: [...(snapshot.threads[agent.id] ?? []), threadMessage] },
        sessions: { ...snapshot.sessions, [agent.id]: { agentId: agent.id, state: 'waiting', lastEvent: 'Message queued; agent runtime is not connected', lastEventAt: timestamp } },
        activity: [{ id: makeId('activity'), label: 'Message queued', detail: agent.name + ' is waiting for the agent runtime.', timestamp, type: 'message' }, ...snapshot.activity],
      };
      saveSnapshot();
      if (configured) void drainQueue();
      return jsonResponse({ ok: true, queued: true, processing: configured }, 202);
    }

    if (url.pathname === '/api/mobile/queue/retry' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      retryFailedQueue();
      return jsonResponse({ ok: true });
    }

    const taskMatch = url.pathname.match(/^\/api\/mobile\/tasks\/([^/]+)$/);
    if (taskMatch && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
      const body = requestBody(init);
      const taskIndex = snapshot.tasks.findIndex((item) => item.id === decodeURIComponent(taskMatch[1]));
      if (taskIndex < 0 || typeof body.status !== 'string') return jsonResponse({ message: 'Task or status not found.' }, 404);
      const tasks = [...snapshot.tasks];
      tasks[taskIndex] = { ...tasks[taskIndex], status: body.status as typeof tasks[number]['status'], updatedAt: now() };
      snapshot = { ...snapshot, tasks, activity: [{ id: makeId('activity'), label: 'Task updated', detail: tasks[taskIndex].title, timestamp: now(), type: 'task' }, ...snapshot.activity] };
      saveSnapshot();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ message: 'This endpoint is not available in phone mode.' }, 404);
  };

  window.addEventListener('online', kickQueueDrain);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickQueueDrain();
  });
  kickQueueDrain();
}
