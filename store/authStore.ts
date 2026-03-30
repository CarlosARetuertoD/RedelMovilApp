import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { User } from '../lib/types';

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
}

const STORAGE_KEY = '@redelmovil_user';

const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  ready: false,

  init: async () => {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      if (json) {
        const user = JSON.parse(json);
        set({ isAuthenticated: true, user, ready: true });
        return;
      }
    } catch (e) {
      console.log('[AUTH] init error:', e);
    }
    set({ isAuthenticated: false, user: null, ready: true });
  },

  login: async (username, password) => {
    const uname = username.trim().toLowerCase();
    const pass = password.trim();
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, username, first_name, is_active')
      .eq('username', uname)
      .eq('is_active', true)
      .single();

    if (!usuario) throw new Error('Usuario no encontrado');

    const { data: perfil } = await supabase
      .from('perfiles_usuario')
      .select('rol, password_visible, activo')
      .eq('usuario_id', usuario.id)
      .eq('activo', true)
      .single();

    if (!perfil) throw new Error('Perfil no encontrado');
    if (perfil.password_visible !== pass) throw new Error('Contraseña incorrecta');
    if (!['admin', 'supervisor', 'almacenero'].includes(perfil.rol)) {
      throw new Error('Solo admin, supervisor y almacenero tienen acceso');
    }

    const user: User = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.first_name || usuario.username,
      rol: perfil.rol,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    set({ isAuthenticated: true, user });
  },

  logout: async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ isAuthenticated: false, user: null });
  },
}));

export default useAuthStore;
