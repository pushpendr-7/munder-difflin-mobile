import { Capacitor, registerPlugin } from '@capacitor/core';

export type WorkspaceEntry = {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modifiedAt: number;
};

export type WorkspaceInfo = {
  root: string;
};

export type RuntimeOutputEvent = {
  sessionId: string;
  stream: 'stdout' | 'stderr';
  text: string;
};

export type RuntimeExitEvent = {
  sessionId: string;
  exitCode: number;
  timedOut: boolean;
};

export type RuntimePlugin = {
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
  listFiles(options?: { path?: string }): Promise<{ path: string; entries: WorkspaceEntry[] }>;
  readFile(options: { path: string }): Promise<{ path: string; content: string; size: number }>;
  writeFile(options: { path: string; content: string }): Promise<{ path: string; size: number }>;
  createDirectory(options: { path: string }): Promise<{ path: string }>;
  deletePath(options: { path: string }): Promise<{ path: string }>;
  startCommand(options: { command: string; cwd?: string; timeoutMs?: number }): Promise<{ sessionId: string }>;
  sendInput(options: { sessionId: string; text: string }): Promise<void>;
  closeInput(options: { sessionId: string }): Promise<void>;
  stopCommand(options: { sessionId: string }): Promise<void>;
  addListener(eventName: 'runtimeOutput', listener: (event: RuntimeOutputEvent) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: 'runtimeExit', listener: (event: RuntimeExitEvent) => void): Promise<{ remove: () => Promise<void> }>;
};

export const AndroidRuntime = registerPlugin<RuntimePlugin>('AndroidRuntime');

export function isAndroidRuntimeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

