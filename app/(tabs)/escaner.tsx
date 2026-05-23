"use client";
import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Dimensions } from 'react-native';
import { Trash2, Camera, X, ScanBarcode, LayoutGrid } from 'lucide-react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Rect, Line } from 'react-native-svg';
import { escanearProducto } from '../../lib/queries';
import { C } from '../../lib/colors';
import useSettingsStore from '../../store/settingsStore';
import type { ProductoEscaneado } from '../../lib/types';

const { width: SCREEN_W } = Dimensions.get('window');
const isTablet = SCREEN_W >= 768;

// ─── Color helpers ────────────────────────────────────
function hexToRgb(hex: string) {
  const clean = hex?.replace('#', '');
  if (!clean || clean.length < 6) return null;
  return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
}
function textForBg(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.55 ? '#1a1a1a' : '#ffffff';
}

// ─── Sort tallas ──────────────────────────────────────
const ALPHA_TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL'];
function sortedTallas<T extends { talla: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const va = (a.talla || '').toUpperCase(), vb = (b.talla || '').toUpperCase();
    const na = parseInt(va), nb = parseInt(vb);
    const ia = !isNaN(na), ib = !isNaN(nb);
    if (ia && ib) return na - nb;
    if (ia) return -1; if (ib) return 1;
    const ai = ALPHA_TALLAS.indexOf(va), bi = ALPHA_TALLAS.indexOf(vb);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return va.localeCompare(vb);
  });
}

// ─── Talla pill (hermanas) ────────────────────────────
function TallaPill({ talla, stockTotal, esActual, cargando, onPress }: {
  talla: string; stockTotal: number; esActual: boolean; cargando: boolean; onPress: () => void;
}) {
  const sinStock = stockTotal === 0;
  return (
    <Pressable onPress={onPress} disabled={esActual || cargando}
      style={{
        width: isTablet ? 80 : 68,
        height: isTablet ? 84 : 72,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        backgroundColor: esActual ? C.accent : sinStock ? C.bg : C.card,
        borderWidth: esActual ? 0 : 2,
        borderColor: cargando ? C.accent : esActual ? 'transparent' : sinStock ? C.red + '40' : C.border,
        opacity: sinStock && !esActual ? 0.45 : 1,
      }}>
      {cargando ? (
        <ActivityIndicator size="small" color={C.accent} />
      ) : (
        <>
          <Text style={{ color: esActual ? C.white : sinStock ? C.red : C.textPrimary, fontSize: isTablet ? 22 : 19, fontWeight: '900', lineHeight: isTablet ? 26 : 22 }}>
            {talla}
          </Text>
          <Text style={{ color: esActual ? 'rgba(255,255,255,0.75)' : sinStock ? C.red : C.cyan, fontSize: isTablet ? 13 : 11, fontWeight: '700' }}>
            {stockTotal}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ─── Color pill ───────────────────────────────────────
function ColorPill({ colorNombre, stockTotal, esActual, cargando, onPress }: {
  colorNombre: string; stockTotal: number; esActual: boolean; cargando: boolean; onPress: () => void;
}) {
  const sinStock = stockTotal === 0;
  return (
    <Pressable onPress={onPress} disabled={esActual || cargando}
      style={{
        borderRadius: 14,
        paddingHorizontal: isTablet ? 18 : 14,
        paddingVertical: isTablet ? 12 : 10,
        backgroundColor: esActual ? C.indigo : C.card,
        borderWidth: esActual ? 0 : 1.5,
        borderColor: sinStock ? C.red + '40' : C.border,
        opacity: sinStock && !esActual ? 0.45 : 1,
        alignItems: 'center',
        gap: 4,
        minWidth: isTablet ? 80 : 68,
      }}>
      {cargando ? (
        <ActivityIndicator size="small" color={C.indigo} />
      ) : (
        <>
          <Text style={{ color: esActual ? C.white : C.textPrimary, fontSize: isTablet ? 14 : 13, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>
            {colorNombre}
          </Text>
          <Text style={{ color: esActual ? 'rgba(255,255,255,0.7)' : sinStock ? C.red : C.cyan, fontSize: isTablet ? 12 : 11, fontWeight: '700' }}>
            {stockTotal} uds
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ─── Alias locales de almacenes ──────────────────────
const ALMACEN_ALIAS: Record<string, string> = {
  'Almacen 1': 'Almacen 1 / Baño',
  'Almacen 2': 'Almacen 2 / Nuevo',
};

// ─── Stripe SVG background ────────────────────────────
function StripeBg({ color1, color2, w, h }: { color1: string; color2: string; w: number; h: number }) {
  const step = 18;
  const sw = 5;
  const lines = [];
  for (let x = -(h + step); x < w + h; x += step) {
    lines.push(<Line key={x} x1={x} y1={0} x2={x + h} y2={h} stroke={color1} strokeWidth={sw} strokeOpacity={0.6} />);
  }
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Rect x={0} y={0} width={w} height={h} fill={color2} fillOpacity={0.85} />
      {lines}
      {/* Overlay oscuro para mejorar legibilidad del texto */}
      <Rect x={0} y={0} width={w} height={h} fill="rgba(0,0,0,0.28)" />
    </Svg>
  );
}

// ─── Almacen card ─────────────────────────────────────
function AlmacenCard({ nombre, cantidad, colorHex, patron, colorSecundario }: {
  nombre: string; cantidad: number; colorHex?: string; patron?: string; colorSecundario?: string;
}) {
  const hasColor = !!colorHex;
  const isStripe = patron === 'rayas' && !!colorSecundario;
  const bg = hasColor ? colorHex! : C.card;
  const tc = isStripe ? '#ffffff' : hasColor ? textForBg(colorHex!) : C.textPrimary;
  const numColor = isStripe ? '#ffffff' : hasColor ? tc : (cantidad > 0 ? C.cyan : C.red + '80');
  const cardW = isTablet ? 110 : 90;

  return (
    <View style={{ flex: 1, minWidth: cardW, borderRadius: 14, overflow: 'hidden', backgroundColor: isStripe ? 'transparent' : bg, borderWidth: hasColor ? 0 : 1, borderColor: C.border }}>
      {isStripe && (
        <StripeBg color1={colorHex!} color2={colorSecundario!} w={SCREEN_W} h={120} />
      )}
      {hasColor && !isStripe && <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.2)' }} />}
      <View style={{ padding: isTablet ? 11 : 9, alignItems: 'center', gap: 1 }}>
        <Text style={{ color: hasColor ? tc : C.textMuted, fontSize: 20, fontWeight: '800', letterSpacing: 0.2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {ALMACEN_ALIAS[nombre] ?? nombre}
        </Text>
        <Text style={{ color: numColor, fontSize: isTablet ? 32 : 26, fontWeight: '900', lineHeight: isTablet ? 38 : 32 }}>
          {cantidad}
        </Text>
        <Text style={{ color: hasColor ? tc + '99' : C.textMuted, fontSize: isTablet ? 9 : 8, fontWeight: '600' }}>uds</Text>
      </View>
    </View>
  );
}

// ─── Resultado del escáner ────────────────────────────
function ResultadoEscaner({ producto: p, navegando, loading, onLimpiar, onNavegarA }: {
  producto: ProductoEscaneado; navegando: string | null; loading: boolean;
  onLimpiar: () => void; onNavegarA: (barcode: string) => void;
}) {
  const stockTotal = p.stockTotal;
  const hayStock = stockTotal > 0;
  const breadcrumbs = [p.categoria_nombre, p.subcategoria_nombre, p.fit_nombre].filter(Boolean);

  return (
    <View style={{ gap: 10 }}>

      {/* ══ HEADER ══════════════════════════════════════ */}
      <View style={{ backgroundColor: '#152b1e', borderRadius: 20, overflow: 'hidden', position: 'relative' }}>
        <View style={{ height: 4, backgroundColor: C.emerald }} />
        <View style={{ padding: isTablet ? 16 : 12, gap: isTablet ? 4 : 2 }}>

          {/* Fila superior: chips izquierda + precio derecha */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', flex: 1 }}>
              {breadcrumbs.map((label, i) => (
                <View key={i} style={{ backgroundColor: C.emerald + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: C.emerald + '35' }}>
                  <Text style={{ color: C.emerald, fontSize: isTablet ? 14 : 13, fontWeight: '700', letterSpacing: 0.3 }}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: C.emerald + '70', fontSize: 8, fontWeight: '600' }}>PRECIO</Text>
              <Text style={{ color: C.emerald, fontSize: isTablet ? 34 : 30, fontWeight: '900', lineHeight: isTablet ? 38 : 34 }}>
                S/ {p.precio}
              </Text>
            </View>
          </View>

          {/* Barcode */}
          <Text style={{ color: C.emerald + '55', fontSize: 11, fontWeight: '600', letterSpacing: 1 }}>{p.codigo_barras}</Text>

          {/* Marca */}
          <Text style={{ color: C.emerald, fontSize: isTablet ? 21 : 17, fontWeight: '900', letterSpacing: 0.8 }}>
            {p.marca_nombre.toUpperCase()}
          </Text>

          {/* Modelo */}
          <Text style={{ color: C.white, fontSize: isTablet ? 38 : 30, fontWeight: '900', lineHeight: isTablet ? 44 : 36 }} numberOfLines={2}>
            {p.producto_modelo}
          </Text>

          {/* Talla — esquina inferior derecha */}
          <View style={{ position: 'absolute', bottom: isTablet ? 14 : 10, right: isTablet ? 18 : 14, alignItems: 'center' }}>
            <Text style={{ color: C.white, fontSize: isTablet ? 13 : 11, fontWeight: '800', letterSpacing: 2 }}>TALLA</Text>
            <Text style={{ color: C.white, fontSize: 70, fontWeight: '900', lineHeight: 70 }}>
              {p.talla_valor}
            </Text>
          </View>

          {/* Género + Color + barcode */}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {p.genero_nombre ? (
              <View style={{ backgroundColor: C.emerald + '22', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: C.emerald + '35' }}>
                <Text style={{ color: C.emerald, fontSize: isTablet ? 16 : 15, fontWeight: '700' }}>{p.genero_nombre}</Text>
              </View>
            ) : null}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 }}>
              <Text style={{ color: C.white, fontSize: isTablet ? 16 : 15, fontWeight: '700' }}>{p.color_nombre}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ══ STOCK ════════════════════════════════════════ */}
      <View style={{ backgroundColor: hayStock ? C.cyanSurface : C.redSurface, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: isTablet ? 12 : 10, paddingHorizontal: 20, borderWidth: 1.5, borderColor: hayStock ? C.cyan + '50' : C.red + '50' }}>
        <Text style={{ color: hayStock ? C.cyan + 'aa' : C.red + 'aa', fontSize: isTablet ? 16 : 15, fontWeight: '600' }}>
          Stock en Talla {p.talla_valor}:
        </Text>
        <Text style={{ color: hayStock ? C.cyan : C.red, fontSize: isTablet ? 36 : 32, fontWeight: '900', lineHeight: isTablet ? 40 : 36 }}>{stockTotal}</Text>
        <Text style={{ color: hayStock ? C.cyan + 'aa' : C.red + 'aa', fontSize: isTablet ? 16 : 15, fontWeight: '600' }}>unidades</Text>
      </View>

      {/* ══ ALMACENES ════════════════════════════════════ */}
      {p.stockPorAlmacen.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: C.textMuted, fontSize: isTablet ? 10 : 9, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 2 }}>UBICACIÓN</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {p.stockPorAlmacen.map((s, i) => (
              <AlmacenCard key={i} nombre={s.almacen_nombre} cantidad={s.cantidad} colorHex={(s as any).color_hex} patron={(s as any).patron} colorSecundario={(s as any).color_secundario} />
            ))}
          </View>
        </View>
      )}

      {/* ══ TALLAS HERMANAS ══════════════════════════════ */}
      {p.tallasMismoColor.length > 1 && (
        <View style={{ backgroundColor: C.card, borderRadius: 18, padding: isTablet ? 18 : 14, gap: 12, borderWidth: 1, borderColor: C.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: C.accent }} />
            <Text style={{ color: C.textPrimary, fontSize: isTablet ? 13 : 12, fontWeight: '800' }}>
              TALLAS  <Text style={{ color: C.textMuted, fontWeight: '600' }}>{p.color_nombre}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {sortedTallas(p.tallasMismoColor).map((t, i) => (
              <TallaPill key={i}
                talla={t.talla} stockTotal={t.stock_total} esActual={t.es_actual}
                cargando={navegando === t.codigo_barras}
                onPress={() => !t.es_actual && !loading && onNavegarA(t.codigo_barras)}
              />
            ))}
          </View>
        </View>
      )}

      {/* ══ COLORES ══════════════════════════════════════ */}
      {p.coloresDisponibles.length > 1 && (
        <View style={{ backgroundColor: C.card, borderRadius: 18, padding: isTablet ? 18 : 14, gap: 12, borderWidth: 1, borderColor: C.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: C.indigo }} />
            <Text style={{ color: C.textPrimary, fontSize: isTablet ? 13 : 12, fontWeight: '800' }}>COLORES</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.coloresDisponibles.map((c, i) => (
              <ColorPill key={i}
                colorNombre={c.color_nombre} stockTotal={c.stock_total}
                esActual={c.color_nombre === p.color_nombre}
                cargando={navegando === c.codigo_barras}
                onPress={() => c.color_nombre !== p.color_nombre && !loading && onNavegarA(c.codigo_barras)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Ver en Matriz */}
      <Pressable onPress={() => router.push({ pathname: '/(tabs)/consultas', params: { modelo: p.producto_modelo, producto_id: p.producto_id } })}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: isTablet ? 16 : 13, backgroundColor: C.indigoSurface, borderRadius: 14, borderWidth: 1, borderColor: C.indigo + '60', marginTop: 2 }}>
        <LayoutGrid size={15} color={C.indigo} />
        <Text style={{ color: C.indigo, fontSize: isTablet ? 14 : 13, fontWeight: '700' }}>Ver stock completo en Matriz</Text>
      </Pressable>

      {/* Limpiar */}
      <Pressable onPress={onLimpiar}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: isTablet ? 16 : 13, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
        <Trash2 size={15} color={C.textMuted} />
        <Text style={{ color: C.textMuted, fontSize: isTablet ? 14 : 13, fontWeight: '600' }}>Limpiar</Text>
      </Pressable>
    </View>
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

  useEffect(() => { if (!permission?.granted) requestPermission(); }, []);

  const handleScan = useCallback(async (code: string) => {
    if (loading || !code.trim()) return;
    setLoading(true); setError('');
    try {
      const result = await escanearProducto(code.trim());
      if (result) { setProducto(result); }
      else { setProducto(null); setError(`No encontrado: ${code.trim().padStart(13, '0')}`); }
    } catch (e: any) {
      setProducto(null); setError(e.message || 'Error al buscar');
    } finally {
      setLoading(false); setNavegando(null); setInputCode('');
    }
  }, [loading]);

  const toggleCamera = useCallback(async () => {
    if (!cameraOpen && !permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setCameraOpen(!cameraOpen); setScanned(false);
  }, [cameraOpen, permission, requestPermission]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true); setCameraOpen(false); handleScan(data);
    setTimeout(() => setScanned(false), 1500);
  }, [scanned, loading, handleScan]);

  const navegarA = useCallback((barcode: string) => {
    if (!barcode || loading) return;
    setNavegando(barcode); handleScan(barcode);
  }, [handleScan, loading]);

  const limpiar = useCallback(() => { setProducto(null); setError(''); setCameraOpen(true); setScanned(false); }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: isTablet ? 20 : 12, paddingBottom: 48, gap: 10 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Input pistola */}
      {!soloCamara && (
        <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1.5, borderColor: producto ? C.border : C.accent, paddingHorizontal: isTablet ? 16 : 12, paddingVertical: isTablet ? 12 : 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.emerald }} />
          <TextInput
            value={inputCode} onChangeText={setInputCode}
            onSubmitEditing={() => handleScan(inputCode)}
            placeholder="Escanea o escribe código..."
            placeholderTextColor={C.textMuted}
            autoCapitalize="none" autoCorrect={false} blurOnSubmit={false} returnKeyType="go"
            style={{ flex: 1, color: C.white, fontSize: isTablet ? 17 : 15, padding: 0 }}
          />
          {inputCode.length > 0 && (
            <Pressable onPress={() => handleScan(inputCode)} style={{ backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: isTablet ? 16 : 12, paddingVertical: isTablet ? 8 : 6 }}>
              <Text style={{ color: C.white, fontSize: isTablet ? 14 : 12, fontWeight: '700' }}>Buscar</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Botón cámara */}
      <Pressable onPress={toggleCamera}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: isTablet ? 14 : 11, backgroundColor: cameraOpen ? C.indigoSurface : C.card, borderRadius: 14, borderWidth: 1, borderColor: cameraOpen ? C.indigo : C.border }}>
        {cameraOpen ? <X size={18} color={C.indigo} /> : <Camera size={18} color={C.textMuted} />}
        <Text style={{ color: cameraOpen ? C.indigo : C.textMuted, fontSize: isTablet ? 15 : 13, fontWeight: '600' }}>
          {cameraOpen ? 'Cerrar cámara' : 'Escanear con cámara'}
        </Text>
      </Pressable>

      {/* Cámara */}
      {cameraOpen && (
        permission?.granted ? (
          <View style={{ height: isTablet ? 300 : 230, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: C.indigo }}>
            <CameraView style={{ flex: 1 }} facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr'] }}
              onBarcodeScanned={onBarcodeScanned} />
            <View style={{ position: 'absolute', top: '48%', left: 32, right: 32, height: 2.5, backgroundColor: C.accent, borderRadius: 2, opacity: 0.85 }} />
            <View style={{ position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' }}>
              <Text style={{ color: 'white', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 }}>
                Apunta al código de barras
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ padding: 24, alignItems: 'center', backgroundColor: C.card, borderRadius: 16, gap: 10 }}>
            <Text style={{ color: C.textMuted, fontSize: 13 }}>Se necesita permiso de cámara</Text>
            <Pressable onPress={requestPermission} style={{ backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>Dar permiso</Text>
            </Pressable>
          </View>
        )
      )}

      {/* Loading */}
      {loading && (
        <View style={{ paddingVertical: 32, alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={{ color: C.textMuted, fontSize: 13 }}>Buscando...</Text>
        </View>
      )}

      {/* Error */}
      {!!error && (
        <View style={{ backgroundColor: C.redSurface, borderRadius: 14, padding: isTablet ? 16 : 14, borderWidth: 1, borderColor: C.red + '40' }}>
          <Text style={{ color: C.red, fontSize: isTablet ? 14 : 13, textAlign: 'center', fontWeight: '600' }}>{error}</Text>
        </View>
      )}

      {/* Resultado */}
      {producto && !loading && (
        <ResultadoEscaner
          producto={producto} navegando={navegando} loading={loading}
          onLimpiar={limpiar} onNavegarA={navegarA}
        />
      )}

      {/* Estado vacío */}
      {!producto && !loading && !error && !cameraOpen && (
        <View style={{ alignItems: 'center', paddingTop: isTablet ? 60 : 48, gap: 12 }}>
          <ScanBarcode size={48} color={C.border} strokeWidth={1.5} />
          <Text style={{ color: C.textMuted, fontSize: isTablet ? 15 : 13, textAlign: 'center', lineHeight: 20 }}>
            {soloCamara ? 'Abre la cámara para escanear' : 'Escanea con la pistola,\ncámara o escribe el código'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
