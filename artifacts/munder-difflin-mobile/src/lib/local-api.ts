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
  status: 'queued' | 'waiting_for_engine';
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
      return {
        ...base,
        ...parsed,
        queue: parsed.queue ?? base.queue,
        threads: parsed.threads ?? base.threads,
        sessions: parsed.sessions ?? base.sessions,
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
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
  if (!response.ok) throw new Error(`OmniRoute HTTP ${response.status}`);
  if (!response.body) {
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('OmniRoute returned an empty reply');
    return answer;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        answer += data.choices?.[0]?.delta?.content ?? '';
      } catch {
        // Ignore a partial SSE frame; the next chunk completes it.
      }
    }
  }
  answer += decoder.decode();
  const trailingFrames = buffer.split(/\r?\n/);
  for (const line of trailingFrames) {
    if (!line.startsWith('data:')) continue;
    try {
      const data = JSON.parse(line.slice(5).trim()) as { choices?: Array<{ delta?: { content?: string } }> };
      answer += data.choices?.[0]?.delta?.content ?? '';
    } catch {
      // The stream may end on a delimiter.
    }
  }
  answer = answer.trim();
  if (!answer) throw new Error('OmniRoute returned an empty reply');
  return answer;
}

/**
 * The Android build has no desktop process behind /api. Keep the command center
 * usable in phone-only mode until a real mobile agent runtime is wired in.
 */
export function installLocalApiFallback(): void {
  if (typeof window === 'undefined' || import.meta.env.VITE_API_BASE_URL) return;
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
        queue: [{ id: makeId('queue'), agentId: agent.id, subject, body: messageBody, createdAt: timestamp, status: 'waiting_for_engine' }, ...snapshot.queue],
        threads: { ...snapshot.threads, [agent.id]: [...(snapshot.threads[agent.id] ?? []), threadMessage] },
        sessions: { ...snapshot.sessions, [agent.id]: { agentId: agent.id, state: 'waiting', lastEvent: 'Message queued; agent runtime is not connected', lastEventAt: timestamp } },
        activity: [{ id: makeId('activity'), label: 'Message queued', detail: agent.name + ' is waiting for the agent runtime.', timestamp, type: 'message' }, ...snapshot.activity],
      };
      saveSnapshot();
      const config = getOmniRouteConfig();
      if (!config.baseUrl || !config.apiKey) return jsonResponse({ ok: true, queued: true });

      try {
        const reply = await askOmniRoute(agent, subject, messageBody);
        const replyAt = now();
        const replyInbox = {
          id: makeId('message'),
          agentId: agent.id,
          agentName: agent.name,
          subject: `Re: ${subject}`,
          body: reply,
          timestamp: replyAt,
          unread: true,
          kind: 'update' as const,
        };
        const replyThread: PhoneThreadMessage = {
          id: makeId('thread'),
          agentId: agent.id,
          subject: `Re: ${subject}`,
          body: reply,
          timestamp: replyAt,
          direction: 'agent',
        };
        snapshot = {
          ...snapshot,
          agents: snapshot.agents.map((item) => item.id === agent.id ? { ...item, status: 'idle', currentTask: null, lastActive: replyAt } : item),
          inbox: [replyInbox, ...snapshot.inbox],
          queue: snapshot.queue.filter((item) => item.agentId !== agent.id || item.subject !== subject || item.body !== messageBody),
          threads: { ...snapshot.threads, [agent.id]: [...(snapshot.threads[agent.id] ?? []), replyThread] },
          sessions: { ...snapshot.sessions, [agent.id]: { agentId: agent.id, state: 'idle', lastEvent: 'Replied via OmniRoute', lastEventAt: replyAt } },
          activity: [{ id: makeId('activity'), label: 'Agent replied', detail: agent.name + ' replied through OmniRoute.', timestamp: replyAt, type: 'agent' }, ...snapshot.activity],
        };
        saveSnapshot();
        return jsonResponse({ ok: true, replied: true });
      } catch (error) {
        const failedAt = now();
        snapshot = {
          ...snapshot,
          sessions: { ...snapshot.sessions, [agent.id]: { agentId: agent.id, state: 'blocked', lastEvent: error instanceof Error ? error.message : 'OmniRoute request failed', lastEventAt: failedAt } },
          activity: [{ id: makeId('activity'), label: 'Agent runtime blocked', detail: agent.name + ' could not reach OmniRoute.', timestamp: failedAt, type: 'system' }, ...snapshot.activity],
        };
        saveSnapshot();
        return jsonResponse({ ok: false, queued: true, message: 'Message queued; OmniRoute could not reply.' }, 202);
      }
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
}
