import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginRailway, saveTokens, clearTokens } from '../lib/railway';
import type { User } from '../lib/types';

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
}

const USER_KEY = '@redelmovil_user';

const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  ready: false,

  init: async () => {
    try {
      const json = await AsyncStorage.getItem(USER_KEY);
      if (json) {
        const { getTokens } = await import('../lib/railway');
        const tokens = await getTokens();
        if (tokens) {
          set({ isAuthenticated: true, user: JSON.parse(json), ready: true });
          return;
        }
        // Usuario guardado pero sin tokens Railway → limpiar y forzar re-login
        await AsyncStorage.removeItem(USER_KEY);
      }
    } catch {}
    set({ isAuthenticated: false, user: null, ready: true });
  },

  login: async (username, password) => {
    const uname = username.trim().toLowerCase();
    const data = await loginRailway(uname, password.trim());

    await saveTokens({ access: data.access, refresh: data.refresh });

    const user: User = {
      id: data.user.id,
      username: data.user.username,
      nombre: data.user.nombre,
      rol: data.user.rol,
    };
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ isAuthenticated: true, user });
  },

  logout: async () => {
    await clearTokens();
    await AsyncStorage.removeItem(USER_KEY);
    set({ isAuthenticated: false, user: null });
  },
}));

export default useAuthStore;
