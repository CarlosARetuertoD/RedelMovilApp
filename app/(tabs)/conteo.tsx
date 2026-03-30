import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, FlatList, Alert, ActivityIndicator, TextInput, Modal } from 'react-native';
import { Play, RotateCcw, CheckCircle, AlertTriangle, Minus, Plus, X, Undo2, Eye, Clipboard, Send, Pause, ChevronDown } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import useConteoStore from '../../store/conteoStore';
import useAuthStore from '../../store/authStore';
import { fetchAlmacenes, fetchVariantesConStock, fetchTopMarcasYFits, fetchFilterOptions, escanearProducto, crearSolicitud } from '../../lib/queries';
import { C } from '../../lib/colors';
import type { ConteoFila } from '../../store/conteoStore';

const SHORTCUTS = [
  { label: 'Jean Dama', categoria: 'Pantalon', subcategoria: 'Jean', genero: 'Dama' },
  { label: 'Jean Varón', categoria: 'Pantalon', subcategoria: 'Jean', genero: 'Varon' },
  { label: 'Drill Dama', categoria: 'Pantalon', subcategoria: 'Drill', genero: 'Dama' },
  { label: 'Drill Varón', categoria: 'Pantalon', subcategoria: 'Drill', genero: 'Varon' },
];

export default function ConteoScreen() {
  const store = useConteoStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!checked) {
      setChecked(true);
      store.restaurarBorrador().then(found => {
        if (found && store.matriz.length > 0) {
          Alert.alert('Conteo pendiente', `Tienes un conteo en ${store.almacenNombre}`, [
            { text: 'Descartar', style: 'destructive', onPress: () => store.nuevoConteo() },
            { text: 'Continuar' },
          ]);
        }
      });
    }
  }, []);

  if (store.fase === 'preparacion') return <Preparacion />;
  if (store.fase === 'conteo') return <Conteo />;
  return <Resultado />;
}

// ═══ FASE 1 — Preparación con preview en vivo ═══
function Preparacion() {
  const store = useConteoStore();
  const [categoria, setCategoria] = useState('');
  const [subcategoria, setSubcategoria] = useState('');
  const [genero, setGenero] = useState('');
  const [marca, setMarca] = useState('');
  const [fit, setFit] = useState('');
  const [talla, setTalla] = useState('');
  const [modalField, setModalField] = useState<string | null>(null);

  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes });
  const { data: filterOptions } = useQuery({ queryKey: ['filterOptions'], queryFn: fetchFilterOptions, staleTime: 60000 });

  const hasGrupo = !!(categoria || subcategoria || genero);
  const { data: topData } = useQuery({
    queryKey: ['topMarcasFitsConteo', categoria, subcategoria, genero, marca],
    queryFn: () => fetchTopMarcasYFits({ categoria: categoria || undefined, subcategoria: subcategoria || undefined, genero: genero || undefined, marca: marca || undefined }),
    enabled: hasGrupo,
    staleTime: 60000,
  });

  // Preview en vivo: se actualiza con cada cambio de filtro
  const canPreview = !!(store.almacenId && hasGrupo);
  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ['conteoPreview', store.almacenId, categoria, subcategoria, genero, marca, fit, talla],
    queryFn: () => fetchVariantesConStock({
      almacen_id: store.almacenId,
      categoria: categoria || undefined,
      subcategoria: subcategoria || undefined,
      genero: genero || undefined,
      marca: marca || undefined,
      fit: fit || undefined,
      talla: talla || undefined,
      limit: 5000,
    }),
    enabled: canPreview,
    staleTime: 30000,
  });

  const previewFilas = useMemo(() => {
    if (!previewData) return [];
    return previewData.variantes
      .map((v: any) => {
        const st = previewData.stockMap.get(v.id);
        const stock = st?.total || 0;
        return {
          variante_id: v.id, sku_variant: v.sku_variant, codigo_barras: v.codigo_barras,
          descripcion: `${v.marca_nombre} · ${v.fit_nombre} · ${v.color_nombre} · T${v.talla_valor}`,
          color: v.color_nombre, talla: v.talla_valor, stockSistema: stock,
          esperado: stock, contado: 0,
        } as ConteoFila;
      })
      .filter((f: ConteoFila) => f.stockSistema > 0);
  }, [previewData]);

  const previewTotal = previewFilas.reduce((s, f) => s + f.esperado, 0);

  const topMarcas = topData?.marcas.slice(0, 5) || [];
  const topFits = topData?.fits.slice(0, 5) || [];

  const applyShortcut = (s: typeof SHORTCUTS[0]) => {
    setCategoria(s.categoria); setSubcategoria(s.subcategoria); setGenero(s.genero);
    setMarca(''); setFit(''); setTalla('');
  };

  const clearGrupo = () => {
    setCategoria(''); setSubcategoria(''); setGenero('');
    setMarca(''); setFit(''); setTalla('');
  };

  const empezarConteo = () => {
    if (!previewFilas.length) return;
    store.setFiltrosGrupo({ fits: fit ? [fit] : [], marcas: marca ? [marca] : [], tallas: talla ? [talla] : [] });
    store.cargarMatriz(previewFilas);
  };

  // Tallas inteligentes
  const cat = categoria.toLowerCase();
  const usarNumericas = cat === 'pantalon' || cat === 'bermuda';
  const usarAlfa = cat === 'casaca';
  const tallaPrimaria = usarNumericas ? (filterOptions as any)?.tallasNumericas
    : usarAlfa ? (filterOptions as any)?.tallasAlfanumericas : filterOptions?.talla;
  const tallaSecundaria = usarNumericas ? (filterOptions as any)?.tallasAlfanumericas
    : usarAlfa ? (filterOptions as any)?.tallasNumericas : null;

  const modalOptions = modalField === 'marca' ? filterOptions?.marca
    : modalField === 'fit' ? filterOptions?.fit
    : modalField === 'categoria' ? filterOptions?.categoria
    : modalField === 'subcategoria' ? filterOptions?.subcategoria
    : modalField === 'genero' ? filterOptions?.genero : [];

  const modalLabel = modalField === 'marca' ? 'Marca' : modalField === 'fit' ? 'Fit'
    : modalField === 'categoria' ? 'Categoría' : modalField === 'subcategoria' ? 'Subcategoría'
    : modalField === 'genero' ? 'Género' : '';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 100 }}>
        {/* Almacén */}
        <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700' }}>ALMACÉN</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(almacenes || []).map((a: any) => {
            const sel = a.id === store.almacenId;
            return (
              <Pressable key={a.id} onPress={() => store.setAlmacen(a.id, a.nombre)}
                style={{ backgroundColor: sel ? C.accentSurface : C.card, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: sel ? C.accent : C.border }}>
                <Text style={{ color: sel ? C.accent : C.textPrimary, fontSize: 14, fontWeight: '700' }}>{a.nombre}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {store.almacenId && !hasGrupo && (
          <>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', marginTop: 4 }}>PANTALÓN</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SHORTCUTS.map(s => (
                <Pressable key={s.label} onPress={() => applyShortcut(s)}
                  style={{ flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setModalField('categoria')}
              style={{ padding: 14, backgroundColor: C.card, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.accent }}>
              <Text style={{ color: C.accent, fontSize: 14, fontWeight: '600' }}>Otra categoría...</Text>
            </Pressable>
          </>
        )}

        {store.almacenId && hasGrupo && (
          <>
            {/* Chips activos */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5, flex: 1 }}>
                {categoria ? <PillChip label={categoria} color={C.accent} onRemove={() => { setCategoria(''); setSubcategoria(''); setGenero(''); setMarca(''); setFit(''); }} /> : null}
                {subcategoria ? <PillChip label={subcategoria} color={C.accent} onRemove={() => setSubcategoria('')} /> : null}
                {genero ? <PillChip label={genero} color={C.accent} onRemove={() => setGenero('')} /> : null}
                {marca ? <PillChip label={marca} color={C.blue} onRemove={() => setMarca('')} /> : null}
                {fit ? <PillChip label={fit} color={C.violet} onRemove={() => setFit('')} /> : null}
                {talla ? <PillChip label={`T${talla}`} color={C.cyan} onRemove={() => setTalla('')} /> : null}
              </ScrollView>
              <Pressable onPress={clearGrupo}
                style={{ backgroundColor: C.redSurface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.red }}>
                <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
              </Pressable>
            </View>

            {/* Cascada subcategoría */}
            {categoria && !subcategoria && filterOptions && (
              <InlinePicker label="SUBCATEGORÍA" color={C.accent} options={filterOptions.subcategoria}
                onSelect={setSubcategoria} onShowAll={() => setModalField('subcategoria')} />
            )}

            {/* Cascada género */}
            {categoria && subcategoria && !genero && filterOptions && (
              <InlinePicker label="GÉNERO" color={C.accent} options={filterOptions.genero}
                onSelect={setGenero} onShowAll={() => setModalField('genero')} />
            )}

            {/* Marca */}
            {!marca && topMarcas.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: C.blue, fontSize: 13, fontWeight: '800' }}>MARCA</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {topMarcas.map(m => (
                    <Pressable key={m.nombre} onPress={() => setMarca(m.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.blue + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700' }}>{m.nombre}</Text>
                      <Text style={{ color: C.textMuted, fontSize: 10 }}>{m.count} modelos</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalField('marca')}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.blue, justifyContent: 'center' }}>
                    <Text style={{ color: C.blue, fontSize: 13, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}

            {/* Fit */}
            {!fit && topFits.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: C.violet, fontSize: 13, fontWeight: '800' }}>FIT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {topFits.map(f => (
                    <Pressable key={f.nombre} onPress={() => setFit(f.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.violet + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700' }}>{f.nombre}</Text>
                      <Text style={{ color: C.textMuted, fontSize: 10 }}>{f.count} modelos</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalField('fit')}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.violet, justifyContent: 'center' }}>
                    <Text style={{ color: C.violet, fontSize: 13, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}

            {/* Talla */}
            {filterOptions && (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '800' }}>TALLA {talla ? '' : '(opcional)'}</Text>
                  {talla ? <Pressable onPress={() => setTalla('')}><Text style={{ color: C.textMuted, fontSize: 11 }}>Cambiar</Text></Pressable> : null}
                </View>
                {!talla ? (
                  <View style={{ gap: 6 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                      {(tallaPrimaria || []).map((t: string) => (
                        <Pressable key={t} onPress={() => setTalla(t)}
                          style={{ backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.cyan + '40', minWidth: 44, alignItems: 'center' }}>
                          <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{t}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    {tallaSecundaria && tallaSecundaria.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                        {tallaSecundaria.map((t: string) => (
                          <Pressable key={t} onPress={() => setTalla(t)}
                            style={{ backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border, minWidth: 44, alignItems: 'center' }}>
                            <Text style={{ color: C.textMuted, fontSize: 14, fontWeight: '600' }}>{t}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                ) : (
                  <View style={{ backgroundColor: C.cyanSurface, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: C.cyan, alignSelf: 'flex-start' }}>
                    <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '800' }}>{talla}</Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}

        {/* Preview en vivo */}
        {canPreview && (
          <View style={{ gap: 8, marginTop: 4 }}>
            {previewLoading && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={{ color: C.textMuted, fontSize: 12 }}>Buscando...</Text>
              </View>
            )}

            {!previewLoading && previewFilas.length > 0 && (
              <>
                <View style={{ backgroundColor: C.emeraldSurface, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.emerald }}>
                  <View>
                    <Text style={{ color: C.emerald, fontSize: 16, fontWeight: '800' }}>{previewFilas.length} variantes · {previewTotal} prendas</Text>
                    <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>en {store.almacenNombre}</Text>
                  </View>
                </View>

                {previewFilas.slice(0, 15).map(f => (
                  <View key={f.variante_id} style={{ backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: C.textPrimary, fontSize: 11 }} numberOfLines={1}>{f.descripcion}</Text>
                    <Text style={{ color: C.cyan, fontSize: 14, fontWeight: '700', minWidth: 28, textAlign: 'right' }}>{f.esperado}</Text>
                  </View>
                ))}
                {previewFilas.length > 15 && (
                  <Text style={{ color: C.textMuted, fontSize: 11, textAlign: 'center' }}>+{previewFilas.length - 15} más</Text>
                )}
              </>
            )}

            {!previewLoading && previewFilas.length === 0 && previewData && (
              <View style={{ backgroundColor: C.amberSurface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.amber }}>
                <Text style={{ color: C.amber, fontSize: 13, fontWeight: '700' }}>Sin stock para estos filtros</Text>
                <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
                  {previewData.variantes.length} variantes encontradas pero sin existencias en {store.almacenNombre}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Botón fijo abajo */}
      {previewFilas.length > 0 && (
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg }}>
          <Pressable onPress={empezarConteo}
            style={{ backgroundColor: C.emerald, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <Play size={20} color={C.white} />
            <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>Empezar conteo ({previewTotal} prendas)</Text>
          </Pressable>
        </View>
      )}

      {/* Modal */}
      <FilterModal visible={!!modalField} label={modalLabel} options={modalOptions || []}
        selected={modalField === 'marca' ? marca : modalField === 'fit' ? fit : modalField === 'categoria' ? categoria : modalField === 'subcategoria' ? subcategoria : modalField === 'genero' ? genero : ''}
        onSelect={v => {
          if (modalField === 'marca') setMarca(v);
          else if (modalField === 'fit') setFit(v);
          else if (modalField === 'categoria') { setCategoria(v); setSubcategoria(''); setGenero(''); setMarca(''); setFit(''); }
          else if (modalField === 'subcategoria') setSubcategoria(v);
          else if (modalField === 'genero') setGenero(v);
          setModalField(null);
        }}
        onClose={() => setModalField(null)} />
    </View>
  );
}

// ═══ FASE 2 — Conteo ═══
function Conteo() {
  const store = useConteoStore();
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ text: string; color: string } | null>(null);
  const [inputCode, setInputCode] = useState('');

  const stats = useMemo(() => {
    const completos = store.matriz.filter(f => f.contado === f.esperado && f.esperado > 0).length;
    const pendientes = store.matriz.filter(f => f.contado < f.esperado).length;
    const excedentes = store.matriz.filter(f => f.contado > f.esperado).length;
    const totalC = store.matriz.reduce((s, f) => s + f.contado, 0) + store.sobrantes.reduce((s, f) => s + f.contado, 0);
    const totalE = store.matriz.reduce((s, f) => s + f.esperado, 0);
    return { completos, pendientes, excedentes, sobrantes: store.sobrantes.length, totalC, totalE };
  }, [store.matriz, store.sobrantes]);

  const show = (text: string, color: string) => { setToast({ text, color }); setTimeout(() => setToast(null), 2000); };

  const handleScan = useCallback(async (code: string) => {
    if (scanning || !code.trim()) return;
    setScanning(true);
    const cb = code.trim().padStart(13, '0');
    const em = store.matriz.find(f => f.codigo_barras === cb);
    const es = store.sobrantes.find(f => f.codigo_barras === cb);

    let info: any;
    if (!em && !es) {
      try { const r = await escanearProducto(code); if (r) info = { variante_id: r.id, sku_variant: r.sku_variant, descripcion: `${r.marca_nombre} · ${r.fit_nombre} · ${r.color_nombre} · T${r.talla_valor}`, color: r.color_nombre, talla: r.talla_valor }; } catch {}
    }

    const res = store.escanear(cb, info);
    const fila = store.matriz.find(f => f.codigo_barras === cb);
    if (res === 'ok') show(`${fila?.descripcion?.slice(0, 35)} → ${fila?.contado}/${fila?.esperado}`, C.blue);
    else if (res === 'completo') show(`${fila?.descripcion?.slice(0, 35)} COMPLETO`, C.emerald);
    else if (res === 'excede') show(`${fila?.descripcion?.slice(0, 35)} EXCEDE`, C.amber);
    else show(`SOBRANTE: ${info?.descripcion?.slice(0, 35) || cb}`, C.red);

    setScanning(false);
    setInputCode('');
  }, [scanning, store]);

  const prog = stats.totalE > 0 ? stats.totalC / stats.totalE : 0;

  const rows = useMemo(() => [
    ...store.sobrantes.map(f => ({ ...f, t: 'sob' })),
    ...store.matriz.filter(f => f.contado > f.esperado).map(f => ({ ...f, t: 'exc' })),
    ...store.matriz.filter(f => f.contado < f.esperado && f.contado > 0).map(f => ({ ...f, t: 'par' })),
    ...store.matriz.filter(f => f.contado === 0).map(f => ({ ...f, t: 'pen' })),
    ...store.matriz.filter(f => f.contado === f.esperado && f.esperado > 0).map(f => ({ ...f, t: 'ok' })),
  ], [store.matriz, store.sobrantes]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ backgroundColor: C.emeraldSurface, padding: 10, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.emerald }} />
        <Text style={{ color: C.emerald, fontSize: 13, fontWeight: '700' }}>CONTEO — {store.almacenNombre}</Text>
      </View>

      <View style={{ padding: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{stats.totalC}/{stats.totalE}</Text>
          <Text style={{ color: C.textMuted, fontSize: 12 }}>{Math.round(prog * 100)}%</Text>
        </View>
        <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2 }}>
          <View style={{ height: 4, backgroundColor: C.emerald, borderRadius: 2, width: `${Math.min(100, prog * 100)}%` as any }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <StatPill label="OK" n={stats.completos} c={C.emerald} /><StatPill label="Pend" n={stats.pendientes} c={C.textMuted} />
          <StatPill label="Exc" n={stats.excedentes} c={C.amber} /><StatPill label="Sob" n={stats.sobrantes} c={C.red} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 12 }}>
        <View style={{ backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.accent, padding: 10, flexDirection: 'row', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.emerald, marginTop: 6 }} />
          <TextInput value={inputCode} onChangeText={setInputCode} onSubmitEditing={() => handleScan(inputCode)}
            placeholder="Escanea con pistola..." placeholderTextColor={C.textMuted} autoCapitalize="none" blurOnSubmit={false} returnKeyType="go"
            style={{ flex: 1, color: C.white, fontSize: 16, padding: 0 }} />
        </View>
      </View>

      {toast && <View style={{ marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: toast.color + '22', borderWidth: 1, borderColor: toast.color }}>
        <Text style={{ color: toast.color, fontSize: 13, fontWeight: '700', textAlign: 'center' }}>{toast.text}</Text></View>}

      <FlatList data={rows} keyExtractor={(item, i) => item.variante_id + i} style={{ flex: 1, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
        renderItem={({ item }: any) => {
          const bg = item.t === 'ok' ? C.emeraldSurface : item.t === 'exc' ? C.amberSurface : item.t === 'sob' ? C.redSurface : C.transparent;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, backgroundColor: bg, borderRadius: 6, marginBottom: 2 }}>
              <Text style={{ flex: 1, color: C.textPrimary, fontSize: 11 }} numberOfLines={1}>{item.descripcion}</Text>
              <Text style={{ color: C.textMuted, fontSize: 12, width: 28, textAlign: 'center' }}>{item.esperado}</Text>
              <Text style={{ color: C.white, fontSize: 14, fontWeight: '800', width: 28, textAlign: 'center' }}>{item.contado}</Text>
              <View style={{ width: 55, alignItems: 'flex-end' }}>
                {item.t === 'ok' && <Text style={{ color: C.emerald, fontSize: 10, fontWeight: '700' }}>OK</Text>}
                {item.t === 'exc' && <Text style={{ color: C.amber, fontSize: 10, fontWeight: '700' }}>+{item.contado - item.esperado}</Text>}
                {item.t === 'sob' && <Text style={{ color: C.red, fontSize: 10, fontWeight: '700' }}>SOBRANTE</Text>}
                {item.t === 'par' && <Text style={{ color: C.textMuted, fontSize: 10 }}>-{item.esperado - item.contado}</Text>}
                {item.t === 'pen' && <Text style={{ color: C.textMuted, fontSize: 10 }}>—</Text>}
              </View>
            </View>);
        }} />

      <View style={{ flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: C.border }}>
        <Pressable onPress={() => store.deshacerUltimo()} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 4, padding: 12, backgroundColor: C.card, borderRadius: 10 }}>
          <Undo2 size={16} color={C.textMuted} /><Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '600' }}>Deshacer</Text></Pressable>
        <Pressable onPress={() => { store.guardarBorrador(); store.setFase('preparacion'); }} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 4, padding: 12, backgroundColor: C.card, borderRadius: 10 }}>
          <Pause size={16} color={C.amber} /><Text style={{ color: C.amber, fontSize: 12, fontWeight: '600' }}>Pausar</Text></Pressable>
        <Pressable onPress={() => store.setFase('resultado')} style={{ flex: 2, flexDirection: 'row', justifyContent: 'center', gap: 4, padding: 12, backgroundColor: C.accent, borderRadius: 10 }}>
          <Eye size={16} color={C.white} /><Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>Resultados</Text></Pressable>
      </View>
    </View>
  );
}

// ═══ FASE 3 — Resultado ═══
function Resultado() {
  const store = useConteoStore();
  const user = useAuthStore(s => s.user);
  const [enviando, setEnviando] = useState(false);

  const s = useMemo(() => {
    const totalE = store.matriz.reduce((a, f) => a + f.esperado, 0);
    const totalC = store.matriz.reduce((a, f) => a + f.contado, 0) + store.sobrantes.reduce((a, f) => a + f.contado, 0);
    const faltantes = store.matriz.filter(f => f.contado < f.esperado);
    const completos = store.matriz.filter(f => f.contado === f.esperado && f.esperado > 0);
    const excedentes = store.matriz.filter(f => f.contado > f.esperado);
    const cuadra = !faltantes.length && !store.sobrantes.length && !excedentes.length;
    return { totalE, totalC, faltantes, completos, excedentes, cuadra, diff: totalC - totalE };
  }, [store.matriz, store.sobrantes]);

  const exportar = () => {
    const l = [`CONTEO — ${store.almacenNombre}`, `${new Date().toLocaleDateString('es-PE')}`,
      `Esperado: ${s.totalE} | Contado: ${s.totalC} | Diff: ${s.diff >= 0 ? '+' : ''}${s.diff}`, ''];
    if (s.faltantes.length) { l.push(`FALTANTES (${s.faltantes.length}):`); s.faltantes.forEach(f => l.push(`  ${f.descripcion}: -${f.esperado - f.contado}`)); l.push(''); }
    if (s.excedentes.length) { l.push(`EXCEDENTES (${s.excedentes.length}):`); s.excedentes.forEach(f => l.push(`  ${f.descripcion}: +${f.contado - f.esperado}`)); l.push(''); }
    if (store.sobrantes.length) { l.push(`SOBRANTES (${store.sobrantes.length}):`); store.sobrantes.forEach(f => l.push(`  ${f.descripcion}: ${f.contado}`)); }
    Alert.alert('Resumen', l.join('\n'));
  };

  const enviar = async () => {
    if (!user) return;
    setEnviando(true);
    try {
      await crearSolicitud('ajuste_conteo', user.id, user.nombre, {
        almacen_id: store.almacenId, almacen_nombre: store.almacenNombre, grupo_filtros: store.filtrosGrupo,
        resumen: { total_esperado: s.totalE, total_contado: s.totalC, diferencia: s.diff },
        faltantes: s.faltantes.map(f => ({ variante_id: f.variante_id, sku_variant: f.sku_variant, esperado: f.esperado, contado: f.contado })),
        excedentes: s.excedentes.map(f => ({ variante_id: f.variante_id, sku_variant: f.sku_variant, esperado: f.esperado, contado: f.contado })),
        sobrantes: store.sobrantes.map(f => ({ variante_id: f.variante_id, sku_variant: f.sku_variant, contado: f.contado })),
      });
      Alert.alert('Enviado', 'Solicitud de ajuste enviada');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setEnviando(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 20, borderWidth: 2, borderColor: s.cuadra ? C.emerald : C.red, alignItems: 'center', gap: 8 }}>
        {s.cuadra ? <CheckCircle size={40} color={C.emerald} /> : <AlertTriangle size={40} color={C.red} />}
        <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{s.cuadra ? 'EL CONTEO CUADRA' : 'NO CUADRA'}</Text>
        <Text style={{ color: C.textSecondary, fontSize: 13 }}>Esperado: {s.totalE} · Contado: {s.totalC} · Diff: {s.diff >= 0 ? '+' : ''}{s.diff}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Mini label="OK" n={s.completos.length} c={C.emerald} /><Mini label="Faltan" n={s.faltantes.length} c={C.amber} />
        <Mini label="Exceden" n={s.excedentes.length} c={C.amber} /><Mini label="Sobran" n={store.sobrantes.length} c={C.red} />
      </View>

      {s.faltantes.length > 0 && <Section title={`Faltantes (${s.faltantes.length})`} color={C.amber}>
        {s.faltantes.map(f => <DetailRow key={f.variante_id} desc={f.descripcion} val={`-${f.esperado - f.contado}`} color={C.amber} />)}</Section>}
      {store.sobrantes.length > 0 && <Section title={`Sobrantes (${store.sobrantes.length})`} color={C.red}>
        {store.sobrantes.map(f => <DetailRow key={f.variante_id} desc={f.descripcion} val={`${f.contado}`} color={C.red} />)}</Section>}
      {s.excedentes.length > 0 && <Section title={`Excedentes (${s.excedentes.length})`} color={C.amber}>
        {s.excedentes.map(f => <DetailRow key={f.variante_id} desc={f.descripcion} val={`+${f.contado - f.esperado}`} color={C.amber} />)}</Section>}

      <ActionBtn icon={Play} label="Continuar escaneando" color={C.accent} onPress={() => store.setFase('conteo')} />
      <ActionBtn icon={RotateCcw} label="Reset contado" color={C.textMuted} onPress={() => store.resetContado()} />
      <ActionBtn icon={Clipboard} label="Ver resumen" color={C.blue} onPress={exportar} />
      {!s.cuadra && <ActionBtn icon={Send} label={enviando ? 'Enviando...' : 'Enviar solicitud ajuste'} color={C.white} bg={C.accent} onPress={enviar} disabled={enviando} />}
      <Pressable onPress={() => Alert.alert('Nuevo conteo', '¿Descartar todo?', [{ text: 'No' }, { text: 'Sí', style: 'destructive', onPress: () => store.nuevoConteo() }])} style={{ padding: 14, alignItems: 'center' }}>
        <Text style={{ color: C.red, fontSize: 13, fontWeight: '600' }}>Nuevo conteo</Text></Pressable>
    </ScrollView>
  );
}

// ═══ COMPONENTES ═══

function PillChip({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Pressable hitSlop={8} onPress={onRemove}><X size={12} color={color} /></Pressable>
    </View>
  );
}

function InlinePicker({ label, color, options, onSelect, onShowAll }: {
  label: string; color: string; options: string[]; onSelect: (v: string) => void; onShowAll: () => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color, fontSize: 13, fontWeight: '800' }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.slice(0, 8).map(o => (
          <Pressable key={o} onPress={() => onSelect(o)}
            style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: color + '40' }}>
            <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700' }}>{o}</Text>
          </Pressable>
        ))}
        {options.length > 8 && (
          <Pressable onPress={onShowAll}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: color, justifyContent: 'center' }}>
            <Text style={{ color, fontSize: 13, fontWeight: '700' }}>Ver todo</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function StatPill({ label, n, c }: { label: string; n: number; c: string }) {
  return <View style={{ flexDirection: 'row', gap: 4, backgroundColor: c + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
    <Text style={{ color: c, fontSize: 12, fontWeight: '800' }}>{n}</Text><Text style={{ color: c, fontSize: 10 }}>{label}</Text></View>;
}
function Mini({ label, n, c }: { label: string; n: number; c: string }) {
  return <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
    <Text style={{ color: c, fontSize: 20, fontWeight: '800' }}>{n}</Text><Text style={{ color: C.textMuted, fontSize: 9 }}>{label}</Text></View>;
}
function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: color }}>
    <Text style={{ color, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>{title}</Text>{children}</View>;
}
function DetailRow({ desc, val, color }: { desc: string; val: string; color: string }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
    <Text style={{ color: C.textPrimary, fontSize: 12, flex: 1 }} numberOfLines={1}>{desc}</Text>
    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{val}</Text></View>;
}
function ActionBtn({ icon: Icon, label, color, bg, onPress, disabled }: any) {
  return <Pressable onPress={onPress} disabled={disabled} style={{ backgroundColor: bg || C.card, borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
    <Icon size={16} color={color} /><Text style={{ color, fontSize: 14, fontWeight: '700' }}>{label}</Text></Pressable>;
}

function FilterModal({ visible, label, options, selected, onSelect, onClose }: {
  visible: boolean; label: string; options: string[]; selected: string;
  onSelect: (v: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search ? options.filter(o => o.toLowerCase().includes(search.toLowerCase())) : options;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ color: C.textPrimary, fontSize: 16, fontWeight: '700' }}>{label}</Text>
            <Pressable onPress={onClose} hitSlop={12}><X size={20} color={C.textMuted} /></Pressable>
          </View>
          {options.length > 8 && (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <TextInput value={search} onChangeText={setSearch} placeholder={`Buscar ${label.toLowerCase()}...`}
                placeholderTextColor={C.textMuted} autoCapitalize="none"
                style={{ backgroundColor: C.bg, borderRadius: 8, padding: 10, color: C.white, fontSize: 13, borderWidth: 1, borderColor: C.border }} />
            </View>
          )}
          <FlatList data={filtered} keyExtractor={item => item} style={{ maxHeight: 350 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onSelect(item); setSearch(''); }}
                style={{ padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: item === selected ? C.accentSurface : undefined }}>
                <Text style={{ color: item === selected ? C.accent : C.textPrimary, fontSize: 14, fontWeight: item === selected ? '700' : '400' }}>{item}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center', padding: 20 }}>Sin opciones</Text>}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
