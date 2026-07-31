import { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Vibration } from 'react-native';
import { ArrowRight, ShoppingCart, Camera, X, Trash2, Minus, Plus, Send, CheckCircle, AlertTriangle } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useAuthStore from '../../store/authStore';
import { fetchAlmacenes, escanearProducto } from '../../lib/queries';
import { railwayPost } from '../../lib/railway';
import { syncDatabase } from '../../lib/sync';
import { scanFeedbackOk, scanFeedbackError } from '../../lib/scanFeedback';
import { useScanGuard } from '../../lib/scanGuard';
import { AlmacenPills, AlmacenSwatch } from '../../components/AlmacenPills';
import { C } from '../../lib/colors';

interface VentaItem {
  variante_id: string;
  sku_variant: string;
  codigo_barras: string;
  modelo: string;
  marca: string;
  fit: string;
  color: string;
  talla: string;
  precio: number;
  stock_origen: number;
  cantidad: number;
}

type Resultado =
  | { tipo: 'pendiente'; total: number }
  | { tipo: 'directo'; procesados: number; errores: { codigo_barras: string; error: string }[] };

export default function VentasScreen() {
  const user = useAuthStore(s => s.user);
  // A diferencia de Traslados, ventas lista TODOS los almacenes activos (igual que
  // la PWA): el Almacén Principal también puede vender directo.
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes });

  const [origenId, setOrigenId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [items, setItems] = useState<VentaItem[]>([]);
  const [inputCode, setInputCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ text: string; color: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [snapshot, setSnapshot] = useState<VentaItem[]>([]);

  const inputRef = useRef<TextInput>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const { guard, reset: resetScanGuard } = useScanGuard();

  // Origen === destino es válido: "venta directa desde el mismo almacén"
  const rutaLista = !!(origenId && destinoId);
  const ventaDirecta = rutaLista && origenId === destinoId;
  const totalPrendas = items.reduce((s, it) => s + it.cantidad, 0);
  const totalSoles = items.reduce((s, it) => s + it.cantidad * it.precio, 0);
  const origenAlm = (almacenes || []).find((a: any) => a.id === origenId);
  const destinoAlm = (almacenes || []).find((a: any) => a.id === destinoId);

  // Al quedar la ruta armada, abrir la cámara automáticamente (sin teclado)
  useEffect(() => {
    if (!rutaLista) { setCameraOpen(false); return; }
    (async () => {
      if (permission?.granted) { setCameraOpen(true); return; }
      const r = await requestPermission();
      if (r.granted) setCameraOpen(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaLista]);

  const show = (text: string, color: string) => {
    setScanMsg({ text, color });
    setTimeout(() => setScanMsg(m => (m?.text === text ? null : m)), 3500);
  };

  const handleScan = useCallback(async (raw: string) => {
    const code = raw.trim();
    setInputCode('');
    if (!code) return;
    if (!origenId) { show('Selecciona el almacén origen primero', C.amber); return; }
    try {
      const data = await escanearProducto(code);
      if (!data) { show(`No encontrado: ${code}`, C.red); scanFeedbackError(); return; }
      const stockOrigen = data.stockPorAlmacen.find((s: any) => s.almacen_id === origenId)?.cantidad ?? 0;
      if (stockOrigen <= 0) {
        show(`Sin stock en ${origenAlm?.nombre || 'origen'}: ${data.sku_variant}`, C.red);
        scanFeedbackError();
        return;
      }
      const existing = items.find(it => it.variante_id === data.id);
      if (existing) {
        if (existing.cantidad >= stockOrigen) {
          show(`Máximo stock en origen (${stockOrigen}): ${data.sku_variant}`, C.amber);
          scanFeedbackError();
          return;
        }
        // Igual que la PWA: escaneo repetido suma +1 y sube el ítem al tope
        setItems(prev => {
          const it = prev.find(p => p.variante_id === data.id)!;
          return [{ ...it, cantidad: it.cantidad + 1 }, ...prev.filter(p => p.variante_id !== data.id)];
        });
        show(`+1 ${data.sku_variant} → ${existing.cantidad + 1}/${stockOrigen}`, C.blue);
        scanFeedbackOk();
      } else {
        setItems(prev => [{
          variante_id: data.id, sku_variant: data.sku_variant, codigo_barras: data.codigo_barras,
          modelo: data.producto_modelo || '—', marca: data.marca_nombre || '',
          fit: data.fit_nombre || '', color: data.color_nombre || '—', talla: data.talla_valor || '—',
          precio: Number(data.precio) || 0, stock_origen: stockOrigen, cantidad: 1,
        }, ...prev]);
        show(`+ ${data.sku_variant} (stock: ${stockOrigen})`, C.emerald);
        scanFeedbackOk();
      }
    } catch {
      show('Error al buscar', C.red);
    }
  }, [origenId, origenAlm, items]);

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
      ? { ...it, cantidad: Math.max(1, Math.min(it.cantidad + delta, it.stock_origen)) }
      : it));
  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.variante_id !== id));

  const ejecutar = async () => {
    if (!rutaLista || !items.length || !user || executing) return;
    setExecuting(true);
    try {
      if (user.rol === 'almacenero') {
        // Cola de aprobación (mismo contrato que la PWA para el rol almacenero)
        await railwayPost('/api/operaciones/encolar/', {
          tipo_operacion: 'VENTA',
          items: items.map(it => ({
            codigo_barras: it.codigo_barras, cantidad: it.cantidad,
            almacen_origen_id: origenId, almacen_destino_id: destinoId,
          })),
          usuario_id: user.id, usuario_nombre: user.username, rol: user.rol,
        });
        setResultado({ tipo: 'pendiente', total: totalPrendas });
      } else {
        // Un solo request en batch — mismo endpoint que la PWA y el ERP
        const res: any = await railwayPost('/api/operaciones/venta-multiple/', {
          items: items.map(it => ({ codigo_barras: it.codigo_barras, cantidad: it.cantidad })),
          almacen_origen_id: origenId,
          almacen_destino_id: destinoId,
          usuario_id: user.id,
        });
        const errores = (res?.errores_detalle || []).map((e: any) => ({
          codigo_barras: e?.codigo_barras || '?',
          error: e?.error || e?.mensaje || 'Error',
        }));
        setResultado({ tipo: 'directo', procesados: res?.procesados ?? (items.length - errores.length), errores });
        syncDatabase().catch(() => {});
      }
      setSnapshot([...items]);
      setItems([]);
      Vibration.vibrate([0, 80, 60, 80]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Error al registrar la venta');
    } finally {
      setExecuting(false);
    }
  };

  // Igual que la PWA: origen y destino se conservan para seguir vendiendo desde el mismo puesto
  const nuevaVenta = () => {
    setResultado(null);
    setSnapshot([]);
    resetScanGuard();
  };

  // ─── Render ───

  if (resultado) {
    const okTotal = resultado.tipo === 'pendiente' ? resultado.total
      : snapshot.reduce((s, it) => s + it.cantidad, 0);
    const okSoles = snapshot.reduce((s, it) => s + it.cantidad * it.precio, 0);
    const hayErrores = resultado.tipo === 'directo' && resultado.errores.length > 0;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <View style={{ backgroundColor: hayErrores ? C.amber + '18' : C.emerald + '18', borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: hayErrores ? C.amber : C.emerald }}>
            {hayErrores ? <AlertTriangle size={44} color={C.amber} strokeWidth={1.8} /> : <CheckCircle size={44} color={C.emerald} strokeWidth={1.8} />}
            <Text style={{ color: C.white, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>
              {resultado.tipo === 'pendiente' ? 'ENVIADO PARA APROBACIÓN' : hayErrores ? 'VENTA CON ERRORES' : 'VENTA REGISTRADA'}
            </Text>
            <Text style={{ color: C.textSecondary, fontSize: 13, textAlign: 'center' }}>
              {origenId === destinoId ? `${origenAlm?.nombre} (venta directa)` : `${origenAlm?.nombre} → ${destinoAlm?.nombre}`} · {okTotal} prendas · S/ {okSoles.toFixed(2)}
            </Text>
            {resultado.tipo === 'pendiente' && (
              <Text style={{ color: C.textMuted, fontSize: 11, textAlign: 'center' }}>
                Un admin/supervisor debe aprobarlo antes de que mueva stock
              </Text>
            )}
          </View>

          {hayErrores && resultado.tipo === 'directo' && (
            <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: C.red, gap: 6 }}>
              <Text style={{ color: C.red, fontSize: 13, fontWeight: '700' }}>Errores ({resultado.errores.length})</Text>
              {resultado.errores.map((er, i) => (
                <Text key={`${er.codigo_barras}-${i}`} style={{ color: C.textSecondary, fontSize: 11 }} numberOfLines={2}>
                  {er.codigo_barras}: {er.error}
                </Text>
              ))}
            </View>
          )}

          <Pressable onPress={nuevaVenta}
            style={{ backgroundColor: C.accent, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <ShoppingCart size={18} color={C.white} />
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>Nueva venta</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">

        {/* ── Origen ── */}
        <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>ORIGEN — DÓNDE ESTÁN LAS PRENDAS</Text>
        <AlmacenPills almacenes={almacenes || []} selectedId={origenId}
          onSelect={(id) => setOrigenId(id === origenId ? null : id)} />

        {/* ── Destino (puesto de venta) ── */}
        {origenId && (
          <>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>PUESTO DE VENTA</Text>
            <AlmacenPills almacenes={almacenes || []} selectedId={destinoId}
              onSelect={(id) => setDestinoId(id === destinoId ? null : id)} />
          </>
        )}

        {/* ── Ruta ── */}
        {rutaLista && (
          <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border }}>
            <AlmacenSwatch almacen={origenAlm} width={10} height={36} radius={5} />
            {ventaDirecta ? (
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.emerald, fontSize: 10, fontWeight: '700' }}>VENTA DIRECTA</Text>
                <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{origenAlm?.nombre}</Text>
              </View>
            ) : (
              <>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.amberLight, fontSize: 10, fontWeight: '700' }}>ORIGEN</Text>
                  <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{origenAlm?.nombre}</Text>
                </View>
                <ArrowRight size={18} color={C.textMuted} />
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.indigoLight, fontSize: 10, fontWeight: '700' }}>PUESTO DE VENTA</Text>
                  <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{destinoAlm?.nombre}</Text>
                </View>
              </>
            )}
            <AlmacenSwatch almacen={destinoAlm} width={10} height={36} radius={5} />
          </View>
        )}

        {/* ── Escaneo ── */}
        {rutaLista && (
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
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>PRENDAS A VENDER</Text>
              <Text style={{ color: C.accentLight, fontSize: 12, fontWeight: '800' }}>{items.length} refs · {totalPrendas} uds · S/ {totalSoles.toFixed(2)}</Text>
            </View>
            {items.map(it => (
              <View key={it.variante_id} style={{ backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 8, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                      {it.marca} · {it.modelo}
                    </Text>
                    <Text style={{ color: C.textSecondary, fontSize: 11 }} numberOfLines={1}>
                      {it.fit ? `${it.fit} · ` : ''}{it.color} · T{it.talla} · stock {it.stock_origen}
                    </Text>
                  </View>
                  <Text style={{ color: C.emerald, fontSize: 13, fontWeight: '800' }}>S/ {(it.precio * it.cantidad).toFixed(2)}</Text>
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
                  <Pressable onPress={() => updateCant(it.variante_id, 1)} disabled={it.cantidad >= it.stock_origen}
                    style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', opacity: it.cantidad >= it.stock_origen ? 0.4 : 1 }}>
                    <Plus size={16} color={C.textSecondary} />
                  </Pressable>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: C.textMuted, fontSize: 11 }}>máx {it.stock_origen}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {rutaLista && items.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
            <ShoppingCart size={32} color={C.textMuted} strokeWidth={1.5} />
            <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Escanea las prendas vendidas{'\n'}{ventaDirecta ? `en ${origenAlm?.nombre}` : `de ${origenAlm?.nombre} para ${destinoAlm?.nombre}`}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Footer fijo ── */}
      {items.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 10 }}>
          <Pressable onPress={ejecutar} disabled={executing}
            style={{ backgroundColor: executing ? C.accentSurface : C.emerald, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: executing ? 0.7 : 1 }}>
            {executing ? <ActivityIndicator size="small" color={C.white} /> : <Send size={18} color={C.white} />}
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>
              {executing ? 'Procesando...'
                : user?.rol === 'almacenero'
                  ? `Enviar para aprobación · ${totalPrendas} prendas`
                  : `Registrar venta · ${totalPrendas} prendas · S/ ${totalSoles.toFixed(2)}`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
