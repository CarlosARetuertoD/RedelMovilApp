import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ScannerMode = 'solo_camara';

type SettingsState = {
  scannerMode: ScannerMode;
  ready: boolean;
  init: () => Promise<void>;
  setScannerMode: (mode: ScannerMode) => Promise<void>;
};

const STORAGE_KEY = '@karolayjeansmovil_settings';

const useSettingsStore = create<SettingsState>((set) => ({
  scannerMode: 'solo_camara',
  ready: false,

  init: async () => {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      if (json) {
        const data = JSON.parse(json);
        // Si hay un valor guardado explícitamente, úsalo; si no, default ambos
        set({ scannerMode: data.scannerMode ?? 'solo_camara', ready: true });
        return;
      }
    } catch {}
    set({ ready: true });
  },

  setScannerMode: async (mode) => {
    set({ scannerMode: mode });
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      const data = json ? JSON.parse(json) : {};
      data.scannerMode = mode;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  },
}));

export default useSettingsStore;
