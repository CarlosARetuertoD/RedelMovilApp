import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft, LogOut, RefreshCw, Database, User, Shield, Camera, ScanBarcode } from 'lucide-react-native';
import useAuthStore from '../store/authStore';
import useSyncStore from '../store/syncStore';
import useSettingsStore from '../store/settingsStore';
import { C } from '../lib/colors';

export default function PerfilScreen() {
  const { user, logout } = useAuthStore();
  const { syncing, progress, lastSync, variantesCount, stockCount, error, loadInfo, doSync, doReset } = useSyncStore();
  const { scannerMode, setScannerMode } = useSettingsStore();

  useEffect(() => { loadInfo(); }, []);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Nunca';
    const d = new Date(iso);
    const hoy = new Date();
    const diffMs = hoy.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH}h`;
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      {/* Header */}
      <Pressable onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
        <ChevronLeft size={20} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: 14 }}>Volver</Text>
      </Pressable>

      {/* User card */}
      <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <User size={24} color={C.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.white, fontSize: 20, fontWeight: '800' }}>{user?.nombre || 'Usuario'}</Text>
            <Text style={{ color: C.textMuted, fontSize: 13 }}>@{user?.username}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 8, padding: 10 }}>
          <Shield size={14} color={C.accent} />
          <Text style={{ color: C.textSecondary, fontSize: 12 }}>Rol: </Text>
          <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>{user?.rol}</Text>
        </View>
      </View>

      {/* Sync section */}
      <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Database size={18} color={C.cyan} />
          <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>Base de datos local</Text>
        </View>

        <View style={{ backgroundColor: C.bg, borderRadius: 10, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C.textMuted, fontSize: 12 }}>Última sincronización</Text>
            <Text style={{ color: C.textPrimary, fontSize: 12, fontWeight: '600' }}>{formatDate(lastSync)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C.textMuted, fontSize: 12 }}>Variantes locales</Text>
            <Text style={{ color: C.textPrimary, fontSize: 12, fontWeight: '600' }}>{variantesCount.toLocaleString()}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C.textMuted, fontSize: 12 }}>Registros de stock</Text>
            <Text style={{ color: C.textPrimary, fontSize: 12, fontWeight: '600' }}>{stockCount.toLocaleString()}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: C.textMuted, fontSize: 12 }}>Estado</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: variantesCount > 0 ? C.emerald : C.red }} />
              <Text style={{ color: variantesCount > 0 ? C.emerald : C.red, fontSize: 12, fontWeight: '600' }}>
                {variantesCount > 0 ? 'Sincronizado' : 'Sin datos'}
              </Text>
            </View>
          </View>
        </View>

        {/* Sync progress */}
        {syncing && progress && (
          <View style={{ backgroundColor: C.accentSurface, borderRadius: 8, padding: 12, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '600' }}>
                {progress.message || `Sincronizando ${progress.table || ''}...`}
              </Text>
            </View>
            {progress.current != null && progress.total != null && (
              <View style={{ backgroundColor: C.border, borderRadius: 4, height: 4, overflow: 'hidden' }}>
                <View style={{ backgroundColor: C.accent, height: 4, width: `${(progress.current / progress.total) * 100}%` as any }} />
              </View>
            )}
          </View>
        )}

        {error && (
          <View style={{ backgroundColor: C.redSurface, borderRadius: 8, padding: 10 }}>
            <Text style={{ color: C.red, fontSize: 12 }}>{error}</Text>
          </View>
        )}

        {/* Sync buttons */}
        <View style={{ gap: 8 }}>
          <Pressable onPress={doSync} disabled={syncing}
            style={{
              flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
              padding: 14, borderRadius: 10,
              backgroundColor: syncing ? C.border : C.cyan,
            }}>
            {syncing ? <ActivityIndicator size="small" color={C.white} /> : <RefreshCw size={18} color={C.white} />}
            <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>
              {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
            </Text>
          </Pressable>

          <Pressable onPress={doReset} disabled={syncing}
            style={{
              flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
              padding: 12, borderRadius: 10,
              backgroundColor: C.card, borderWidth: 1, borderColor: C.amber,
              opacity: syncing ? 0.4 : 1,
            }}>
            <Database size={16} color={C.amber} />
            <Text style={{ color: C.amber, fontSize: 13, fontWeight: '600' }}>Resetear y descargar todo</Text>
          </Pressable>
        </View>
      </View>

      {/* Scanner config */}
      <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ScanBarcode size={18} color={C.indigo} />
          <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>Escáner</Text>
        </View>

        <View style={{ gap: 8 }}>
          <Pressable onPress={() => setScannerMode('ambos')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
              backgroundColor: scannerMode === 'ambos' ? C.indigoSurface : C.bg,
              borderRadius: 10, borderWidth: 1, borderColor: scannerMode === 'ambos' ? C.indigo : C.border,
            }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Camera size={16} color={scannerMode === 'ambos' ? C.indigo : C.textMuted} />
              <ScanBarcode size={16} color={scannerMode === 'ambos' ? C.indigo : C.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: scannerMode === 'ambos' ? C.white : C.textPrimary, fontSize: 13, fontWeight: '700' }}>Cámara + Pistola láser</Text>
              <Text style={{ color: C.textMuted, fontSize: 11 }}>Buscar manual, cámara y pistola USB</Text>
            </View>
            {scannerMode === 'ambos' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.indigo }} />}
          </Pressable>

          <Pressable onPress={() => setScannerMode('solo_camara')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
              backgroundColor: scannerMode === 'solo_camara' ? C.indigoSurface : C.bg,
              borderRadius: 10, borderWidth: 1, borderColor: scannerMode === 'solo_camara' ? C.indigo : C.border,
            }}>
            <Camera size={16} color={scannerMode === 'solo_camara' ? C.indigo : C.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: scannerMode === 'solo_camara' ? C.white : C.textPrimary, fontSize: 13, fontWeight: '700' }}>Solo cámara</Text>
              <Text style={{ color: C.textMuted, fontSize: 11 }}>Sin buscador manual, solo cámara</Text>
            </View>
            {scannerMode === 'solo_camara' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.indigo }} />}
          </Pressable>
        </View>
      </View>

      {/* Logout */}
      <Pressable onPress={handleLogout}
        style={{
          flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
          padding: 14, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.red,
        }}>
        <LogOut size={18} color={C.red} />
        <Text style={{ color: C.red, fontSize: 14, fontWeight: '700' }}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}
