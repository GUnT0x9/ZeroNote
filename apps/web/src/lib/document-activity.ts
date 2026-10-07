let revision = 0;
const listeners = new Set<() => void>();
export function notifyDocumentActivity(): void {
  revision++;
  for (const listener of [...listeners]) listener();
}
export function getDocumentActivityRevision(): number {
  return revision;
}
export function subscribeDocumentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
