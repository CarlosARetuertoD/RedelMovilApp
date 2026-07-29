import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Vibration, Switch } from 'react-native';
import { ArrowRight, ArrowLeftRight, Camera, X, Trash2, Minus, Plus, Printer, Send, CheckCircle, AlertTriangle, Bluetooth, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useAuthStore from '../../store/authStore';
import { fetchAlmacenes, escanearProducto } from '../../lib/queries';
import { railwayPost } from '../../lib/railway';
import { syncDatabase } from '../../lib/sync';
import { fetchPlantillaEtiqueta, type LabelJob } from '../../lib/labelPrint';
import { isNativePrinterAvailable, printerStatus, printBase64, requestBluetoothPermission, type PrinterStatus } from '../../modules/spp-printer';
import LabelRenderer, { type LabelRendererHandle } from '../../components/LabelRenderer';
import { AlmacenPills, AlmacenSwatch } from '../../components/AlmacenPills';
import { C } from '../../lib/colors';

interface TrasladoItem {
  variante_id: string;
  sku_variant: string;
  codigo_barras: string;
  modelo: string;
  marca: string;
  categoria: string;
  subcategoria: string;
  fit: string;
  genero: string;
  color: string;
  talla: string;
  precio: number;
  sku_product: string;
  stock_origen: number;
  cantidad: number;
}

type Resultado =
  | { tipo: 'pendiente'; total: number }
  | { tipo: 'directo'; procesados: number; errores: { codigo_barras: string; error: string }[] };

export default function TrasladosScreen() {
  const user = useAuthStore(s => s.user);
  const { data: almacenesData } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes });
  // Almacén Principal es solo de tránsito para lotes (Ingresos de Stock) —
  // no es un punto físico entre el que se traslade prendas.
  const almacenes = useMemo(() => (almacenesData || []).filter((a: any) => !a.es_almacen_principal), [almacenesData]);
  const { data: plantilla } = useQuery({
    queryKey: ['plantillaEtiqueta'],
    queryFn: fetchPlantillaEtiqueta,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });

  const [origenId, setOrigenId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [items, setItems] = useState<TrasladoItem[]>([]);
  const [inputCode, setInputCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ text: string; color: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [imprimir, setImprimir] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [snapshot, setSnapshot] = useState<TrasladoItem[]>([]);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);

  const inputRef = useRef<TextInput>(null);
  const rendererRef = useRef<LabelRendererHandle>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const rutaLista = !!(origenId && destinoId && origenId !== destinoId);
  const totalPrendas = items.reduce((s, it) => s + it.cantidad, 0);
  const origenAlm = (almacenes || []).find((a: any) => a.id === origenId);
  const destinoAlm = (almacenes || []).find((a: any) => a.id === destinoId);

  const refreshPrinter = useCallback(async () => {
    if (!isNativePrinterAvailable()) { setPrinter(null); return; }
    await requestBluetoothPermission();
    setPrinter(await printerStatus());
  }, []);

  useEffect(() => { refreshPrinter(); }, [refreshPrinter]);

  // Al quedar la ruta armada, abrir la cámara automáticamente (sin teclado).
  // El teclado solo aparece si el usuario toca el cuadro de texto.
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
      if (!data) { show(`No encontrado: ${code}`, C.red); Vibration.vibrate(300); return; }
      const stockOrigen = data.stockPorAlmacen.find((s: any) => s.almacen_id === origenId)?.cantidad ?? 0;
      if (stockOrigen <= 0) {
        show(`Sin stock en ${origenAlm?.nombre || 'origen'}: ${data.sku_variant}`, C.red);
        Vibration.vibrate(300);
        return;
      }
      const existing = items.find(it => it.variante_id === data.id);
      if (existing) {
        if (existing.cantidad >= stockOrigen) {
          show(`Máximo stock en origen (${stockOrigen}): ${data.sku_variant}`, C.amber);
          Vibration.vibrate(300);
          return;
        }
        setItems(prev => prev.map(it => it.variante_id === data.id ? { ...it, cantidad: it.cantidad + 1 } : it));
        show(`+1 ${data.sku_variant} → ${existing.cantidad + 1}/${stockOrigen}`, C.blue);
        Vibration.vibrate(80);
      } else {
        setItems(prev => [...prev, {
          variante_id: data.id, sku_variant: data.sku_variant, codigo_barras: data.codigo_barras,
          modelo: data.producto_modelo || '—', marca: data.marca_nombre || '',
          categoria: data.categoria_nombre || '', subcategoria: data.subcategoria_nombre || '',
          fit: data.fit_nombre || '', genero: data.genero_nombre || '',
          color: data.color_nombre || '—', talla: data.talla_valor || '—',
          precio: Number(data.precio) || 0, sku_product: data.producto_sku || '',
          stock_origen: stockOrigen, cantidad: 1,
        }]);
        show(`+ ${data.sku_variant} (stock: ${stockOrigen})`, C.emerald);
        Vibration.vibrate(80);
      }
    } catch {
      show('Error al buscar', C.red);
    }
  }, [origenId, origenAlm, items]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    handleScan(data);
    setTimeout(() => setScanned(false), 1500);
  }, [scanned, handleScan]);

  const toggleCamera = useCallback(async () => {
    if (!cameraOpen && !permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) { Alert.alert('Cámara', 'Se necesita permiso de cámara para escanear'); return; }
    }
    setCameraOpen(v => !v);
    setScanned(false);
  }, [cameraOpen, permission, requestPermission]);

  const updateCant = (id: string, delta: number) =>
    setItems(prev => prev.map(it => it.variante_id === id
      ? { ...it, cantidad: Math.max(1, Math.min(it.cantidad + delta, it.stock_origen)) }
      : it));
  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.variante_id !== id));

  const buildJobs = (list: TrasladoItem[]): LabelJob[] => (plantilla || []).length === 0 ? [] : list.map(it => ({
    template: plantilla!,
    info: {
      producto: { marca: it.marca, modelo: it.modelo, sku_product: it.sku_product, categoria: it.categoria, subcategoria: it.subcategoria, fit: it.fit, genero: it.genero },
      variante: { sku_variant: it.sku_variant, codigo_barras: it.codigo_barras, color: it.color, talla: it.talla, precio: it.precio },
    },
    copies: it.cantidad,
  }));

  const imprimirEtiquetas = useCallback(async (list: TrasladoItem[]) => {
    if (!list.length) return;
    if (!isNativePrinterAvailable()) {
      setPrintMsg({ text: 'Impresión no disponible en Expo Go (usa el APK/dev build)', ok: false });
      return;
    }
    if (!(plantilla || []).length) {
      setPrintMsg({ text: 'Sin plantilla de etiqueta (configúrala en el ERP)', ok: false });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      const permOk = await requestBluetoothPermission();
      if (!permOk) throw new Error('Permiso de Bluetooth denegado');
      const b64 = await rendererRef.current!.render(buildJobs(list));
      const res = await printBase64(b64);
      if (!res.ok) throw new Error(res.error || 'Error al imprimir');
      setPrintMsg({ text: `Impreso en ${res.printer ?? 'impresora'}`, ok: true });
      setPrinter(await printerStatus());
    } catch (e: any) {
      setPrintMsg({ text: e?.message || 'Error al imprimir', ok: false });
    } finally {
      setPrinting(false);
    }
  }, [plantilla]);

  const ejecutar = async () => {
    if (!rutaLista || !items.length || !user || executing) return;
    setExecuting(true);
    try {
      if (user.rol === 'almacenero') {
        await railwayPost('/api/operaciones/encolar/', {
          tipo_operacion: 'TRASLADO',
          items: items.map(it => ({
            codigo_barras: it.codigo_barras, cantidad: it.cantidad,
            almacen_origen_id: origenId, almacen_destino_id: destinoId,
          })),
          usuario_id: user.id, usuario_nombre: user.username, rol: user.rol,
        });
        setResultado({ tipo: 'pendiente', total: totalPrendas });
      } else {
        let procesados = 0;
        const errores: { codigo_barras: string; error: string }[] = [];
        for (const it of items) {
          try {
            await railwayPost('/api/operaciones/registrar/', {
              tipo_operacion: 'TRASLADO', codigo_barras: it.codigo_barras,
              almacen_origen_id: origenId, almacen_destino_id: destinoId,
              cantidad: it.cantidad, notas: 'Traslado desde app móvil', usuario_id: user.id,
            });
            procesados++;
          } catch (e: any) {
            errores.push({ codigo_barras: it.codigo_barras, error: e?.message || 'Error' });
          }
        }
        setResultado({ tipo: 'directo', procesados, errores });
        syncDatabase().catch(() => {});
      }
      const snap = [...items];
      setSnapshot(snap);
      setItems([]);
      Vibration.vibrate([0, 80, 60, 80]);
      if (imprimir) imprimirEtiquetas(snap);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Error al realizar el traslado');
    } finally {
      setExecuting(false);
    }
  };

  const nuevoTraslado = () => {
    setResultado(null);
    setSnapshot([]);
    setPrintMsg(null);
    setOrigenId(null);
    setDestinoId(null);
  };

  // ─── Render ───

  if (resultado) {
    const okTotal = resultado.tipo === 'pendiente' ? resultado.total
      : snapshot.reduce((s, it) => s + it.cantidad, 0);
    const hayErrores = resultado.tipo === 'directo' && resultado.errores.length > 0;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          <View style={{ backgroundColor: hayErrores ? C.amber + '18' : C.emerald + '18', borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: hayErrores ? C.amber : C.emerald }}>
            {hayErrores ? <AlertTriangle size={44} color={C.amber} strokeWidth={1.8} /> : <CheckCircle size={44} color={C.emerald} strokeWidth={1.8} />}
            <Text style={{ color: C.white, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>
              {resultado.tipo === 'pendiente' ? 'ENVIADO PARA APROBACIÓN' : hayErrores ? 'TRASLADO CON ERRORES' : 'TRASLADO REALIZADO'}
            </Text>
            <Text style={{ color: C.textSecondary, fontSize: 13, textAlign: 'center' }}>
              {origenAlm?.nombre} → {destinoAlm?.nombre} · {okTotal} prendas
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
              {resultado.errores.map(er => (
                <Text key={er.codigo_barras} style={{ color: C.textSecondary, fontSize: 11 }} numberOfLines={2}>
                  {er.codigo_barras}: {er.error}
                </Text>
              ))}
            </View>
          )}

          {printMsg && (
            <View style={{ backgroundColor: printMsg.ok ? C.emeraldSurface : C.redSurface, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: printMsg.ok ? C.emerald : C.red }}>
              <Printer size={16} color={printMsg.ok ? C.emerald : C.red} />
              <Text style={{ color: printMsg.ok ? C.emerald : C.red, fontSize: 13, fontWeight: '600', flex: 1 }}>{printMsg.text}</Text>
            </View>
          )}

          <Pressable onPress={() => imprimirEtiquetas(snapshot)} disabled={printing}
            style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.blue, opacity: printing ? 0.6 : 1 }}>
            {printing ? <ActivityIndicator size="small" color={C.blue} /> : <Printer size={16} color={C.blue} />}
            <Text style={{ color: C.blue, fontSize: 14, fontWeight: '700' }}>
              {printing ? 'Imprimiendo...' : printMsg?.ok ? 'Reimprimir etiquetas' : 'Imprimir etiquetas'}
            </Text>
          </Pressable>

          <Pressable onPress={nuevoTraslado}
            style={{ backgroundColor: C.accent, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <ArrowLeftRight size={18} color={C.white} />
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>Nuevo traslado</Text>
          </Pressable>
        </ScrollView>
        <LabelRenderer ref={rendererRef} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">

        {/* ── Origen ── */}
        <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>ORIGEN</Text>
        <AlmacenPills almacenes={almacenes} selectedId={origenId}
          onSelect={(id) => { setOrigenId(id === origenId ? null : id); if (id === destinoId) setDestinoId(null); }} />

        {/* ── Destino ── */}
        {origenId && (
          <>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>DESTINO</Text>
            <AlmacenPills almacenes={almacenes} excludeId={origenId} selectedId={destinoId}
              onSelect={(id) => setDestinoId(id === destinoId ? null : id)} />
          </>
        )}

        {/* ── Ruta ── */}
        {rutaLista && (
          <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border }}>
            <AlmacenSwatch almacen={origenAlm} width={10} height={36} radius={5} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.amberLight, fontSize: 10, fontWeight: '700' }}>ORIGEN</Text>
              <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{origenAlm?.nombre}</Text>
            </View>
            <ArrowRight size={18} color={C.textMuted} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: C.indigoLight, fontSize: 10, fontWeight: '700' }}>DESTINO</Text>
              <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{destinoAlm?.nombre}</Text>
            </View>
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
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>PRENDAS A TRASLADAR</Text>
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
                      {it.fit ? `${it.fit} · ` : ''}{it.color} · T{it.talla} · stock {it.stock_origen}
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
            <ArrowLeftRight size={32} color={C.textMuted} strokeWidth={1.5} />
            <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Escanea las prendas que vas a trasladar{'\n'}de {origenAlm?.nombre} a {destinoAlm?.nombre}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Footer fijo ── */}
      {items.length > 0 && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={refreshPrinter} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Bluetooth size={14} color={printer?.found ? C.emerald : C.textMuted} />
              <Text style={{ color: printer?.found ? C.emerald : C.textMuted, fontSize: 11, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                {!isNativePrinterAvailable() ? 'Impresora: requiere APK nativo'
                  : !printer?.bluetoothOn ? 'Bluetooth apagado'
                    : printer?.found ? `Impresora: ${printer.name || 'lista'}`
                      : 'Sin impresora emparejada'}
              </Text>
              <RefreshCw size={12} color={C.textMuted} />
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: C.textSecondary, fontSize: 12, fontWeight: '600' }}>Imprimir etiquetas</Text>
              <Switch value={imprimir} onValueChange={setImprimir}
                trackColor={{ false: C.border, true: C.accent }} thumbColor={C.white} />
            </View>
          </View>
          <Pressable onPress={ejecutar} disabled={executing}
            style={{ backgroundColor: executing ? C.accentSurface : C.emerald, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: executing ? 0.7 : 1 }}>
            {executing ? <ActivityIndicator size="small" color={C.white} /> : <Send size={18} color={C.white} />}
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '800' }}>
              {executing ? 'Procesando...'
                : user?.rol === 'almacenero'
                  ? `Enviar para aprobación · ${totalPrendas} prendas`
                  : `Ejecutar traslado · ${totalPrendas} prendas`}
            </Text>
          </Pressable>
        </View>
      )}

      <LabelRenderer ref={rendererRef} />
    </View>
  );
}
