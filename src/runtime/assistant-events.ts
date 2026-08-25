export interface AssistantOpenDetail {
  activate?: boolean;
}

type OpenListener = (detail: AssistantOpenDetail) => void;
type ActiveListener = (active: boolean) => void;

const openListeners = new Set<OpenListener>();
const activeListeners = new Set<ActiveListener>();

export function publishAssistantOpen(detail: AssistantOpenDetail = {}): void {
  for (const listener of openListeners) listener(detail);
}

export function subscribeAssistantOpen(listener: OpenListener): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function publishAssistantActive(active: boolean): void {
  for (const listener of activeListeners) listener(active);
}

export function subscribeAssistantActive(listener: ActiveListener): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}
