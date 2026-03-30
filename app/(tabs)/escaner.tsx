import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Trash2, Camera, X } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { escanearProducto } from '../../lib/queries';
import { C } from '../../lib/colors';
import useSettingsStore from '../../store/settingsStore';
import type { ProductoEscaneado } from '../../lib/types';

export default function EscanerScreen() {
  const { scannerMode } = useSettingsStore();
  const soloCamara = scannerMode === 'solo_camara';
  const [producto, setProducto] = useState<ProductoEscaneado | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(soloCamara);
  const [scanned, setScanned] = useState(false);
  const [navegando, setNavegando] = useState<string | null>(null); // barcode de la hermana que se está cargando
  const [permission, requestPermission] = useCameraPermissions();

  const handleScan = useCallback(async (code: string) => {
    if (loading || !code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await escanearProducto(code.trim());
      if (result) {
        setProducto(result);
      } else {
        setProducto(null);
        setError(`No se encontró: ${code.trim().padStart(13, '0')}`);
      }
    } catch (e: any) {
      setProducto(null);
      setError(e.message || 'Error al buscar');
    } finally {
      setLoading(false);
      setNavegando(null);
      setInputCode('');
    }
  }, [loading]);

  // Solo cámara: pedir permiso al montar
  useEffect(() => {
    if (soloCamara && !permission?.granted) {
      requestPermission();
    }
  }, [soloCamara]);

  const toggleCamera = useCallback(async () => {
    if (!cameraOpen && !permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setCameraOpen(!cameraOpen);
    setScanned(false);
  }, [cameraOpen, permission, requestPermission]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setCameraOpen(false);
    handleScan(data);
    setTimeout(() => setScanned(false), 1500);
  }, [scanned, loading, handleScan]);

  // Navegar a hermana — feedback inmediato
  const navegarA = useCallback((barcode: string) => {
    if (!barcode || loading) return;
    setNavegando(barcode);
    handleScan(barcode);
  }, [handleScan, loading]);

  const p = producto;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {/* Input — solo si modo ambos */}
      {!soloCamara && (
        <View style={{ backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.accent, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.emerald }} />
          <TextInput value={inputCode} onChangeText={setInputCode} onSubmitEditing={() => handleScan(inputCode)}
            placeholder="Escanea o escribe código..." placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false} blurOnSubmit={false} returnKeyType="go"
            style={{ flex: 1, color: C.white, fontSize: 16, padding: 0 }} />
          <Pressable onPress={() => handleScan(inputCode)} style={{ backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>Buscar</Text>
          </Pressable>
        </View>
      )}

      {/* Cámara toggle */}
      <Pressable onPress={toggleCamera}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 12,
          backgroundColor: cameraOpen ? C.indigoSurface : C.card, borderRadius: 12, borderWidth: 1, borderColor: cameraOpen ? C.indigo : C.border }}>
        {cameraOpen ? <X size={18} color={C.indigo} /> : <Camera size={18} color={C.textMuted} />}
        <Text style={{ color: cameraOpen ? C.indigo : C.textMuted, fontSize: 13, fontWeight: '600' }}>
          {cameraOpen ? 'Cerrar cámara' : 'Escanear con cámara'}
        </Text>
      </Pressable>

      {/* Cámara */}
      {cameraOpen && (
        permission?.granted ? (
          <View style={{ height: 260, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.indigo }}>
            <CameraView style={{ flex: 1 }} facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr'] }}
              onBarcodeScanned={onBarcodeScanned} />
            <View style={{ position: 'absolute', top: '48%', left: 30, right: 30, height: 2, backgroundColor: C.accent, borderRadius: 1 }} />
            <View style={{ position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: 'white', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 }}>
                Apunta al código de barras
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ padding: 20, alignItems: 'center', backgroundColor: C.card, borderRadius: 12, gap: 8 }}>
            <Text style={{ color: C.textMuted, fontSize: 13 }}>Se necesita permiso de cámara</Text>
            <Pressable onPress={requestPermission} style={{ backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ color: C.white, fontSize: 13, fontWeight: '600' }}>Dar permiso</Text>
            </Pressable>
          </View>
        )
      )}

      {loading && <View style={{ padding: 12, alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>}
      {error ? <View style={{ backgroundColor: C.redSurface, borderRadius: 10, padding: 14 }}><Text style={{ color: C.red, fontSize: 13, textAlign: 'center' }}>{error}</Text></View> : null}

      {p && (
        <>
          {/* ═══ Producto ═══ */}
          <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 12 }}>
            {/* Tipo arriba */}
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>
              {p.categoria_nombre} · {p.subcategoria_nombre} · {p.genero_nombre}
            </Text>

            {/* Modelo + precio */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.white, fontSize: 22, fontWeight: '800' }}>{p.producto_modelo}</Text>
                <Text style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>{p.codigo_barras}</Text>
              </View>
              <Text style={{ color: C.emerald, fontSize: 22, fontWeight: '800' }}>S/ {p.precio}</Text>
            </View>

            {/* Detalle compacto en 2 columnas */}
            <View style={{ backgroundColor: C.bg, borderRadius: 10, padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <InfoCell label="Marca" value={p.marca_nombre} />
                <InfoCell label="Fit" value={p.fit_nombre} />
              </View>
              <View style={{ flexDirection: 'row' }}>
                <InfoCell label="Color" value={p.color_nombre} />
                <InfoCell label="Talla" value={p.talla_valor} />
              </View>
            </View>

            {/* Stock total */}
            <View style={{ backgroundColor: C.bg, borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: C.textSecondary, fontSize: 14, fontWeight: '600' }}>Stock total</Text>
              <Text style={{ color: p.stockTotal > 0 ? C.cyan : C.red, fontSize: 28, fontWeight: '800' }}>{p.stockTotal}</Text>
            </View>
          </View>

          {/* ═══ Ubicación ═══ */}
          {p.stockPorAlmacen.length > 0 && (
            <View style={{ backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>UBICACIÓN</Text>
              </View>
              {p.stockPorAlmacen.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: i < p.stockPorAlmacen.length - 1 ? 1 : 0, borderBottomColor: C.border }}>
                  <Text style={{ flex: 1, color: C.textPrimary, fontSize: 14, fontWeight: '600' }}>{s.almacen_nombre}</Text>
                  <Text style={{ color: s.cantidad > 0 ? C.cyan : C.red, fontSize: 20, fontWeight: '800' }}>{s.cantidad}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ═══ Tallas hermanas — tocables ═══ */}
          {p.tallasMismoColor.length > 1 && (
            <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 10 }}>
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>TALLAS EN {p.color_nombre.toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {p.tallasMismoColor.map((t, i) => {
                  const cargando = navegando === t.codigo_barras;
                  return (
                    <Pressable key={i}
                      onPress={() => !t.es_actual && !loading && navegarA(t.codigo_barras)}
                      style={{
                        backgroundColor: t.es_actual ? C.accent : cargando ? C.accentSurface : C.bg, borderRadius: 10,
                        paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 52,
                        borderWidth: t.es_actual ? 0 : 1, borderColor: cargando ? C.accent : C.border,
                        opacity: loading && !cargando && !t.es_actual ? 0.4 : 1,
                      }}>
                      {cargando ? (
                        <ActivityIndicator size="small" color={C.accent} style={{ marginVertical: 4 }} />
                      ) : (
                        <>
                          <Text style={{ color: t.es_actual ? C.white : C.textPrimary, fontSize: 15, fontWeight: '800' }}>{t.talla}</Text>
                          <Text style={{ color: t.es_actual ? C.white : (t.stock_total > 0 ? C.cyan : C.red), fontSize: 12, fontWeight: '700', marginTop: 2 }}>{t.stock_total}</Text>
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: C.textMuted, fontSize: 10, fontStyle: 'italic' }}>Toca una talla para ver su detalle</Text>
            </View>
          )}

          {/* ═══ Colores — tocables ═══ */}
          {p.coloresDisponibles.length > 1 && (
            <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 10 }}>
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>COLORES DISPONIBLES</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {p.coloresDisponibles.map((c, i) => {
                  const esActual = c.color_nombre === p.color_nombre;
                  const cargando = navegando === c.codigo_barras;
                  return (
                    <Pressable key={i}
                      onPress={() => !esActual && !loading && navegarA(c.codigo_barras)}
                      style={{
                        backgroundColor: esActual ? C.indigo : cargando ? C.indigoSurface : C.bg, borderRadius: 10,
                        paddingHorizontal: 12, paddingVertical: 8, borderWidth: esActual ? 0 : 1,
                        borderColor: cargando ? C.indigo : C.border,
                        opacity: loading && !cargando && !esActual ? 0.4 : 1,
                      }}>
                      {cargando ? (
                        <ActivityIndicator size="small" color={C.indigo} style={{ marginVertical: 2 }} />
                      ) : (
                        <>
                          <Text style={{ color: esActual ? C.white : C.textPrimary, fontSize: 13, fontWeight: '600' }}>{c.color_nombre}</Text>
                          <Text style={{ color: esActual ? C.white : (c.stock_total > 0 ? C.cyan : C.red), fontSize: 12, fontWeight: '700', marginTop: 1 }}>{c.stock_total}</Text>
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: C.textMuted, fontSize: 10, fontStyle: 'italic' }}>Toca un color para ver su detalle</Text>
            </View>
          )}

          <Pressable onPress={() => { setProducto(null); setError(''); }}
            style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 14, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
            <Trash2 size={16} color={C.textMuted} />
            <Text style={{ color: C.textMuted, fontSize: 13, fontWeight: '600' }}>Limpiar</Text>
          </Pressable>
        </>
      )}

      {!producto && !loading && !error && !cameraOpen && (
        <View style={{ alignItems: 'center', paddingTop: 40 }}>
          <Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center' }}>
            {soloCamara ? 'Abre la cámara para escanear un código de barras' : 'Escanea con la pistola, cámara, o escribe el código'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: C.textMuted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}
