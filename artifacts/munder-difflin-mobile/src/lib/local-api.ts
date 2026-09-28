import type { Agent, MobileSnapshot } from '@workspace/api-client-react';

const STORAGE_KEY = 'munder-difflin-mobile-snapshot-v1';

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

function initialSnapshot(): MobileSnapshot {
  return {
    workspaceName: 'Munder Difflin · Phone mode',
    connected: false,
    updatedAt: now(),
    agents: seedAgents,
    tasks: [],
    inbox: [],
    memory: [],
    activity: [{ id: makeId('activity'), label: 'Phone mode ready', detail: 'Local mobile workspace is ready to use.', timestamp: now(), type: 'system' }],
  };
}

function loadSnapshot(): MobileSnapshot {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as MobileSnapshot;
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
      snapshot = {
        ...snapshot,
        inbox: [{ id: makeId('message'), agentId: agent.id, agentName: agent.name, subject: body.subject.trim(), body: body.body.trim(), timestamp, unread: false, kind: 'sent' }, ...snapshot.inbox],
        activity: [{ id: makeId('activity'), label: 'Message sent', detail: 'A note was saved for ' + agent.name + '.', timestamp, type: 'message' }, ...snapshot.activity],
      };
      saveSnapshot();
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
}
