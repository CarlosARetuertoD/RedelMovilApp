"use client";
import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Dimensions } from 'react-native';
import { Trash2, Camera, X } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { escanearProducto } from '../../lib/queries';
import { C } from '../../lib/colors';
import useSettingsStore from '../../store/settingsStore';
import type { ProductoEscaneado } from '../../lib/types';

const { width: SCREEN_W } = Dimensions.get('window');
const isTablet = SCREEN_W >= 768;

// ─── Color helpers ────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex?.replace('#', '');
  if (!clean || clean.length < 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function textForBg(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
}

function stripeBg(hex: string): string {
  // Slightly lighter version for stripe effect
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1.15;
  const r = Math.min(255, Math.round(rgb.r * factor));
  const g = Math.min(255, Math.round(rgb.g * factor));
  const b = Math.min(255, Math.round(rgb.b * factor));
  return `rgb(${r},${g},${b})`;
}

// ─── Almacen card con color de BD ────────────────────
function AlmacenCard({ nombre, cantidad, colorHex }: { nombre: string; cantidad: number; colorHex?: string }) {
  const bg = colorHex || C.card;
  const textColor = colorHex ? textForBg(colorHex) : C.textPrimary;
  const textMuted = colorHex ? textColor + 'bb' : C.textMuted;
  const hasColor = !!colorHex;
  const numColor = hasColor ? textColor : (cantidad > 0 ? C.cyan : C.red);

  return (
    <View style={{
      flex: 1, minWidth: isTablet ? 170 : 130, borderRadius: 14, overflow: 'hidden',
      backgroundColor: bg,
      borderWidth: hasColor ? 0 : 1, borderColor: C.border,
    }}>
      {hasColor && (
        <View style={{ height: 5, backgroundColor: stripeBg(bg) + '90' }} />
      )}
      <View style={{ padding: isTablet ? 16 : 13, gap: 2 }}>
        <Text style={{ color: textColor, fontSize: isTablet ? 18 : 16, fontWeight: '800', lineHeight: isTablet ? 22 : 20 }} numberOfLines={2}>
          {nombre}
        </Text>
        <Text style={{ color: numColor, fontSize: isTablet ? 44 : 36, fontWeight: '900', lineHeight: isTablet ? 50 : 42, marginTop: 4 }}>
          {cantidad}
        </Text>
        <Text style={{ color: textMuted, fontSize: isTablet ? 12 : 10, fontWeight: '600' }}>unidades</Text>
      </View>
    </View>
  );
}

// ─── Talla pill ───────────────────────────────────────
function TallaPill({ talla, stockTotal, esActual, cargando, onPress }: {
  talla: string; stockTotal: number; esActual: boolean; cargando: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={esActual}
      style={{
        backgroundColor: esActual ? C.accent : cargando ? C.accentSurface : C.card,
        borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: isTablet ? 16 : 12, paddingVertical: isTablet ? 12 : 8,
        minWidth: isTablet ? 64 : 52,
        borderWidth: esActual ? 0 : 1.5,
        borderColor: cargando ? C.accent : stockTotal > 0 ? C.border : C.red + '60',
        opacity: !esActual && !cargando && stockTotal === 0 ? 0.5 : 1,
      }}>
      {cargando ? (
        <ActivityIndicator size="small" color={C.accent} />
      ) : (
        <>
          <Text style={{ color: esActual ? C.white : C.textPrimary, fontSize: isTablet ? 17 : 14, fontWeight: '800' }}>{talla}</Text>
          <Text style={{ color: esActual ? C.white : (stockTotal > 0 ? C.cyan : C.red), fontSize: isTablet ? 12 : 10, fontWeight: '700', marginTop: 2 }}>{stockTotal}</Text>
        </>
      )}
    </Pressable>
  );
}

// ─── Color pill ───────────────────────────────────────
function ColorPill({ colorNombre, stockTotal, esActual, cargando, onPress }: {
  colorNombre: string; stockTotal: number; esActual: boolean; cargando: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={esActual}
      style={{
        backgroundColor: esActual ? C.indigo : cargando ? C.indigoSurface : C.card,
        borderRadius: 10, paddingHorizontal: isTablet ? 14 : 10, paddingVertical: isTablet ? 10 : 7,
        borderWidth: esActual ? 0 : 1, borderColor: cargando ? C.indigo : C.border,
        opacity: !esActual && !cargando && stockTotal === 0 ? 0.5 : 1,
        alignItems: 'center',
      }}>
      {cargando ? (
        <ActivityIndicator size="small" color={C.indigo} />
      ) : (
        <>
          <Text style={{ color: esActual ? C.white : C.textPrimary, fontSize: isTablet ? 14 : 12, fontWeight: '700' }}>{colorNombre}</Text>
          <Text style={{ color: esActual ? C.white : (stockTotal > 0 ? C.cyan : C.red), fontSize: isTablet ? 12 : 10, fontWeight: '700', marginTop: 1 }}>{stockTotal}</Text>
        </>
      )}
    </Pressable>
  );
}

// ─── Resultado del escáner ────────────────────────────
function ResultadoEscaner({ producto, navegando, loading, onLimpiar, onNavegarA }: {
  producto: ProductoEscaneado;
  navegando: string | null;
  loading: boolean;
  onLimpiar: () => void;
  onNavegarA: (barcode: string) => void;
}) {
  const p = producto;
  const stockTotal = p.stockTotal;

  return (
    <>
      {/* ═══ HEADER con color verde (como RedelApp) ═══ */}
      <View style={{ backgroundColor: '#1a3a2a', borderRadius: 16, overflow: 'hidden', marginBottom: 2 }}>
        {/* Banda de color superior */}
        <View style={{ height: 4, backgroundColor: C.emerald }} />
        <View style={{ padding: isTablet ? 20 : 14, gap: isTablet ? 10 : 6 }}>
          {/* Categoría · Subcategoría · Género */}
          <Text style={{ color: C.emerald + 'aa', fontSize: isTablet ? 12 : 10, fontWeight: '700', letterSpacing: 0.8 }}>
            {[p.categoria_nombre, p.subcategoria_nombre, p.genero_nombre].filter(Boolean).join('  ·  ')}
          </Text>

          {/* Marca + Modelo */}
          <View>
            <Text style={{ color: C.textMuted, fontSize: isTablet ? 14 : 11, fontWeight: '600' }}>{p.marca_nombre}</Text>
            <Text style={{ color: C.white, fontSize: isTablet ? 28 : 22, fontWeight: '900', lineHeight: isTablet ? 34 : 28 }}>{p.producto_modelo}</Text>
          </View>

          {/* Fit · Color · Talla + Precio */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {p.fit_nombre ? (
                  <View style={{ backgroundColor: C.emerald + '25', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: C.emerald, fontSize: isTablet ? 12 : 10, fontWeight: '700' }}>{p.fit_nombre}</Text>
                  </View>
                ) : null}
                <View style={{ backgroundColor: C.white + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: C.white, fontSize: isTablet ? 12 : 10, fontWeight: '600' }}>{p.color_nombre}</Text>
                </View>
                <View style={{ backgroundColor: C.white + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: C.white, fontSize: isTablet ? 12 : 10, fontWeight: '600' }}>T{p.talla_valor}</Text>
                </View>
              </View>
              <Text style={{ color: C.textMuted, fontSize: isTablet ? 11 : 9 }}>{p.codigo_barras}</Text>
            </View>

            {/* Precio grande */}
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: C.textMuted, fontSize: isTablet ? 11 : 9 }}>Precio venta</Text>
              <Text style={{ color: C.emerald, fontSize: isTablet ? 28 : 22, fontWeight: '900' }}>S/ {p.precio}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ═══ STOCK TOTAL ═══ */}
      <View style={{
        backgroundColor: stockTotal > 0 ? C.cyanSurface : C.redSurface,
        borderRadius: 14, padding: isTablet ? 16 : 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderWidth: 1, borderColor: stockTotal > 0 ? C.cyan + '40' : C.red + '40',
      }}>
        <View>
          <Text style={{ color: stockTotal > 0 ? C.cyan : C.red, fontSize: isTablet ? 13 : 11, fontWeight: '700' }}>STOCK TOTAL</Text>
          <Text style={{ color: C.textMuted, fontSize: isTablet ? 11 : 9 }}>todas las ubicaciones</Text>
        </View>
        <Text style={{ color: stockTotal > 0 ? C.cyan : C.red, fontSize: isTablet ? 48 : 38, fontWeight: '900' }}>{stockTotal}</Text>
      </View>

      {/* ═══ UBICACIÓN — cards con colores de BD ═══ */}
      {p.stockPorAlmacen.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={{ color: C.textMuted, fontSize: isTablet ? 12 : 10, fontWeight: '700', letterSpacing: 0.8 }}>UBICACIÓN</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.stockPorAlmacen.map((s, i) => (
              <AlmacenCard
                key={i}
                nombre={s.almacen_nombre}
                cantidad={s.cantidad}
                colorHex={(s as any).color_hex}
              />
            ))}
          </View>
        </View>
      )}

      {/* ═══ TALLAS MISMO COLOR ═══ */}
      {p.tallasMismoColor.length > 1 && (
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: isTablet ? 16 : 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: C.accent }} />
            <Text style={{ color: C.textMuted, fontSize: isTablet ? 12 : 10, fontWeight: '700', letterSpacing: 0.5 }}>
              TALLAS EN {p.color_nombre.toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.tallasMismoColor.map((t, i) => (
              <TallaPill key={i}
                talla={t.talla}
                stockTotal={t.stock_total}
                esActual={t.es_actual}
                cargando={navegando === t.codigo_barras}
                onPress={() => !t.es_actual && !loading && onNavegarA(t.codigo_barras)}
              />
            ))}
          </View>
        </View>
      )}

      {/* ═══ COLORES DISPONIBLES ═══ */}
      {p.coloresDisponibles.length > 1 && (
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: isTablet ? 16 : 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: C.indigo }} />
            <Text style={{ color: C.textMuted, fontSize: isTablet ? 12 : 10, fontWeight: '700', letterSpacing: 0.5 }}>
              COLORES DISPONIBLES
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.coloresDisponibles.map((c, i) => (
              <ColorPill key={i}
                colorNombre={c.color_nombre}
                stockTotal={c.stock_total}
                esActual={c.color_nombre === p.color_nombre}
                cargando={navegando === c.codigo_barras}
                onPress={() => c.color_nombre !== p.color_nombre && !loading && onNavegarA(c.codigo_barras)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Limpiar */}
      <Pressable onPress={onLimpiar}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: isTablet ? 16 : 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
        <Trash2 size={16} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: isTablet ? 14 : 13, fontWeight: '600' }}>Limpiar resultado</Text>
      </Pressable>
    </>
  );
}

// ─── Screen principal ─────────────────────────────────
export default function EscanerScreen() {
  const { scannerMode } = useSettingsStore();
  const soloCamara = scannerMode === 'solo_camara';
  const [producto, setProducto] = useState<ProductoEscaneado | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(true);
  const [scanned, setScanned] = useState(false);
  const [navegando, setNavegando] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

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
        setError(`No encontrado: ${code.trim().padStart(13, '0')}`);
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

  const navegarA = useCallback((barcode: string) => {
    if (!barcode || loading) return;
    setNavegando(barcode);
    handleScan(barcode);
  }, [handleScan, loading]);

  const limpiar = useCallback(() => { setProducto(null); setError(''); }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: isTablet ? 20 : 12, gap: 10, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Input pistola */}
      {!soloCamara && (
        <View style={{ backgroundColor: C.card, borderRadius: 12, borderWidth: 1.5, borderColor: producto ? C.border : C.accent, padding: isTablet ? 14 : 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.emerald }} />
          <TextInput
            value={inputCode}
            onChangeText={setInputCode}
            onSubmitEditing={() => handleScan(inputCode)}
            placeholder="Escanea o escribe código..."
            placeholderTextColor={C.textMuted}
            autoCapitalize="none" autoCorrect={false} blurOnSubmit={false} returnKeyType="go"
            style={{ flex: 1, color: C.white, fontSize: isTablet ? 17 : 15, padding: 0 }}
          />
          {inputCode.length > 0 && (
            <Pressable onPress={() => handleScan(inputCode)} style={{ backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: isTablet ? 16 : 12, paddingVertical: isTablet ? 8 : 6 }}>
              <Text style={{ color: C.white, fontSize: isTablet ? 14 : 12, fontWeight: '700' }}>Buscar</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Botón cámara */}
      <Pressable onPress={toggleCamera}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: isTablet ? 14 : 11, backgroundColor: cameraOpen ? C.indigoSurface : C.card, borderRadius: 12, borderWidth: 1, borderColor: cameraOpen ? C.indigo : C.border }}>
        {cameraOpen ? <X size={isTablet ? 20 : 18} color={C.indigo} /> : <Camera size={isTablet ? 20 : 18} color={C.textMuted} />}
        <Text style={{ color: cameraOpen ? C.indigo : C.textMuted, fontSize: isTablet ? 15 : 13, fontWeight: '600' }}>
          {cameraOpen ? 'Cerrar cámara' : 'Escanear con cámara'}
        </Text>
      </Pressable>

      {/* Cámara */}
      {cameraOpen && (
        permission?.granted ? (
          <View style={{ height: isTablet ? 320 : 240, borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: C.indigo }}>
            <CameraView style={{ flex: 1 }} facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr'] }}
              onBarcodeScanned={onBarcodeScanned} />
            <View style={{ position: 'absolute', top: '48%', left: 30, right: 30, height: 2.5, backgroundColor: C.accent, borderRadius: 2 }} />
            <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: 'white', fontSize: isTablet ? 13 : 11, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 }}>
                Apunta al código de barras
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ padding: 24, alignItems: 'center', backgroundColor: C.card, borderRadius: 14, gap: 10 }}>
            <Text style={{ color: C.textMuted, fontSize: isTablet ? 15 : 13 }}>Se necesita permiso de cámara</Text>
            <Pressable onPress={requestPermission} style={{ backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: C.white, fontSize: isTablet ? 14 : 13, fontWeight: '700' }}>Dar permiso</Text>
            </Pressable>
          </View>
        )
      )}

      {/* Loading */}
      {loading && (
        <View style={{ padding: 20, alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={{ color: C.textMuted, fontSize: 12 }}>Buscando...</Text>
        </View>
      )}

      {/* Error */}
      {error ? (
        <View style={{ backgroundColor: C.redSurface, borderRadius: 12, padding: isTablet ? 16 : 12, borderWidth: 1, borderColor: C.red + '40' }}>
          <Text style={{ color: C.red, fontSize: isTablet ? 14 : 13, textAlign: 'center', fontWeight: '600' }}>{error}</Text>
        </View>
      ) : null}

      {/* Resultado */}
      {producto && !loading && (
        <ResultadoEscaner
          producto={producto}
          navegando={navegando}
          loading={loading}
          onLimpiar={limpiar}
          onNavegarA={navegarA}
        />
      )}

      {/* Estado vacío */}
      {!producto && !loading && !error && !cameraOpen && (
        <View style={{ alignItems: 'center', paddingTop: isTablet ? 60 : 40, gap: 8 }}>
          <Text style={{ color: C.textMuted, fontSize: isTablet ? 16 : 14, textAlign: 'center' }}>
            {soloCamara ? 'Abre la cámara para escanear' : 'Escanea con la pistola, cámara, o escribe el código'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
