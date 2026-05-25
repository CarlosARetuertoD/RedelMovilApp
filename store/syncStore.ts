import { create } from 'zustand';
import { syncDatabase, getSyncInfo, type SyncProgress } from '../lib/sync';
import { clearCache } from '../lib/queries';
import { resetDatabase } from '../lib/localDB';

// Se setea desde _layout.tsx para invalidar React Query después de sync
let _onSyncDone: (() => void) | null = null;
export function setSyncDoneCallback(cb: () => void) { _onSyncDone = cb; }

// Se setea desde _layout.tsx para hacer logout automático en error de sesión
let _onAuthError: (() => Promise<void>) | null = null;
export function setAuthErrorCallback(cb: () => Promise<void>) { _onAuthError = cb; }

function isAuthError(msg: string) {
  return msg === 'Sesión expirada' || msg === 'Sin sesión';
}

type SyncState = {
  syncing: boolean;
  firstSyncDone: boolean;
  progress: SyncProgress | null;
  lastSync: string | null;
  variantesCount: number;
  stockCount: number;
  error: string | null;
  loadInfo: () => Promise<void>;
  doSync: () => Promise<void>;
  doReset: () => Promise<void>;
};

const useSyncStore = create<SyncState>((set, get) => ({
  syncing: false,
  firstSyncDone: false,
  progress: null,
  lastSync: null,
  variantesCount: 0,
  stockCount: 0,
  error: null,

  loadInfo: async () => {
    try {
      const info = await getSyncInfo();
      set({
        lastSync: info.lastSync,
        variantesCount: info.variantesCount,
        stockCount: info.stockCount,
        firstSyncDone: info.variantesCount > 0,
      });
    } catch {}
  },

  doSync: async () => {
    if (get().syncing) return;
    set({ syncing: true, error: null });
    try {
      const result = await syncDatabase((p) => set({ progress: p }));
      clearCache();
      const info = await getSyncInfo();
      set({
        lastSync: info.lastSync,
        variantesCount: info.variantesCount,
        stockCount: info.stockCount,
        firstSyncDone: info.variantesCount > 0,
        progress: null,
      });
      if (result.updated > 0) _onSyncDone?.();
    } catch (e: any) {
      const msg = e.message || 'Error de sincronización';
      set({ error: msg, progress: null });
      if (isAuthError(msg)) await _onAuthError?.();
    } finally {
      set({ syncing: false });
    }
  },

  doReset: async () => {
    set({ syncing: true, error: null, firstSyncDone: false });
    try {
      await resetDatabase();
      clearCache();
      set({ lastSync: null, variantesCount: 0, stockCount: 0 });
      await syncDatabase((p) => set({ progress: p }));
      clearCache();
      const info = await getSyncInfo();
      set({
        lastSync: info.lastSync,
        variantesCount: info.variantesCount,
        stockCount: info.stockCount,
        firstSyncDone: info.variantesCount > 0,
        progress: null,
      });
      _onSyncDone?.();
    } catch (e: any) {
      const msg = e.message || 'Error';
      set({ error: msg, progress: null });
      if (isAuthError(msg)) await _onAuthError?.();
    } finally {
      set({ syncing: false });
    }
  },
}));

export default useSyncStore;
