import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity,
  Archive,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Command,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  ListTodo,
  ListOrdered,
  Menu,
  MessageCircle,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  RefreshCcw,
  Search,
  Send,
  Settings,
  Sun,
  Radio,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  getGetMobileSnapshotQueryKey,
  useGetMobileSnapshot,
  useSendMobileAgentMessage,
  useUpdateMobileTask,
} from '@workspace/api-client-react';
import type {
  ActivityItem,
  Agent,
  InboxMessage,
  MemoryEntry,
  MobileSnapshot,
  Task,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import type { PhoneQueueItem, PhoneSession, PhoneSnapshot, PhoneThreadMessage } from '@/lib/local-api';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Floor', shortLabel: 'Floor', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', shortLabel: 'Tasks', icon: ListTodo },
  { href: '/inbox', label: 'Inbox', shortLabel: 'Inbox', icon: Inbox },
  { href: '/queue', label: 'Message queue', shortLabel: 'Queue', icon: ListOrdered },
  { href: '/memory', label: 'Memory', shortLabel: 'Memory', icon: BrainCircuit },
  { href: '/activity', label: 'Activity', shortLabel: 'Activity', icon: Activity },
];

type SnapshotView = MobileSnapshot & Pick<PhoneSnapshot, 'queue' | 'threads' | 'sessions'>;

function phoneState(snapshot: MobileSnapshot): SnapshotView {
  const value = snapshot as Partial<SnapshotView>;
  return {
    ...snapshot,
    queue: value.queue ?? [],
    threads: value.threads ?? {},
    sessions: value.sessions ?? {},
  };
}

const statusLabels: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};

const statusColors: Record<string, string> = {
  backlog: 'status-backlog',
  in_progress: 'status-progress',
  review: 'status-review',
  done: 'status-done',
};

const activityIcons = {
  agent: Bot,
  task: ListTodo,
  message: MessageSquare,
  system: Command,
};

function timeAgo(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatStatus(status: string) {
  return statusLabels[status] ?? status.replace('_', ' ');
}

function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <AppShell />
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppShell() {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const snapshotQuery = useGetMobileSnapshot({
    query: {
      queryKey: getGetMobileSnapshotQueryKey(),
      // The phone-only build reads from local storage. Polling that same
      // object every five seconds makes the whole screen look like it is
      // constantly refreshing and needlessly wakes the Android WebView.
      // A connected office gets a modest live interval; local mode refreshes
      // only after an action or when the user taps refresh.
      refetchInterval: import.meta.env.VITE_API_BASE_URL ? 15000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: import.meta.env.VITE_API_BASE_URL ? 10000 : Infinity,
      retry: import.meta.env.VITE_API_BASE_URL ? 2 : false,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  });
  const snapshot = snapshotQuery.data;
  const officeLive = Boolean(snapshot?.connected) && !snapshotQuery.isRefetchError;
  const pageTitle = location === '/' ? 'Agent floor' : navItems.find((item) => item.href === location)?.label ?? 'Settings';

  return (
    <div className="app-frame">
      <aside className={`desktop-sidebar ${sidebarOpen ? 'mobile-sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Command size={17} strokeWidth={2.5} /></div>
          <div>
            <p className="brand-name">Munder Difflin</p>
            <p className="brand-caption">Mobile command center</p>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation">
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link href={item.href} className={`sidebar-link ${active ? 'sidebar-link-active' : ''}`} data-testid={`link-${item.shortLabel.toLowerCase()}`} key={item.href} onClick={() => setSidebarOpen(false)}>
                <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                <span>{item.label}</span>
                {item.href === '/inbox' && snapshot?.inbox.some((message) => message.unread) ? <span className="nav-dot" /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/settings" className={`sidebar-link ${location === '/settings' ? 'sidebar-link-active' : ''}`} data-testid="link-settings">
            <Settings size={18} />
            <span>Settings</span>
          </Link>
          <ConnectionPill connected={officeLive} loading={snapshotQuery.isFetching} />
          <p className="sidebar-footer">A quiet window into a busy office.</p>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" data-testid="button-close-menu" /> : null}

      <main className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation">
            <Menu size={21} />
          </button>
          <div className="topbar-title">
            <span className="eyebrow">MUNDER / DIFFLIN</span>
            <h1 data-testid="text-page-title">{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            <div className={`topbar-connection ${officeLive ? 'is-connected' : ''}`} data-testid="status-connection">
              <span className="connection-light" />
              <span className="connection-label">{snapshotQuery.isFetching ? 'Syncing' : officeLive ? 'Live' : 'Offline'}</span>
            </div>
            <button className="icon-button" onClick={() => snapshotQuery.refetch()} disabled={snapshotQuery.isFetching} aria-label="Refresh snapshot" data-testid="button-refresh-snapshot">
              <RefreshCcw size={17} className={snapshotQuery.isFetching ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <div className="page-scroll">
          {snapshotQuery.isLoading && !snapshot ? <LoadingState /> : null}
          {snapshotQuery.isError && !snapshot ? <ErrorState onRetry={() => snapshotQuery.refetch()} /> : null}
          {snapshot ? (
            <Switch>
              <Route path="/" component={() => <FloorPage snapshot={snapshot} />} />
              <Route path="/tasks" component={() => <TasksPage snapshot={snapshot} />} />
              <Route path="/inbox" component={() => <InboxPage snapshot={snapshot} />} />
              <Route path="/queue" component={() => <QueuePage snapshot={snapshot} />} />
              <Route path="/memory" component={() => <MemoryPage snapshot={snapshot} />} />
              <Route path="/activity" component={() => <ActivityPage snapshot={snapshot} />} />
              <Route path="/settings" component={() => <SettingsPage snapshot={snapshot} />} />
              <Route component={NotFound} />
            </Switch>
          ) : null}
        </div>
        <MobileNav location={location} unread={snapshot?.inbox.some((message) => message.unread) ?? false} />
      </main>
    </div>
  );
}

function ConnectionPill({ connected, loading }: { connected: boolean; loading?: boolean }) {
  return (
    <div className={`connection-pill ${connected ? 'connection-pill-live' : ''}`} data-testid="status-sidebar-connection">
      {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span>{loading ? 'Connecting to office' : connected ? 'Office connected' : 'Connection paused'}</span>
    </div>
  );
}

function MobileNav({ location, unread }: { location: string; unread: boolean }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {navItems.slice(0, 5).map((item) => {
        const Icon = item.icon;
        const active = location === item.href;
        return (
          <Link href={item.href} className={`mobile-nav-link ${active ? 'mobile-nav-link-active' : ''}`} data-testid={`mobile-link-${item.shortLabel.toLowerCase()}`} key={item.href}>
            <span className="mobile-nav-icon"><Icon size={18} /></span>
            <span>{item.shortLabel}</span>
            {item.href === '/inbox' && unread ? <span className="mobile-nav-dot" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function LoadingState() {
  return (
    <div className="content-wrap" data-testid="state-loading">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-grid"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></div>
      <div className="skeleton skeleton-list" />
      <p className="loading-label">Opening the office window…</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="content-wrap empty-state" data-testid="state-error">
      <div className="empty-icon error-icon"><WifiOff size={22} /></div>
      <p className="eyebrow">CONNECTION INTERRUPTED</p>
      <h2>The office is out of reach.</h2>
      <p>We could not read the latest floor snapshot. Check the connection and try again.</p>
      <button className="primary-button" onClick={onRetry} data-testid="button-retry-snapshot"><RefreshCcw size={16} /> Try again</button>
    </div>
  );
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="page-detail">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, detail, accent }: { label: string; value: string | number; detail: string; accent: string }) {
  return (
    <div className={`stat-card ${accent}`} data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}

function AgentAvatar({ agent, size = 'normal' }: { agent: Agent; size?: 'normal' | 'small' }) {
  return (
    <div className={`agent-avatar ${size === 'small' ? 'agent-avatar-small' : ''}`} style={{ '--agent-color': agent.color } as CSSProperties} data-testid={`avatar-agent-${agent.id}`}>
      {initials(agent.name)}
    </div>
  );
}

function AgentStatus({ status }: { status: Agent['status'] }) {
  return (
    <span className={`agent-status status-${status}`} data-testid={`status-agent-${status}`}>
      <span className="status-dot" /> {status}
    </span>
  );
}

function FloorPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const working = snapshot.agents.filter((agent) => agent.status === 'working');
  const unread = snapshot.inbox.filter((message) => message.unread).length;
  const activeTasks = snapshot.tasks.filter((task) => task.status !== 'done').length;
  return (
    <div className="content-wrap">
      <section className="floor-banner">
        <div className="banner-rings" aria-hidden="true"><span /><span /><span /></div>
        <div className="banner-copy">
          <p className="eyebrow eyebrow-light">REMOTE VIEW / {snapshot.workspaceName.toUpperCase()}</p>
          <h2>The office is <em>in motion.</em></h2>
          <p>{working.length} {working.length === 1 ? 'agent is' : 'agents are'} at the desk right now. Here is the signal worth your attention.</p>
        </div>
        <div className="banner-stamp"><span>SYNC</span><strong>{timeAgo(snapshot.updatedAt)}</strong><small>ago</small></div>
      </section>

      <div className="stats-row">
        <StatCard label="Agents online" value={snapshot.agents.filter((agent) => agent.status !== 'offline').length} detail={`${snapshot.agents.length} total seats`} accent="stat-amber" />
        <StatCard label="Open tasks" value={activeTasks} detail={`${snapshot.tasks.filter((task) => task.status === 'review').length} in review`} accent="stat-teal" />
        <StatCard label="Unread inbox" value={unread} detail="needs your eyes" accent="stat-coral" />
      </div>

      <div className="section-heading">
        <div><p className="eyebrow">THE FLOOR</p><h3>Agent desks</h3></div>
        <Link href="/activity" className="text-link" data-testid="link-view-activity">View activity <ArrowUpRight size={15} /></Link>
      </div>
      {snapshot.agents.length ? (
        <div className="agent-grid">
          {snapshot.agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)}
        </div>
      ) : (
        <CompactEmpty title="No agents on the floor" detail="When agents connect, their desks will appear here." />
      )}

      <AgentSessions snapshot={snapshot} />

      <section className="lower-grid">
        <div className="panel">
          <div className="panel-heading"><div><p className="eyebrow">RECENT SIGNAL</p><h3>Activity stream</h3></div><Activity size={18} className="panel-heading-icon" /></div>
          {snapshot.activity.slice(0, 4).map((item) => <ActivityRow item={item} key={item.id} />)}
          {!snapshot.activity.length ? <CompactEmpty title="No activity yet" detail="The office stream is quiet." /> : null}
        </div>
        <div className="panel pulse-panel">
          <div className="panel-heading"><div><p className="eyebrow">QUICK READ</p><h3>Desk pulse</h3></div><CircleDot size={18} className="panel-heading-icon pulse-icon" /></div>
          <div className="pulse-lines">
            {working.slice(0, 3).map((agent) => <div className="pulse-line" key={agent.id}><AgentAvatar agent={agent} size="small" /><div><strong>{agent.name}</strong><span>{agent.currentTask || 'Working without a task'}</span></div><span className="pulse-percent">{agent.progress}%</span></div>)}
            {!working.length ? <div className="quiet-pulse"><Clock3 size={18} /><span>All desks are between tasks.</span></div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <article className="agent-card" data-testid={`card-agent-${agent.id}`}>
      <div className="agent-card-top"><AgentAvatar agent={agent} /><div className="agent-meta"><strong>{agent.name}</strong><span>{agent.role}</span></div><button className="icon-button subtle-button" aria-label={`More options for ${agent.name}`} data-testid={`button-agent-options-${agent.id}`}><MoreHorizontal size={18} /></button></div>
      <div className="agent-card-provider"><span>{agent.provider}</span><span className="model-name">{agent.model}</span></div>
      <AgentStatus status={agent.status} />
      <p className="agent-task">{agent.currentTask || 'No active assignment'}</p>
      {agent.status === 'working' ? <div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, agent.progress))}%` }} /></div> : <div className="progress-track progress-muted"><span style={{ width: '100%' }} /></div>}
      <div className="agent-card-foot"><span>{agent.status === 'working' ? `${agent.progress}% complete` : `Last active ${timeAgo(agent.lastActive)} ago`}</span><span className="desk-code">{agent.id.slice(0, 6).toUpperCase()}</span></div>
    </article>
  );
}

function AgentSessions({ snapshot }: { snapshot: MobileSnapshot }) {
  const state = phoneState(snapshot);
  const active = state.agents.filter((agent) => state.sessions[agent.id]?.state !== 'idle');
  return (
    <section className="session-panel panel">
      <div className="panel-heading">
        <div><p className="eyebrow">PC-STYLE RUNTIME</p><h3>Agent sessions</h3></div>
        <Radio size={18} className="panel-heading-icon pulse-icon" />
      </div>
      <div className="session-runtime-note">
        <span className="session-runtime-dot" />
        <span>{state.connected ? 'Connected to the office runtime' : 'Phone session layer active'}</span>
        <Link href="/queue" className="text-link">Open queue <ArrowUpRight size={14} /></Link>
      </div>
      {active.length ? active.map((agent) => {
        const session = state.sessions[agent.id];
        return <SessionRow agent={agent} session={session} key={agent.id} />;
      }) : (
        <div className="session-idle"><Clock3 size={16} /><span>All sessions are idle. Send a note from Inbox to create a queued session.</span></div>
      )}
    </section>
  );
}

function SessionRow({ agent, session }: { agent: Agent; session?: PhoneSession }) {
  return (
    <div className="session-row">
      <AgentAvatar agent={agent} size="small" />
      <div className="session-copy"><strong>{agent.name}</strong><span>{session?.lastEvent ?? 'Session ready'}</span></div>
      <span className={`session-state session-state-${session?.state ?? 'idle'}`}>{session?.state ?? 'idle'}</span>
      <ChevronRight size={16} className="session-arrow" />
    </div>
  );
}

function TasksPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const queryClient = useQueryClient();
  const updateTask = useUpdateMobileTask();
  const visibleTasks = useMemo(() => snapshot.tasks.filter((task) => {
    const matchesFilter = filter === 'all' || task.status === filter;
    const text = `${task.key} ${task.title} ${task.description}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  }), [snapshot.tasks, filter, query]);
  const columns = ['backlog', 'in_progress', 'review', 'done'];

  const changeStatus = (task: Task, status: string) => {
    updateTask.mutate({ taskId: task.id, data: { status: status as 'backlog' | 'in_progress' | 'review' | 'done' } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMobileSnapshotQueryKey() }),
    });
  };

  return (
    <div className="content-wrap">
      <PageIntro eyebrow="WORK QUEUE" title="Tasks, in plain view." detail="Move work forward from wherever you are. Status changes sync back to the office." />
      <div className="toolbar">
        <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" data-testid="input-search-tasks" />{query ? <button onClick={() => setQuery('')} aria-label="Clear task search" data-testid="button-clear-task-search"><X size={15} /></button> : null}</div>
        <div className="filter-scroll" role="group" aria-label="Filter tasks">
          {['all', ...columns].map((status) => <button className={`filter-chip ${filter === status ? 'filter-chip-active' : ''}`} onClick={() => setFilter(status)} key={status} data-testid={`button-filter-${status}`}>{status === 'all' ? 'Everything' : formatStatus(status)}</button>)}
        </div>
      </div>
      {snapshot.tasks.length ? <div className="task-board">
        {columns.map((status) => {
          const columnTasks = visibleTasks.filter((task) => task.status === status);
          return <section className="task-column" key={status}><div className="task-column-heading"><span className={`column-marker ${statusColors[status]}`} /><h3>{formatStatus(status)}</h3><span className="column-count">{columnTasks.length}</span></div>{columnTasks.map((task) => <TaskCard task={task} onStatusChange={changeStatus} updating={updateTask.isPending} key={task.id} />)}{!columnTasks.length ? <div className="column-empty">Nothing here</div> : null}</section>;
        })}
      </div> : <CompactEmpty title="The task board is empty" detail="There is no work waiting in the queue." />}
      {visibleTasks.length === 0 && snapshot.tasks.length > 0 ? <div className="empty-inline"><Search size={16} /> No tasks match that view.</div> : null}
    </div>
  );
}

function TaskCard({ task, onStatusChange, updating }: { task: Task; onStatusChange: (task: Task, status: string) => void; updating: boolean }) {
  return (
    <article className="task-card" data-testid={`card-task-${task.id}`}>
      <div className="task-card-top"><span className="task-key">{task.key}</span><span className={`status-badge ${statusColors[task.status]}`}>{formatStatus(task.status)}</span></div>
      <h4>{task.title}</h4>
      <p>{task.description}</p>
      <div className="task-card-bottom"><span className="task-assignee">{task.assignee ? task.assignee : 'Unassigned'}</span><span className="task-updated">updated {timeAgo(task.updatedAt)}</span></div>
      <div className="status-select-wrap"><select value={task.status} onChange={(event) => onStatusChange(task, event.target.value)} disabled={updating} aria-label={`Change status for ${task.title}`} data-testid={`select-task-status-${task.id}`}><option value="backlog">Backlog</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="done">Done</option></select><ChevronDown size={14} /></div>
    </article>
  );
}

function QueuePage({ snapshot }: { snapshot: MobileSnapshot }) {
  const state = phoneState(snapshot);
  return (
    <div className="content-wrap">
      <PageIntro
        eyebrow="MESSAGE QUEUE"
        title="Work waiting at the desk."
        detail="This is the same handoff layer the desktop floor uses: queued messages stay visible until an agent runtime takes them."
        action={<Link href="/inbox" className="primary-button compose-button"><MessageCircle size={15} /> Open threads</Link>}
      />
      {state.queue.length ? (
        <div className="queue-list">
          {state.queue.map((item) => {
            const agent = state.agents.find((candidate) => candidate.id === item.agentId);
            return <QueueRow item={item} agent={agent} key={item.id} />;
          })}
        </div>
      ) : (
        <CompactEmpty title="Queue is clear" detail="Messages sent from Inbox will appear here before an agent session handles them." />
      )}
      <section className="queue-explainer panel">
        <ListOrdered size={18} className="panel-heading-icon" />
        <div><strong>Runtime status</strong><p>{state.connected ? 'The office runtime is connected and can drain this queue.' : 'The UI and queue are ready, but this standalone APK still needs an Android-compatible agent runtime to generate real replies.'}</p></div>
      </section>
    </div>
  );
}

function QueueRow({ item, agent }: { item: PhoneQueueItem; agent?: Agent }) {
  return (
    <article className="queue-row">
      {agent ? <AgentAvatar agent={agent} size="small" /> : <div className="empty-icon"><Bot size={16} /></div>}
      <div className="queue-copy"><div className="queue-topline"><strong>{agent?.name ?? 'Agent'}</strong><span>{timeAgo(item.createdAt)} ago</span></div><h3>{item.subject}</h3><p>{item.body}</p></div>
      <span className={`queue-status queue-status-${item.status}`}>{item.status === 'waiting_for_engine' ? 'Waiting' : 'Queued'}</span>
    </article>
  );
}

function InboxPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const phone = phoneState(snapshot);
  const [selectedAgentId, setSelectedAgentId] = useState(snapshot.agents[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const queryClient = useQueryClient();
  const sendMessage = useSendMobileAgentMessage();
  const messages = snapshot.inbox.filter((message) => filter === 'all' || message.unread);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId);
  const selectedThread = phone.threads[selectedAgentId] ?? snapshot.inbox
    .filter((message) => message.agentId === selectedAgentId)
    .slice()
    .reverse()
    .map((message) => ({ id: message.id, agentId: message.agentId, subject: message.subject, body: message.body, timestamp: message.timestamp, direction: message.kind === 'sent' ? 'human' : 'agent' as const }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAgentId || !subject.trim() || !body.trim()) return;
    sendMessage.mutate({ agentId: selectedAgentId, data: { subject: subject.trim(), body: body.trim() } }, {
      onSuccess: () => {
        setSubject('');
        setBody('');
        setShowComposer(false);
        queryClient.invalidateQueries({ queryKey: getGetMobileSnapshotQueryKey() });
      },
    });
  };
  return (
    <div className="content-wrap">
      <PageIntro eyebrow="INBOX / AGENT MESSAGES" title="Keep the loop tight." detail={`${snapshot.inbox.filter((message) => message.unread).length} unread messages from the floor.`} action={<button className="primary-button compose-button" onClick={() => setShowComposer((value) => !value)} data-testid="button-compose-message"><Send size={15} /> {showComposer ? 'Close composer' : 'Message an agent'}</button>} />
      {showComposer ? <form className="composer-card" onSubmit={submit} data-testid="form-send-message"><div className="composer-head"><div><p className="eyebrow">NEW NOTE TO THE FLOOR</p><h3>Send a message</h3></div><button type="button" className="icon-button" onClick={() => setShowComposer(false)} aria-label="Close message form" data-testid="button-close-composer"><X size={18} /></button></div><label className="field-label">Agent<select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} data-testid="select-message-agent"><option value="">Choose an agent</option>{snapshot.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} — {agent.role}</option>)}</select></label><label className="field-label">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A clear handoff" required data-testid="input-message-subject" /></label><label className="field-label">Message<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Give the desk enough context to act." rows={4} required data-testid="input-message-body" /></label><div className="composer-foot"><span>Sent directly to the selected desk.</span><button className="primary-button" type="submit" disabled={sendMessage.isPending || !selectedAgentId} data-testid="button-send-message">{sendMessage.isPending ? 'Sending…' : 'Send message'} <ArrowUpRight size={15} /></button></div></form> : null}
      <div className="inbox-toolbar"><div className="filter-scroll"><button className={`filter-chip ${filter === 'all' ? 'filter-chip-active' : ''}`} onClick={() => setFilter('all')} data-testid="button-filter-inbox-all">All messages</button><button className={`filter-chip ${filter === 'unread' ? 'filter-chip-active' : ''}`} onClick={() => setFilter('unread')} data-testid="button-filter-inbox-unread">Unread <span>{snapshot.inbox.filter((message) => message.unread).length}</span></button></div><span className="message-count">{messages.length} messages</span></div>
      <div className="thread-layout">
        <div className="thread-agent-strip">
          {snapshot.agents.map((agent) => <button className={`thread-agent ${agent.id === selectedAgentId ? 'thread-agent-active' : ''}`} onClick={() => setSelectedAgentId(agent.id)} key={agent.id}><AgentAvatar agent={agent} size="small" /><span>{agent.name}</span><small>{phone.sessions[agent.id]?.state ?? 'idle'}</small></button>)}
        </div>
        <section className="conversation-thread">
          <div className="conversation-head">
            <div>{selectedAgent ? <AgentAvatar agent={selectedAgent} size="small" /> : <MessageCircle size={18} />}<div><p className="eyebrow">ACTIVE SESSION</p><h3>{selectedAgent?.name ?? 'Choose an agent'}</h3></div></div>
            <span className={`session-state session-state-${phone.sessions[selectedAgentId]?.state ?? 'idle'}`}>{phone.sessions[selectedAgentId]?.state ?? 'idle'}</span>
          </div>
          {selectedThread.length ? <div className="thread-messages">{selectedThread.map((message) => <ThreadBubble message={message} key={message.id} />)}</div> : <div className="thread-empty"><MessageCircle size={18} /><span>This thread is empty. Start a handoff to this desk.</span></div>}
        </section>
      </div>
      {messages.length ? <div className="message-list">{messages.map((message) => <MessageCard message={message} agent={snapshot.agents.find((agent) => agent.id === message.agentId)} key={message.id} />)}</div> : <CompactEmpty title={filter === 'unread' ? 'You are all caught up' : 'No messages yet'} detail={filter === 'unread' ? 'The floor has no unread signal for you.' : 'When an agent writes, it will land here.'} />}
    </div>
  );
}

function MessageCard({ message, agent }: { message: InboxMessage; agent?: Agent }) {
  return (
    <article className={`message-card ${message.unread ? 'message-unread' : ''}`} data-testid={`card-message-${message.id}`}>
      <div className="message-avatar">{agent ? <AgentAvatar agent={agent} size="small" /> : initials(message.agentName)}</div>
      <div className="message-content"><div className="message-topline"><div><strong>{message.agentName}</strong><span className={`message-kind kind-${message.kind}`}>{message.kind}</span></div><time>{timeAgo(message.timestamp)} ago</time></div><h3>{message.subject}</h3><p>{message.body}</p></div>
      {message.unread ? <span className="unread-marker" aria-label="Unread message" data-testid={`status-unread-${message.id}`} /> : null}
    </article>
  );
}

function ThreadBubble({ message }: { message: PhoneThreadMessage }) {
  return (
    <div className={`thread-bubble thread-bubble-${message.direction}`}>
      <span className="thread-bubble-label">{message.direction === 'human' ? 'You' : message.direction === 'agent' ? 'Agent' : 'System'}</span>
      {message.subject ? <strong>{message.subject}</strong> : null}
      <p>{message.body}</p>
      <time>{timeAgo(message.timestamp)} ago</time>
    </div>
  );
}

function MemoryPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const tags = useMemo(() => Array.from(new Set(snapshot.memory.flatMap((entry) => entry.tags))), [snapshot.memory]);
  const entries = snapshot.memory.filter((entry) => {
    const haystack = `${entry.title} ${entry.excerpt} ${entry.agentName} ${entry.tags.join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (tag === 'all' || entry.tags.includes(tag));
  });
  return (
    <div className="content-wrap">
      <PageIntro eyebrow="SHARED MEMORY" title="What the office remembers." detail="Search the decisions, discoveries, and context your agents left behind." />
      <div className="memory-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory" aria-label="Search agent memory" data-testid="input-search-memory" />{query ? <button onClick={() => setQuery('')} aria-label="Clear memory search" data-testid="button-clear-memory-search"><X size={15} /></button> : null}</div>
      {tags.length ? <div className="tag-scroll" aria-label="Filter memory by tag">{['all', ...tags].map((memoryTag) => <button className={`tag-filter ${tag === memoryTag ? 'tag-filter-active' : ''}`} onClick={() => setTag(memoryTag)} key={memoryTag} data-testid={`button-memory-tag-${memoryTag}`}>{memoryTag === 'all' ? 'All memory' : `#${memoryTag}`}</button>)}</div> : null}
      {entries.length ? <div className="memory-list">{entries.map((entry) => <MemoryCard entry={entry} key={entry.id} />)}</div> : <CompactEmpty title="No memory found" detail={query ? 'Try a broader search or remove a tag filter.' : 'Shared knowledge will appear as the office works.'} />}
    </div>
  );
}

function MemoryCard({ entry }: { entry: MemoryEntry }) {
  return (
    <article className="memory-card" data-testid={`card-memory-${entry.id}`}><div className="memory-glyph"><BrainCircuit size={18} /></div><div className="memory-content"><div className="memory-meta"><span>{entry.agentName}</span><time>{timeAgo(entry.updatedAt)} ago</time></div><h3>{entry.title}</h3><p>{entry.excerpt}</p><div className="memory-tags">{entry.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></div><ArrowUpRight size={17} className="memory-arrow" /></article>
  );
}

function ActivityPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const [type, setType] = useState('all');
  const items = snapshot.activity.filter((item) => type === 'all' || item.type === type);
  return (
    <div className="content-wrap">
      <PageIntro eyebrow="THE PAPER TRAIL" title="Everything that moved." detail="A chronological signal from agents, tasks, messages, and the system." />
      <div className="activity-filters filter-scroll">{['all', 'agent', 'task', 'message', 'system'].map((item) => <button className={`filter-chip ${type === item ? 'filter-chip-active' : ''}`} onClick={() => setType(item)} key={item} data-testid={`button-filter-activity-${item}`}>{item === 'all' ? 'All activity' : item}</button>)}</div>
      {items.length ? <div className="timeline">{items.map((item) => <ActivityRow item={item} expanded key={item.id} />)}</div> : <CompactEmpty title="No activity in this view" detail="The paper trail is quiet for now." />}
    </div>
  );
}

function ActivityRow({ item, expanded = false }: { item: ActivityItem; expanded?: boolean }) {
  const Icon = activityIcons[item.type] ?? Command;
  return <div className={`activity-row ${expanded ? 'activity-row-expanded' : ''}`} data-testid={`row-activity-${item.id}`}><div className={`activity-icon activity-${item.type}`}><Icon size={15} /></div><div className="activity-copy"><strong>{item.label}</strong><span>{item.detail}</span></div><time>{timeAgo(item.timestamp)} ago</time></div>;
}

function SettingsPage({ snapshot }: { snapshot: MobileSnapshot }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [installMessage, setInstallMessage] = useState('');
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('munder-theme', next ? 'dark' : 'light');
  };
  const install = async () => {
    setInstallMessage('Use your browser menu to choose “Install app” or “Add to home screen”.');
  };
  return (
    <div className="content-wrap settings-wrap">
      <PageIntro eyebrow="CONTROL ROOM" title="A few things worth knowing." detail="Connection details and the best way to keep the office close on your phone." />
      <section className="settings-card connection-card"><div className="settings-icon settings-icon-teal">{snapshot.connected ? <Wifi size={20} /> : <WifiOff size={20} />}</div><div className="settings-copy"><p className="eyebrow">CONNECTION</p><h3>{snapshot.connected ? 'Office is connected' : 'Office is currently offline'}</h3><p>{snapshot.connected ? `Last floor sync was ${timeAgo(snapshot.updatedAt)} ago.` : 'The last snapshot is kept on screen while we wait for the line to come back.'}</p></div><span className={`connection-badge ${snapshot.connected ? 'connection-badge-live' : ''}`}><span />{snapshot.connected ? 'Live' : 'Paused'}</span></section>
      <section className="settings-card install-card"><div className="settings-icon settings-icon-amber"><ExternalLink size={20} /></div><div className="settings-copy"><p className="eyebrow">MOBILE WINDOW</p><h3>Keep Munder Difflin one tap away.</h3><p>Install this command center to your home screen for a focused, full-screen view of the floor.</p>{installMessage ? <p className="install-message">{installMessage}</p> : null}<button className="secondary-button" onClick={install} data-testid="button-install-guidance">Show install guidance <ArrowUpRight size={15} /></button></div></section>
      <section className="settings-card preference-card"><div className="settings-icon settings-icon-slate">{dark ? <Moon size={20} /> : <Sun size={20} />}</div><div className="settings-copy"><p className="eyebrow">APPEARANCE</p><h3>{dark ? 'Night shift' : 'Day shift'}</h3><p>Choose the room lighting that works best for your screen and surroundings.</p></div><button className={`theme-toggle ${dark ? 'theme-toggle-on' : ''}`} onClick={toggleTheme} aria-label="Toggle dark mode" data-testid="button-toggle-theme"><span>{dark ? <Moon size={14} /> : <Sun size={14} />}</span></button></section>
       <section className="settings-note"><Archive size={16} /><p>The desktop build uses Electron, native PTYs, local SQLite, filesystem and git access. Android browsers do not provide those OS features, so this mobile window keeps the office control surface while local terminals and files remain on the desktop app.</p></section>
    </div>
  );
}

function CompactEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="compact-empty" data-testid="state-empty"><div className="empty-icon"><Clock3 size={18} /></div><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

export default App;