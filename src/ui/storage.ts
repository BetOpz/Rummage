/** Save/load helpers for the browser (localStorage + file export/import). */
import { type Session, deserializeSession, serializeSession } from '../engine';

const KEY = 'rummage.save.v1';

export function saveToLocal(session: Session): void {
  try {
    localStorage.setItem(KEY, serializeSession(session));
  } catch {
    // Storage may be unavailable (private mode); saving is best-effort.
  }
}

/** True if a saved run was found but had to be discarded (e.g. from an older version). */
export let discardedOldSave = false;

export function loadFromLocal(): Session | null {
  let json: string | null = null;
  try {
    json = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!json) return null;
  try {
    return deserializeSession(json);
  } catch {
    discardedOldSave = true;
    clearLocal();
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function downloadSave(session: Session): void {
  const blob = new Blob([serializeSession(session)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rummage-${session.state.seed}-t${session.state.tier + 1}r${session.state.round + 1}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readSaveFile(file: File): Promise<Session> {
  return deserializeSession(await file.text());
}
