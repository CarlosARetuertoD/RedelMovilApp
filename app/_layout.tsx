import { useEffect, useRef, useState } from 'react';
import { Stack, router, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, Animated, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScanBarcode, Database } from 'lucide-react-native';
import * as ExpoSplash from 'expo-splash-screen';
import useAuthStore from '../store/authStore';
import useSyncStore, { setSyncDoneCallback } from '../store/syncStore';
import useSettingsStore from '../store/settingsStore';
import { C } from '../lib/colors';

ExpoSplash.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutos

export default function RootLayout() {
  const { isAuthenticated, ready, init } = useAuthStore();
  const { syncing, firstSyncDone, progress, error, doSync, loadInfo } = useSyncStore();
  const segments = useSegments();
  const navState = useRootNavigationState();
  const fadeOut = useRef(new Animated.Value(1)).current;
  const [splashDone, setSplashDone] = useState(false);
  const didRedirect = useRef(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ExpoSplash.hideAsync().catch(() => {});
    init();
    useSettingsStore.getState().init();
    setSyncDoneCallback(() => queryClient.invalidateQueries());
  }, []);

  // Sync al autenticarse
  useEffect(() => {
    if (!isAuthenticated) {
      if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null; }
      return;
    }

    loadInfo().then(() => {
      const { firstSyncDone: done } = useSyncStore.getState();
      // Siempre sincronizar al entrar
      doSync();
    });

    // Sync periódico
    syncIntervalRef.current = setInterval(() => {
      const { syncing: s } = useSyncStore.getState();
      if (!s) doSync();
    }, SYNC_INTERVAL);

    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [isAuthenticated]);

  // Redirect
  useEffect(() => {
    if (!ready || !navState?.key || didRedirect.current) return;
    didRedirect.current = true;
    router.replace(isAuthenticated ? '/(tabs)' : '/login');
    setTimeout(() => {
      Animated.timing(fadeOut, { toValue: 0, duration: 300, useNativeDriver: true })
        .start(() => setSplashDone(true));
    }, 500);
  }, [ready, navState?.key]);

  useEffect(() => {
    if (!didRedirect.current || !navState?.key) return;
    const inLogin = segments[0] === 'login';
    if (isAuthenticated && inLogin) router.replace('/(tabs)');
    else if (!isAuthenticated && !inLogin) router.replace('/login');
  }, [isAuthenticated]);

  // Primera sync: bloquear la app
  const showSyncScreen = isAuthenticated && !firstSyncDone;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{
          headerStyle: { backgroundColor: C.surface },
          headerTintColor: C.white,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.bg },
          animation: 'fade',
        }}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="perfil" options={{ headerShown: false, presentation: 'modal' }} />
        </Stack>
      </QueryClientProvider>

      {/* Pantalla de primera sincronización — bloquea la app */}
      {showSyncScreen && splashDone && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 32, zIndex: 1000, elevation: 1000 }]}>
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: C.cyan + '20', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
            <Database size={32} color={C.cyan} />
          </View>

          <Text style={{ color: C.white, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
            Preparando base de datos
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 32 }}>
            Descargando datos para uso sin conexión.{'\n'}Solo se hace la primera vez.
          </Text>

          <View style={{ width: '100%', gap: 16 }}>
            {/* Descargando */}
            {syncing && progress && (
              <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator size="small" color={C.cyan} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>
                      {(progress as any).tableName || progress.message || 'Conectando...'}
                    </Text>
                    {(progress as any).rows != null && (progress as any).rows > 0 && (
                      <Text style={{ color: C.textMuted, fontSize: 11 }}>{(progress as any).rows.toLocaleString()} registros</Text>
                    )}
                  </View>
                </View>

                {progress.current != null && progress.total != null && (
                  <>
                    <View style={{ backgroundColor: C.bg, borderRadius: 8, height: 12, overflow: 'hidden' }}>
                      <View style={{
                        backgroundColor: C.cyan, height: 12, borderRadius: 8,
                        width: `${Math.min((progress.current / progress.total) * 100, 100)}%` as any,
                      }} />
                    </View>
                    <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center' }}>
                      Tabla {progress.current} de {progress.total}
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Iniciando */}
            {syncing && !progress && (
              <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color={C.cyan} />
                <Text style={{ color: C.textMuted, fontSize: 14 }}>Conectando con el servidor...</Text>
              </View>
            )}

            {/* Error con reintentar */}
            {error && !syncing && (
              <View style={{ gap: 12 }}>
                <View style={{ backgroundColor: C.redSurface, borderRadius: 14, padding: 16, gap: 8 }}>
                  <Text style={{ color: C.red, fontSize: 14, fontWeight: '700' }}>Error al sincronizar</Text>
                  <Text style={{ color: C.textMuted, fontSize: 12 }}>{error}</Text>
                </View>
                <Pressable onPress={() => doSync()}
                  style={{ backgroundColor: C.cyan, borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>Reintentar</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Splash de la app */}
      {!splashDone && (
        <Animated.View style={[StyleSheet.absoluteFill, {
          backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center',
          opacity: fadeOut, zIndex: 999, elevation: 999,
        }]}>
          <View style={{
            width: 80, height: 80, borderRadius: 22,
            backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center',
            elevation: 10,
          }}>
            <ScanBarcode size={40} color={C.white} />
          </View>
          <Text style={{ color: C.white, fontSize: 22, fontWeight: '800', marginTop: 20 }}>
            RedelMovilApp
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>
            Inventario y escaneo móvil
          </Text>
        </Animated.View>
      )}
    </View>
  );
}
