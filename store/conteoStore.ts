import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ConteoFila {
  variante_id: string;
  sku_variant: string;
  codigo_barras: string;
  descripcion: string;
  color: string;
  talla: string;
  stockSistema: number;
  esperado: number;
  contado: number;
}

export interface ScanRecord {
  timestamp: string;
  codigo_barras: string;
  descripcion: string;
  resultado: 'ok' | 'completo' | 'excede' | 'sobrante';
  contado: number;
  esperado: number;
}

type Fase = 'preparacion' | 'conteo' | 'resultado';

interface ConteoState {
  fase: Fase;
  almacenId: string;
  almacenNombre: string;
  filtrosGrupo: { fits: string[]; marcas: string[]; tallas: string[] };
  matriz: ConteoFila[];
  sobrantes: ConteoFila[];
  historial: ScanRecord[];
  scanCount: number;
  setFase: (f: Fase) => void;
  setAlmacen: (id: string, nombre: string) => void;
  setFiltrosGrupo: (f: { fits: string[]; marcas: string[]; tallas: string[] }) => void;
  cargarMatriz: (filas: ConteoFila[]) => void;
  actualizarEsperado: (vid: string, n: number) => void;
  quitarDeMatriz: (vid: string) => void;
  escanear: (cb: string, info?: { variante_id: string; sku_variant: string; descripcion: string; color: string; talla: string }) => 'ok' | 'completo' | 'excede' | 'sobrante' | 'sobrante_repeat';
  deshacerUltimo: () => void;
  resetContado: () => void;
  nuevoConteo: () => void;
  guardarBorrador: () => Promise<void>;
  restaurarBorrador: () => Promise<boolean>;
}

const KEY = '@redelmovil_conteo';

const useConteoStore = create<ConteoState>((set, get) => ({
  fase: 'preparacion', almacenId: '', almacenNombre: '',
  filtrosGrupo: { fits: [], marcas: [], tallas: [] },
  matriz: [], sobrantes: [], historial: [], scanCount: 0,

  setFase: (fase) => set({ fase }),
  setAlmacen: (id, nombre) => set({ almacenId: id, almacenNombre: nombre }),
  setFiltrosGrupo: (f) => set({ filtrosGrupo: f }),

  cargarMatriz: (filas) => {
    set({ matriz: filas, sobrantes: [], historial: [], scanCount: 0 });
    get().guardarBorrador();
  },

  actualizarEsperado: (vid, n) => {
    set(s => ({ matriz: s.matriz.map(f => f.variante_id === vid ? { ...f, esperado: Math.max(0, n) } : f) }));
    get().guardarBorrador();
  },

  quitarDeMatriz: (vid) => {
    set(s => ({ matriz: s.matriz.filter(f => f.variante_id !== vid) }));
    get().guardarBorrador();
  },

  escanear: (cb, info) => {
    const s = get();
    const now = new Date().toLocaleTimeString('es-PE', { hour12: false });
    const enMatriz = s.matriz.find(f => f.codigo_barras === cb);

    if (enMatriz) {
      const nc = enMatriz.contado + 1;
      const res: 'ok' | 'completo' | 'excede' = nc === enMatriz.esperado ? 'completo' : nc > enMatriz.esperado ? 'excede' : 'ok';
      set(st => ({
        matriz: st.matriz.map(f => f.variante_id === enMatriz.variante_id ? { ...f, contado: nc } : f),
        historial: [{ timestamp: now, codigo_barras: cb, descripcion: enMatriz.descripcion, resultado: res, contado: nc, esperado: enMatriz.esperado }, ...st.historial].slice(0, 100),
        scanCount: st.scanCount + 1,
      }));
      if ((s.scanCount + 1) % 5 === 0) get().guardarBorrador();
      return res;
    }

    const enSob = s.sobrantes.find(f => f.codigo_barras === cb);
    if (enSob) {
      set(st => ({
        sobrantes: st.sobrantes.map(f => f.codigo_barras === cb ? { ...f, contado: f.contado + 1 } : f),
        historial: [{ timestamp: now, codigo_barras: cb, descripcion: enSob.descripcion, resultado: 'sobrante' as const, contado: enSob.contado + 1, esperado: 0 }, ...st.historial].slice(0, 100),
        scanCount: st.scanCount + 1,
      }));
      return 'sobrante_repeat';
    }

    if (info) {
      set(st => ({
        sobrantes: [...st.sobrantes, { ...info, codigo_barras: cb, stockSistema: 0, esperado: 0, contado: 1 }],
        historial: [{ timestamp: now, codigo_barras: cb, descripcion: info.descripcion, resultado: 'sobrante' as const, contado: 1, esperado: 0 }, ...st.historial].slice(0, 100),
        scanCount: st.scanCount + 1,
      }));
    }
    return 'sobrante';
  },

  deshacerUltimo: () => {
    const s = get();
    if (!s.historial.length) return;
    const u = s.historial[0];
    const em = s.matriz.find(f => f.codigo_barras === u.codigo_barras);
    if (em) {
      set(st => ({ matriz: st.matriz.map(f => f.variante_id === em.variante_id ? { ...f, contado: Math.max(0, f.contado - 1) } : f), historial: st.historial.slice(1) }));
    } else {
      const es = s.sobrantes.find(f => f.codigo_barras === u.codigo_barras);
      if (es) {
        if (es.contado <= 1) set(st => ({ sobrantes: st.sobrantes.filter(f => f.codigo_barras !== u.codigo_barras), historial: st.historial.slice(1) }));
        else set(st => ({ sobrantes: st.sobrantes.map(f => f.codigo_barras === u.codigo_barras ? { ...f, contado: f.contado - 1 } : f), historial: st.historial.slice(1) }));
      }
    }
  },

  resetContado: () => {
    set(s => ({ matriz: s.matriz.map(f => ({ ...f, contado: 0 })), sobrantes: [], historial: [], scanCount: 0, fase: 'conteo' as Fase }));
    get().guardarBorrador();
  },

  nuevoConteo: () => {
    set({ fase: 'preparacion', almacenId: '', almacenNombre: '', filtrosGrupo: { fits: [], marcas: [], tallas: [] }, matriz: [], sobrantes: [], historial: [], scanCount: 0 });
    AsyncStorage.removeItem(KEY).catch(() => {});
  },

  guardarBorrador: async () => {
    try {
      const s = get();
      await AsyncStorage.setItem(KEY, JSON.stringify({
        fase: s.fase, almacenId: s.almacenId, almacenNombre: s.almacenNombre,
        filtrosGrupo: s.filtrosGrupo, matriz: s.matriz, sobrantes: s.sobrantes,
        historial: s.historial.slice(0, 50), scanCount: s.scanCount,
      }));
    } catch (e) { console.log('[CONTEO] save error:', e); }
  },

  restaurarBorrador: async () => {
    try {
      const json = await AsyncStorage.getItem(KEY);
      if (!json) return false;
      const b = JSON.parse(json);
      if (!b.matriz?.length) return false;
      set({ fase: b.fase || 'conteo', almacenId: b.almacenId, almacenNombre: b.almacenNombre, filtrosGrupo: b.filtrosGrupo, matriz: b.matriz, sobrantes: b.sobrantes || [], historial: b.historial || [], scanCount: b.scanCount || 0 });
      return true;
    } catch (e) { return false; }
  },
}));

export default useConteoStore;
