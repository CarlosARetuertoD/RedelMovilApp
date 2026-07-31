import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Vibration } from 'react-native';
import { PackageCheck, Camera, X, Trash2, Minus, Plus, Send, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { fetchAlmacenes, escanearProducto } from '../../lib/queries';
import { fetchPendientePrincipal, enviarATiendas } from '../../lib/distribuciones';
import { syncDatabase } from '../../lib/sync';
import { scanFeedbackOk, scanFeedbackError } from '../../lib/scanFeedback';
import { useScanGuard } from '../../lib/scanGuard';
import { C } from '../../lib/colors';
import { AlmacenPills } from '../../components/AlmacenPills';

interface RefPendiente {
  detalle_id: string;
  distribucion_id: string;
  distribucion_codigo: string;
  disponible: number;
}

interface IngresoItem {
  variante_id: string;
  sku_variant: string;
  modelo: string;
  marca: string;
  color: string;
  talla: string;
  cantidad: number;
  pendienteTotal: number;
  refs: RefPendiente[];
}

type Resultado = { procesados: number; errores: { codigo: string; error: string }[] };

export default function IngresosScreen() {
  const { data: almacenesData } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes });
  // Almacén Principal es el origen implícito de todo ingreso (zona de tránsito de lotes) —
  // nunca aparece como destino seleccionable, igual que en Traslados.
  const almacenes = useMemo(() => (almacenesData || []).filter((a: any) => !a.es_almacen_principal), [almacenesData]);

  const { data: pendienteData, isLoading: pendienteLoading, refetch: refetchPendiente } = useQuery({
    queryKey: ['pendientePrincipal'],
    queryFn: fetchPendientePrincipal,
    staleTime: 30 * 1000,
  });

  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [items, setItems] = useState<IngresoItem[]>([]);
  const [inputCode, setInputCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ text: string; color: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [snapshot, setSnapshot] = useState<IngresoItem[]>([]);

  const inputRef = useRef<TextInput>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const { guard, reset: resetScanGuard } = useScanGuard();

  const destinoAlm = (almacenes || []).find((a: any) => a.id === destinoId);
  const totalPrendas = items.reduce((s, it) => s + it.cantidad, 0);

  const pendienteParaDestino = useMemo(() => {
    if (!destinoId) return [];
    return (pendienteData?.distribuciones || []).flatMap((d: any) =>
      d.items_pendientes.filter((ip: any) => ip.almacen_destino_id === destinoId));
  }, [pendienteData, destinoId]);
  const totalPendienteDestino = pendienteParaDestino.reduce((s: number, ip: any) => s + ip.pendiente_envio, 0);

  // Al elegir destino, abrir la cámara automáticamente (sin teclado).
  useEffect(() => {
    if (!destinoId) { setCameraOpen(false); return; }
    (async () => {
      if (permission?.granted) { setCameraOpen(true); return; }
      const r = await requestPermission();
      if (r.granted) setCameraOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinoId]);

  const show = (text: string, color: string) => {
    setScanMsg({ text, color });
    setTimeout(() => setScanMsg(m => (m?.text === text ? null : m)), 3500);
  };

  const handleScan = useCallback(async (raw: string) => {
    const code = raw.trim();
    setInputCode('');
    if (!code) return;
    if (!destinoId) { show('Selecciona el almacén destino primero', C.amber); return; }
    try {
      const data = await escanearProducto(code);
      if (!data) { show(`No encontrado: ${code}`, C.red); scanFeedbackError(); return; }

      const matches: RefPendiente[] = (pendienteData?.distribuciones || [])
        .flatMap((d: any) => d.items_pendientes
          .filter((ip: any) => ip.variante_id === data.id && ip.almacen_destino_id === destinoId)
          .map((ip: any) => ({
            detalle_id: ip.detalle_id, distribucion_id: d.distribucion_id,
            distribucion_codigo: d.codigo, disponible: ip.pendiente_envio,
          })));
      const pendienteTotal = matches.reduce((s, m) => s + m.disponible, 0);

      if (pendienteTotal <= 0) {
        show(`Sin lote pendiente para ${data.sku_variant} → ${destinoAlm?.nombre || 'destino'}`, C.red);
        scanFeedbackError();
        return;
      }

      const existing = items.find(it => it.variante_id === data.id);
      if (existing) {
        if (existing.cantidad >= existing.pendienteTotal) {
          show(`Máximo pendiente (${existing.pendienteTotal}): ${data.sku_variant}`, C.amber);
          scanFeedbackError();
          return;
        }
        setItems(prev => prev.map(it => it.variante_id === data.id ? { ...it, cantidad: it.cantidad + 1 } : it));
        show(`+1 ${data.sku_variant} → ${existing.cantidad + 1}/${existing.pendienteTotal}`, C.blue);
        scanFeedbackOk();
      } else {
        setItems(prev => [...prev, {
          variante_id: data.id, sku_variant: data.sku_variant,
          modelo: data.producto_modelo || '—', marca: data.marca_nombre || '',
          color: data.color_nombre || '—', talla: data.talla_valor || '—',
          cantidad: 1, pendienteTotal, refs: matches,
        }]);
        show(`+ ${data.sku_variant} (pendiente: ${pendienteTotal})`, C.emerald);
        scanFeedbackOk();
      }
    } catch {
      show('Error al buscar', C.red);
    }
  }, [destinoId, destinoAlm, items, pendienteData]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    guard(data, handleScan);
  }, [guard, handleScan]);

  const toggleCamera = useCallback(async () => {
    if (!cameraOpen && !permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) { Alert.alert('Cámara', 'Se necesita permiso de cámara para escanear'); return; }
    }
    setCameraOpen(v => !v);
    resetScanGuard();
  }, [cameraOpen, permission, requestPermission, resetScanGuard]);

  const updateCant = (id: string, delta: number) =>
    setItems(prev => prev.map(it => it.variante_id === id
      ? { ...it, cantidad: Math.max(1, Math.min(it.cantidad + delta, it.pendienteTotal)) }
      : it));
  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.variante_id !== id));

  const ejecutar = async () => {
    if (!destinoId || !items.length || executing) return;
    setExecuting(true);
    try {
      // Reparte cada item entre los lotes de origen (FIFO por fecha) y agrupa por
      // distribución, porque enviar-a-tiendas es un endpoint por lote.
      const porDistribucion = new Map<string, { codigo: string; items: { detalle_id: string; cantidad: number }[] }>();
      for (const it of items) {
        let restante = it.cantidad;
        for (const ref of it.refs) {
          if (restante <= 0) break;
          const usar = Math.min(restante, ref.disponible);
          if (usar <= 0) continue;
          restante -= usar;
          if (!porDistribucion.has(ref.distribucion_id)) {
            porDistribucion.set(ref.distribucion_id, { codigo: ref.distribucion_codigo, items: [] });
          }
          porDistribucion.get(ref.distribucion_id)!.items.push({ detalle_id: ref.detalle_id, cantidad: usar });
        }
      }

      let procesados = 0;
      const errores: { codigo: string; error: string }[] = [];
      for (const [distId, payload] of porDistribucion) {
        try {
          await enviarATiendas(distId, payload.items);
          procesados += payload.items.reduce((s, i) => s + i.cantidad, 0);
        } catch (e: any) {
          errores.push({ codigo: payload.codigo, error: e?.message || 'Error' });
        }
      }

      setSnapshot([...items]);
      setResultado({ procesados, errores });
      setItems([]);
      Vibration.vibrate([0, 80, 60, 80]);
      syncDatabase().catch(() => {});
      refetchPendiente();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Error al confirmar el ingreso');
    } finally {
      setExecuting(false);
    }
  };

  const nuevoIngreso = () => {
    setResultado(null);
    setSnapshot([]);
    setDestinoId(null);
    resetScanGuard();
  };

  // ─── Render ───

  if (resultado) {
    const hayErrores = resultado.errores.length > 0;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <View style={{ backgroundColor: hayErrores ? C.amber + '18' : C.emerald + '18', borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: hayErrores ? C.amber : C.emerald }}>
            {hayErrores ? <AlertTriangle size={44} color={C.amber} strokeWidth={1.8} /> : <CheckCircle size={44} color={C.emerald} strokeWidth={1.8} />}
            <Text style={{ color: C.white, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>
              {hayErrores ? 'INGRESO CON ERRORES' : 'INGRESO CONFIRMADO'}
            </Text>
            <Text style={{ color: C.textSecondary, fontSize: 13, textAlign: 'center' }}>
              {destinoAlm?.nombre} · {resultado.procesados} prendas
            </Text>
          </View>

          {hayErrores && (
            <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: C.red, gap: 6 }}>
              <Text style={{ color: C.red, fontSize: 13, fontWeight: '700' }}>Errores ({resultado.errores.length})</Text>
              {resultado.errores.map((er, i) => (
                <Text key={er.codigo + i} style={{ color: C.textSecondary, fontSize: 11 }} numberOfLines={2}>
                  {er.codigo}: {er.error}
                </Text>
              ))}
            </View>
          )}

          <Pressable onPress={nuevoIngreso}
            style={{ backgroundColor: C.accent, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <PackageCheck size={18} color={C.white} />
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>Nuevo ingreso</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">

        {/* ── Destino ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>ALMACÉN DESTINO</Text>
          <Pressable onPress={() => refetchPendiente()} hitSlop={8}>
            <RefreshCw size={14} color={C.textMuted} />
          </Pressable>
        </View>
        <AlmacenPills almacenes={almacenes} selectedId={destinoId}
          onSelect={(id) => setDestinoId(id === destinoId ? null : id)} />

        {destinoId && (
          pendienteLoading ? (
            <ActivityIndicator size="small" color={C.textMuted} />
          ) : pendienteData?.almacen_principal === null ? (
            <Text style={{ color: C.amber, fontSize: 12 }}>No hay Almacén Principal configurado en el ERP.</Text>
          ) : (
            <Text style={{ color: C.textMuted, fontSize: 11 }}>
              {pendienteParaDestino.length} referencias · {totalPendienteDestino} prendas pendientes de ingresar a {destinoAlm?.nombre}
            </Text>
          )
        )}

        {/* ── Escaneo ── */}
        {destinoId && (
          <>
            {cameraOpen && permission?.granted && (
              <View style={{ height: 220, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: C.indigo }}>
                <CameraView style={{ flex: 1 }} facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39'] }}
                  onBarcodeScanned={onBarcodeScanned} />
                <View style={{ position: 'absolute', top: '48%', left: 32, right: 32, height: 2.5, backgroundColor: C.accent, borderRadius: 2, opacity: 0.85 }} />
                <View style={{ position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center' }}>
                  <Text style={{ color: 'white', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 }}>
                    Apunta al código de barras
                  </Text>
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12 }}>
                <TextInput
                  ref={inputRef}
                  value={inputCode}
                  onChangeText={setInputCode}
                  onSubmitEditing={() => handleScan(inputCode)}
                  placeholder="O escribe / escanea con pistola aquí..."
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  blurOnSubmit={false}
                  returnKeyType="go"
                  style={{ flex: 1, color: C.white, fontSize: 14, paddingVertical: 12 }}
                />
                {inputCode ? (
                  <Pressable onPress={() => setInputCode('')} hitSlop={8}><X size={16} color={C.textMuted} /></Pressable>
                ) : null}
              </View>
              <Pressable onPress={toggleCamera}
                style={{ width: 48, borderRadius: 10, backgroundColor: cameraOpen ? C.indigo : C.card, borderWidth: 1, borderColor: cameraOpen ? C.indigo : C.border, alignItems: 'center', justifyContent: 'center' }}>
                {cameraOpen ? <X size={20} color={C.white} /> : <Camera size={20} color={C.textSecondary} />}
              </Pressable>
            </View>

            {scanMsg && (
              <View style={{ backgroundColor: scanMsg.color + '18', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: scanMsg.color }}>
                <Text style={{ color: scanMsg.color, fontSize: 13, fontWeight: '700' }} numberOfLines={2}>{scanMsg.text}</Text>
              </View>
            )}
          </>
        )}

        {/* ── Items ── */}
        {items.length > 0 && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>PRENDAS A INGRESAR</Text>
              <Text style={{ color: C.accentLight, fontSize: 12, fontWeight: '800' }}>{items.length} refs · {totalPrendas} uds</Text>
            </View>
            {items.map(it => (
              <View key={it.variante_id} style={{ backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                      {it.marca} · {it.modelo}
                    </Text>
                    <Text style={{ color: C.textSecondary, fontSize: 11 }} numberOfLines={1}>
                      {it.color} · T{it.talla} · pendiente {it.pendienteTotal}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeItem(it.variante_id)} hitSlop={8}
                    style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.redSurface, alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={15} color={C.red} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pressable onPress={() => updateCant(it.variante_id, -1)} disabled={it.cantidad <= 1}
                    style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: it.cantidad <= 1 ? 0.4 : 1 }}>
                    <Minus size={16} color={C.textSecondary} />
                  </Pressable>
                  <Text style={{ color: C.white, fontSize: 18, fontWeight: '900', minWidth: 36, textAlign: 'center' }}>{it.cantidad}</Text>
                  <Pressable onPress={() => updateCant(it.variante_id, 1)} disabled={it.cantidad >= it.pendienteTotal}
                    style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: it.cantidad >= it.pendienteTotal ? 0.4 : 1 }}>
                    <Plus size={16} color={C.textSecondary} />
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: C.textMuted, fontSize: 11 }}>máx {it.pendienteTotal}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {destinoId && items.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
            <PackageCheck size={32} color={C.textMuted} strokeWidth={1.5} />
            <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Escanea las prendas que llegaron del Almacén Principal{'\n'}a {destinoAlm?.nombre}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Footer fijo ── */}
      {items.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, padding: 12 }}>
          <Pressable onPress={ejecutar} disabled={executing}
            style={{ backgroundColor: executing ? C.accentSurface : C.emerald, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: executing ? 0.7 : 1 }}>
            {executing ? <ActivityIndicator size="small" color={C.white} /> : <Send size={18} color={C.white} />}
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>
              {executing ? 'Procesando...' : `Confirmar ingreso · ${totalPrendas} prendas`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
