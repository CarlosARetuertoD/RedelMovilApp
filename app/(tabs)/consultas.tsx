import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, ScrollView, Modal, Dimensions } from 'react-native';
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { fetchVariantesConStock, fetchFilterOptions, fetchAlmacenes, fetchTopMarcasYFits, parseSmartSearch } from '../../lib/queries';
import { C } from '../../lib/colors';

const SCREEN_W = Dimensions.get('window').width;

type AlmacenInfo = { color_hex?: string; patron?: string; color_secundario?: string };

function StripeBg({ color1, color2, w, h }: { color1: string; color2: string; w: number; h: number }) {
  const step = 18; const sw = 5;
  const lines = [];
  for (let x = -(h + step); x < w + h; x += step)
    lines.push(<Line key={x} x1={x} y1={0} x2={x + h} y2={h} stroke={color1} strokeWidth={sw} strokeOpacity={0.6} />);
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Rect x={0} y={0} width={w} height={h} fill={color2} fillOpacity={0.85} />
      {lines}
      <Rect x={0} y={0} width={w} height={h} fill="rgba(0,0,0,0.28)" />
    </Svg>
  );
}

// ─── Types ────────────────────────────────────────────

type Filtros = {
  search: string; categoria: string; subcategoria: string;
  marca: string; fit: string; genero: string; talla: string;
  almacen_id: string; almacen_nombre: string;
};

type StockDetail = { total: number; porAlmacen: { almacen_id: string; almacen_nombre: string; cantidad: number }[] };
type VarianteTalla = { talla: string; stock: StockDetail; codigo_barras: string; sku_variant: string };
type ColorGroup = { color_nombre: string; color_id: string; stockTotal: number; variantes: VarianteTalla[] };
type ProductGroup = {
  producto_id: string; producto_sku: string; producto_modelo: string;
  marca_nombre: string; fit_nombre: string; categoria_nombre: string;
  subcategoria_nombre: string; genero_nombre: string;
  precio: number; stockTotal: number; colores: ColorGroup[];
};

const EMPTY_FILTROS: Filtros = {
  search: '', categoria: '', subcategoria: '', marca: '', fit: '', genero: '', talla: '',
  almacen_id: '', almacen_nombre: '',
};

const SHORTCUTS = [
  { label: 'Jean Dama',      categoria: 'Pantalon', subcategoria: 'Jean',     genero: 'Dama'  },
  { label: 'Jean Varón',     categoria: 'Pantalon', subcategoria: 'Jean',     genero: 'Varon' },
  { label: 'Drill Dama',     categoria: 'Pantalon', subcategoria: 'Drill',    genero: 'Dama'  },
  { label: 'Drill Varón',    categoria: 'Pantalon', subcategoria: 'Drill',    genero: 'Varon' },
  { label: 'Corduroy Dama',  categoria: 'Pantalon', subcategoria: 'Corduroy', genero: 'Dama'  },
  { label: 'Corduroy Varón', categoria: 'Pantalon', subcategoria: 'Corduroy', genero: 'Varon' },
];

const FILTER_LABELS: Record<string, string> = {
  categoria: 'Categoría', subcategoria: 'Subcategoría', marca: 'Marca',
  fit: 'Fit', genero: 'Género', talla: 'Talla',
};

const MAX_PILLS = 5;

const PREFERRED_MARCAS = ['Pionier', 'Bronco', 'Metal', 'Lois', 'Norton', 'Vowh', 'Kansas'];

// ─── Grouping ─────────────────────────────────────────

function sortTallas(a: VarianteTalla, b: VarianteTalla) {
  const na = parseInt(a.talla), nb = parseInt(b.talla);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.talla.localeCompare(b.talla);
}


function groupByProducto(variantes: any[], stockMap: Map<string, StockDetail>): ProductGroup[] {
  const prodMap = new Map<string, ProductGroup>();
  const empty: StockDetail = { total: 0, porAlmacen: [] };

  for (const v of variantes) {
    let p = prodMap.get(v.producto_id);
    if (!p) {
      p = { producto_id: v.producto_id, producto_sku: v.producto_sku, producto_modelo: v.producto_modelo,
        marca_nombre: v.marca_nombre, fit_nombre: v.fit_nombre, categoria_nombre: v.categoria_nombre,
        subcategoria_nombre: v.subcategoria_nombre, genero_nombre: v.genero_nombre,
        precio: v.precio, stockTotal: 0, colores: [] };
      prodMap.set(v.producto_id, p);
    }
    const sd = stockMap.get(v.id) || empty;
    p.stockTotal += sd.total;
    let cg = p.colores.find(c => c.color_id === v.color_id);
    if (!cg) { cg = { color_nombre: v.color_nombre, color_id: v.color_id, stockTotal: 0, variantes: [] }; p.colores.push(cg); }
    cg.stockTotal += sd.total;
    cg.variantes.push({ talla: v.talla_valor, stock: sd, codigo_barras: v.codigo_barras, sku_variant: v.sku_variant });
  }

  for (const p of prodMap.values()) {
    for (const c of p.colores) { c.variantes.sort(sortTallas); }
    p.colores.sort((a, b) => b.stockTotal - a.stockTotal);
  }
  return Array.from(prodMap.values()).sort((a, b) => b.stockTotal - a.stockTotal);
}


// ─── Screen ───────────────────────────────────────────

function hexToRgbQ(hex: string) {
  const c = hex?.replace('#', '');
  if (!c || c.length < 6) return null;
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}
function textForBgC(hex: string) {
  const rgb = hexToRgbQ(hex);
  if (!rgb) return '#ffffff';
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.55 ? '#1a1a1a' : '#ffffff';
}

export default function ConsultasScreen() {
  const [filtros, setFiltros] = useState<Filtros>({ ...EMPTY_FILTROS });
  const [appliedFiltros, setAppliedFiltros] = useState<Filtros | null>(null);
  const [expandedProd, setExpandedProd] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState<string | null>(null);
  const searchRef = useRef<TextInput>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;

  const params = useLocalSearchParams<{ modelo?: string; producto_id?: string }>();
  useEffect(() => {
    if (!params.modelo && !params.producto_id) return;
    if (params.modelo) {
      const next = { ...EMPTY_FILTROS, search: params.modelo };
      setFiltros(next);
      setAppliedFiltros(next);
    }
    if (params.producto_id) {
      setExpandedProd(params.producto_id);
    }
  }, [params.modelo, params.producto_id]);

  const { data: filterOptions } = useQuery({ queryKey: ['filterOptions'], queryFn: fetchFilterOptions, staleTime: 60000 });
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes, staleTime: 60000 });

  const hasActiveFilters = !!(filtros.categoria || filtros.subcategoria || filtros.marca || filtros.fit || filtros.genero);
  const hasApplied = !!(appliedFiltros && (appliedFiltros.search || appliedFiltros.categoria || appliedFiltros.subcategoria || appliedFiltros.marca || appliedFiltros.fit || appliedFiltros.genero || appliedFiltros.almacen_id));

  // Top marcas/fits cascadas — habilitado con cualquier filtro contextual
  const { data: topData } = useQuery({
    queryKey: ['topMarcasFits', filtros.categoria, filtros.subcategoria, filtros.genero, filtros.marca],
    queryFn: () => fetchTopMarcasYFits({
      categoria: filtros.categoria || undefined,
      subcategoria: filtros.subcategoria || undefined,
      genero: filtros.genero || undefined,
      marca: filtros.marca || undefined,
    }),
    enabled: true,
    staleTime: 60000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['consulta', appliedFiltros],
    queryFn: () => fetchVariantesConStock({
      search: appliedFiltros!.search || undefined,
      categoria: appliedFiltros!.categoria || undefined,
      subcategoria: appliedFiltros!.subcategoria || undefined,
      marca: appliedFiltros!.marca || undefined,
      fit: appliedFiltros!.fit || undefined,
      genero: appliedFiltros!.genero || undefined,
      talla: appliedFiltros!.talla || undefined,
      almacen_id: appliedFiltros!.almacen_id || undefined,
      limit: 500,
    }),
    enabled: !!hasApplied,
  });

  const productos = useMemo(() => data ? groupByProducto(data.variantes, data.stockMap) : [], [data]);
  const stockGrandTotal = useMemo(() => productos.reduce((s, p) => s + p.stockTotal, 0), [productos]);

  const topMarcas = topData?.marcas.slice(0, MAX_PILLS) || [];
  const topFits   = topData?.fits.slice(0, MAX_PILLS)   || [];

  const displayMarcas = useMemo(() => {
    const pool: Array<{ nombre: string; count?: number }> = topMarcas.length > 0
      ? topMarcas
      : (filterOptions?.marca || []).map(m => ({ nombre: m }));
    const poolMap = new Map(pool.map(m => [m.nombre.toLowerCase(), m]));
    const preferred = PREFERRED_MARCAS
      .map(p => poolMap.get(p.toLowerCase()))
      .filter((m): m is { nombre: string; count?: number } => !!m);
    const prefSet = new Set(preferred.map(m => m.nombre.toLowerCase()));
    const rest = pool
      .filter(m => !prefSet.has(m.nombre.toLowerCase()))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 3);
    return [...preferred, ...rest];
  }, [topMarcas, filterOptions]);

  const displayFits: Array<{ nombre: string; count?: number }> = topFits.length > 0
    ? topFits
    : (filterOptions?.fit || []).slice(0, MAX_PILLS).map(f => ({ nombre: f }));

  const applySearch = useCallback((f: Filtros) => {
    setAppliedFiltros({ ...f }); setExpandedProd(null);
  }, []);

  const onSearchChange = useCallback((v: string) => {
    setFiltros(prev => ({ ...prev, search: v }));
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (v.trim().length < 2) return;
    searchTimerRef.current = setTimeout(() => {
      const next = { ...filtrosRef.current, search: v };
      setAppliedFiltros(next);
      setExpandedProd(null);
    }, 400);
  }, []);

  const updateFilter = useCallback((key: string, value: string, autoApply = true) => {
    setFiltros(prev => {
      const next = { ...prev, [key]: value };
      if (autoApply && key !== 'search') setTimeout(() => applySearch(next), 0);
      return next;
    });
  }, [applySearch]);

  const applyShortcut = useCallback((s: typeof SHORTCUTS[0]) => {
    const next = { ...filtrosRef.current, search: '', categoria: s.categoria, subcategoria: s.subcategoria, genero: s.genero };
    setFiltros(next);
    applySearch(next);
  }, [applySearch]);

  const doSmartSearch = useCallback(async () => {
    const text = filtros.search.trim();
    if (!text) return;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const parsed = await parseSmartSearch(text);
      const next: Filtros = { ...EMPTY_FILTROS };
      if (parsed.marca) next.marca = parsed.marca;
      if (parsed.fit) next.fit = parsed.fit;
      if (parsed.categoria) next.categoria = parsed.categoria;
      if (parsed.subcategoria) next.subcategoria = parsed.subcategoria;
      if (parsed.genero) next.genero = parsed.genero;
      if (parsed.talla) next.talla = parsed.talla;
      if (parsed.search) next.search = parsed.search;
      next.almacen_id = filtros.almacen_id;
      next.almacen_nombre = filtros.almacen_nombre;
      setFiltros(next);
      applySearch(next);
    } else {
      const trimmed = { ...filtros, search: text };
      setFiltros(trimmed);
      applySearch(trimmed);
    }
  }, [filtros, applySearch]);

  const setAlmacen = useCallback((id: string, nombre: string) => {
    setFiltros(prev => {
      const next = { ...prev, almacen_id: id, almacen_nombre: nombre };
      if (appliedFiltros) setTimeout(() => setAppliedFiltros({ ...next }), 0);
      return next;
    });
  }, [appliedFiltros]);

  const clearAll = useCallback(() => {
    setFiltros({ ...EMPTY_FILTROS }); setAppliedFiltros(null); setExpandedProd(null);
  }, []);

  const clearCategoria = useCallback(() => {
    setFiltros(prev => {
      const next = { ...prev, categoria: '', subcategoria: '', genero: '' };
      setTimeout(() => applySearch(next), 0);
      return next;
    });
  }, [applySearch]);

  const activeShortcut = SHORTCUTS.find(s =>
    s.categoria === filtros.categoria && s.subcategoria === filtros.subcategoria && s.genero === filtros.genero
  );

  const almacenColorMap = useMemo(() => {
    const m = new Map<string, AlmacenInfo>();
    for (const a of (almacenes || [])) m.set(a.id, { color_hex: a.color_hex, patron: a.patron, color_secundario: a.color_secundario });
    return m;
  }, [almacenes]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>

      {/* ─── Panel fijo superior ─── */}
      <View style={{ paddingTop: 10, paddingHorizontal: 12, paddingBottom: 6, gap: 7 }}>

        {/* Search bar */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput ref={searchRef} value={filtros.search}
            onChangeText={onSearchChange} onSubmitEditing={doSmartSearch}
            placeholder="pionier pitillo 30 o escribe lo que sea..."
            placeholderTextColor={C.textMuted} autoCapitalize="none" returnKeyType="search"
            style={{ flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: C.white, fontSize: 14, borderWidth: 1, borderColor: C.border }} />
          <Pressable onPress={doSmartSearch} style={{ backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' }}>
            <Search size={20} color={C.white} />
          </Pressable>
        </View>

        {/* Pills de almacén — siempre visibles */}
        {almacenes && almacenes.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
            <Pressable onPress={() => setAlmacen('', '')}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                backgroundColor: !filtros.almacen_id ? C.accent : C.card,
                borderWidth: 1, borderColor: !filtros.almacen_id ? C.accent : C.border }}>
              <Text style={{ color: !filtros.almacen_id ? C.white : C.textMuted, fontSize: 12, fontWeight: '700' }}>Todos</Text>
            </Pressable>
            {almacenes.map((a: any) => {
              const isActive = filtros.almacen_id === a.id;
              const bg = isActive ? (a.color_hex || C.accent) : C.card;
              const tc = isActive ? (a.color_hex ? textForBgC(a.color_hex) : C.white) : C.textSecondary;
              const bc = a.color_hex || C.border;
              return (
                <Pressable key={a.id} onPress={() => setAlmacen(a.id, a.nombre)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: bg, borderWidth: 1,
                    borderColor: isActive ? bg : bc + '60' }}>
                  {!isActive && a.color_hex && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.color_hex }} />
                  )}
                  <Text style={{ color: tc, fontSize: 12, fontWeight: '700' }}>{a.nombre}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Shortcuts compactos — visibles cuando hay filtros activos */}
        {(hasActiveFilters || hasApplied) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
            {SHORTCUTS.map(s => {
              const isActive = filtros.categoria === s.categoria && filtros.subcategoria === s.subcategoria && filtros.genero === s.genero;
              return (
                <Pressable key={s.label}
                  onPress={() => isActive ? clearCategoria() : applyShortcut(s)}
                  style={{ backgroundColor: isActive ? C.accent : C.card, borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1,
                    borderColor: isActive ? C.accent : C.border }}>
                  <Text style={{ color: isActive ? C.white : C.textSecondary, fontSize: 11, fontWeight: '600' }}>{s.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={clearAll}
              style={{ backgroundColor: C.redSurface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                borderWidth: 1, borderColor: C.red, justifyContent: 'center' }}>
              <Text style={{ color: C.red, fontSize: 11, fontWeight: '700' }}>Limpiar</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* Marca — siempre visible */}
        {filterOptions && (
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.blue, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>MARCA</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {filtros.marca ? (
                <Pressable onPress={() => updateFilter('marca', '')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blue, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: C.white, fontSize: 13, fontWeight: '800' }}>{filtros.marca}</Text>
                  <X size={13} color={C.white} />
                </Pressable>
              ) : (
                <>
                  {displayMarcas.map(m => (
                    <Pressable key={m.nombre} onPress={() => updateFilter('marca', m.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.blue + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '700' }}>{m.nombre}</Text>
                      {m.count != null && <Text style={{ color: C.textMuted, fontSize: 9 }}>{m.count} modelos</Text>}
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalFilter('marca')}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.blue, justifyContent: 'center' }}>
                    <Text style={{ color: C.blue, fontSize: 12, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        )}

        {/* Fit — siempre visible, inteligente según contexto */}
        {filterOptions && (
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.violet, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>FIT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {filtros.fit ? (
                <Pressable onPress={() => updateFilter('fit', '')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.violet, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: C.white, fontSize: 13, fontWeight: '800' }}>{filtros.fit}</Text>
                  <X size={13} color={C.white} />
                </Pressable>
              ) : (
                <>
                  {displayFits.map(f => (
                    <Pressable key={f.nombre} onPress={() => updateFilter('fit', f.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.violet + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '700' }}>{f.nombre}</Text>
                      {f.count != null && <Text style={{ color: C.textMuted, fontSize: 9 }}>{f.count} modelos</Text>}
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalFilter('fit')}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.violet, justifyContent: 'center' }}>
                    <Text style={{ color: C.violet, fontSize: 12, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        )}

        {/* Cascade subcategoría / género */}
        {filterOptions && filtros.categoria && !filtros.subcategoria && (
          <InlinePickerRow label="SUBCATEGORÍA" color={C.accent}
            options={filterOptions.subcategoria} onSelect={v => updateFilter('subcategoria', v)}
            onShowAll={() => setModalFilter('subcategoria')} />
        )}
        {filterOptions && filtros.categoria && filtros.subcategoria && !filtros.genero && (
          <InlinePickerRow label="GÉNERO" color={C.accent}
            options={filterOptions.genero} onSelect={v => updateFilter('genero', v)}
            onShowAll={() => setModalFilter('genero')} />
        )}

        {/* Chips activos — solo cuando no hay shortcut estándar activo */}
        {!activeShortcut && (filtros.categoria || filtros.subcategoria || filtros.genero) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }} style={{ flex: 1 }}>
              {filtros.categoria ? <PillChip label={filtros.categoria} color={C.accent} onRemove={() => updateFilter('categoria', '')} /> : null}
              {filtros.subcategoria ? <PillChip label={filtros.subcategoria} color={C.accent} onRemove={() => updateFilter('subcategoria', '')} /> : null}
              {filtros.genero ? <PillChip label={filtros.genero} color={C.accent} onRemove={() => updateFilter('genero', '')} /> : null}
            </ScrollView>
            <Pressable onPress={clearAll}
              style={{ backgroundColor: C.redSurface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.red }}>
              <Text style={{ color: C.red, fontSize: 11, fontWeight: '700' }}>Limpiar</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Shortcuts — estado inicial */}
      {!hasActiveFilters && !hasApplied && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '600' }}>PANTALÓN</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SHORTCUTS.map(s => (
              <Pressable key={s.label} onPress={() => applyShortcut(s)}
                style={{ flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setModalFilter('categoria')}
            style={{ padding: 14, backgroundColor: C.card, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.accent }}>
            <Text style={{ color: C.accent, fontSize: 14, fontWeight: '600' }}>Otra categoría...</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Resultados */}
      {isLoading ? (
        <View style={{ padding: 40, alignItems: 'center', flex: 1 }}><ActivityIndicator color={C.accent} size="large" /></View>
      ) : hasApplied ? (
        <FlatList data={productos} style={{ flex: 1 }}
          keyExtractor={(p) => p.producto_id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
          ListHeaderComponent={productos.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
              <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '800' }}>{stockGrandTotal}</Text>
              <Text style={{ color: C.textMuted, fontSize: 11, flex: 1 }}>
                prendas · {productos.length} modelo{productos.length !== 1 ? 's' : ''}
              </Text>
            </View>
          ) : null}
          ListEmptyComponent={<Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>Sin resultados</Text>}
          renderItem={({ item }) => (
            <ProductCard prod={item} isExpanded={expandedProd === item.producto_id}
              almacenColorMap={almacenColorMap}
              onToggle={() => setExpandedProd(expandedProd === item.producto_id ? null : item.producto_id)} />
          )}
        />
      ) : null}

      {/* Modal filtros de texto */}
      <FilterModal visible={!!modalFilter}
        label={modalFilter ? FILTER_LABELS[modalFilter] : ''}
        options={modalFilter && filterOptions ? (filterOptions[modalFilter] || []) : []}
        selected={modalFilter ? (filtros as any)[modalFilter] : ''}
        onSelect={v => { if (modalFilter) updateFilter(modalFilter, v); setModalFilter(null); }}
        onClose={() => setModalFilter(null)} />
    </View>
  );
}

// ─── Inline picker row (cascading) ────────────────────

function InlinePickerRow({ label, color, options, onSelect, onShowAll }: {
  label: string; color: string; options: string[];
  onSelect: (v: string) => void; onShowAll: () => void;
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

// ─── Pill chip (active filter) ────────────────────────

function PillChip({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Pressable hitSlop={8} onPress={onRemove}><X size={12} color={color} /></Pressable>
    </View>
  );
}

// ─── Stock Matrix ─────────────────────────────────────

const CELL_W = 36;
const COLOR_COL_W = 90;
const TOTAL_COL_W = 36;
const ROW_H = 32;
const HEADER_H = 22;

function sortTallasRaw(tallas: string[]): string[] {
  return [...tallas].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });
}

function StockMatrix({ colores, almacenColorMap }: {
  colores: ColorGroup[]; almacenColorMap: Map<string, AlmacenInfo>;
}) {
  const [selectedCell, setSelectedCell] = useState<{ color_id: string; talla: string } | null>(null);

  const allTallas = useMemo(() => {
    const set = new Set<string>();
    for (const c of colores) for (const v of c.variantes) set.add(v.talla);
    return sortTallasRaw([...set]);
  }, [colores]);

  const selColor = selectedCell ? colores.find(c => c.color_id === selectedCell.color_id) : null;
  const selVariant = selColor ? selColor.variantes.find(v => v.talla === selectedCell!.talla) : null;

  return (
    <View style={{ paddingHorizontal: 10, paddingBottom: 14, gap: 8 }}>
      <View style={{ flexDirection: 'row' }}>

        {/* Columna fija izquierda: nombres de color */}
        <View style={{ width: COLOR_COL_W }}>
          <View style={{ height: HEADER_H }} />
          {colores.map(c => (
            <View key={c.color_id} style={{ height: ROW_H, justifyContent: 'center', paddingRight: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3,
                  backgroundColor: c.stockTotal > 0 ? C.indigo : C.border, flexShrink: 0 }} />
                <Text numberOfLines={1} style={{ color: c.stockTotal > 0 ? C.textPrimary : C.textMuted,
                  fontSize: 11, fontWeight: '600', flex: 1 }}>{c.color_nombre}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Zona scrollable: tallas + total */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View>
            {/* Header tallas */}
            <View style={{ flexDirection: 'row', height: HEADER_H, alignItems: 'center' }}>
              {allTallas.map(t => (
                <View key={t} style={{ width: CELL_W, alignItems: 'center' }}>
                  <Text style={{ color: C.textMuted, fontSize: 9, fontWeight: '800' }}>{t}</Text>
                </View>
              ))}
              <View style={{ width: TOTAL_COL_W, alignItems: 'center', marginLeft: 4 }}>
                <Text style={{ color: C.textMuted, fontSize: 9, fontWeight: '800' }}>TOT</Text>
              </View>
            </View>

            {/* Filas de color */}
            {colores.map(c => {
              const varMap = new Map(c.variantes.map(v => [v.talla, v]));
              return (
                <View key={c.color_id} style={{ flexDirection: 'row', height: ROW_H, alignItems: 'center' }}>
                  {allTallas.map(t => {
                    const v = varMap.get(t);
                    const qty = v?.stock.total ?? 0;
                    const isSel = selectedCell?.color_id === c.color_id && selectedCell?.talla === t;
                    return (
                      <Pressable key={t}
                        onPress={() => qty > 0 ? setSelectedCell(isSel ? null : { color_id: c.color_id, talla: t }) : null}
                        style={{ width: CELL_W, height: 28, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: isSel ? C.indigo : qty > 0 ? C.accentSurface : 'transparent',
                          borderRadius: 6 }}>
                        <Text style={{ color: isSel ? C.white : qty > 0 ? C.cyan : C.border,
                          fontSize: 12, fontWeight: qty > 0 ? '800' : '400' }}>
                          {qty > 0 ? qty : '·'}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <View style={{ width: TOTAL_COL_W, alignItems: 'center', marginLeft: 4 }}>
                    <Text style={{ color: c.stockTotal > 0 ? C.textPrimary : C.textMuted,
                      fontSize: 12, fontWeight: '900' }}>{c.stockTotal}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Detalle almacén de celda seleccionada */}
      {selVariant && selColor && (
        <View style={{ backgroundColor: C.bg, borderRadius: 10, padding: 10, gap: 6,
          borderWidth: 1, borderColor: C.indigo + '50' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <Text style={{ color: C.textPrimary, fontSize: 12, fontWeight: '700' }}>
              {selColor.color_nombre} · T{selectedCell!.talla}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: C.textMuted, fontSize: 9 }}>{selVariant.codigo_barras}</Text>
              <Text style={{ color: C.cyan, fontSize: 16, fontWeight: '900' }}>{selVariant.stock.total}</Text>
            </View>
          </View>
          {selVariant.stock.porAlmacen.map(a => {
            const almInfo = almacenColorMap.get(a.almacen_id);
            const isStripe = almInfo?.patron === 'rayas' && !!almInfo?.color_secundario;
            const bg = isStripe ? 'transparent' : (almInfo?.color_hex || C.card);
            const tc = isStripe ? '#ffffff' : (almInfo?.color_hex ? textForBgC(almInfo.color_hex) : C.textSecondary);
            return (
              <View key={a.almacen_id} style={{ flexDirection: 'row', justifyContent: 'space-between',
                alignItems: 'center', backgroundColor: bg, borderRadius: 7,
                paddingHorizontal: 10, paddingVertical: 7, overflow: 'hidden', minHeight: 34 }}>
                {isStripe && <StripeBg color1={almInfo!.color_hex!} color2={almInfo!.color_secundario!} w={SCREEN_W} h={34} />}
                <Text style={{ color: tc, fontSize: 12, fontWeight: '700', zIndex: 1 }}>{a.almacen_nombre}</Text>
                <Text style={{ color: tc, fontSize: 15, fontWeight: '900', zIndex: 1 }}>{a.cantidad}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Product Card ─────────────────────────────────────

function ProductCard({ prod, isExpanded, almacenColorMap, onToggle }: {
  prod: ProductGroup; isExpanded: boolean;
  almacenColorMap: Map<string, AlmacenInfo>; onToggle: () => void;
}) {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
      <Pressable onPress={onToggle} style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.textPrimary, fontSize: 17, fontWeight: '800', lineHeight: 22 }}>{prod.producto_modelo}</Text>
            <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>
              {[prod.marca_nombre, prod.fit_nombre, prod.genero_nombre].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ color: prod.stockTotal > 0 ? C.cyan : C.red, fontSize: 24, fontWeight: '900', lineHeight: 28 }}>{prod.stockTotal}</Text>
            <Text style={{ color: C.emerald, fontSize: 12, fontWeight: '700' }}>S/ {prod.precio}</Text>
          </View>
          <View style={{ paddingTop: 4 }}>
            {isExpanded ? <ChevronUp size={16} color={C.textMuted} /> : <ChevronDown size={16} color={C.textMuted} />}
          </View>
        </View>
        {!isExpanded && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {prod.colores.map(c => (
              <View key={c.color_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: C.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: C.textSecondary, fontSize: 11 }}>{c.color_nombre}</Text>
                <Text style={{ color: c.stockTotal > 0 ? C.cyan : C.red, fontSize: 12, fontWeight: '800' }}>{c.stockTotal}</Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>

      {isExpanded && (
        <StockMatrix colores={prod.colores} almacenColorMap={almacenColorMap} />
      )}
    </View>
  );
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
          <Pressable onPress={() => { onSelect(''); setSearch(''); }}
            style={{ padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: !selected ? C.accentSurface : undefined }}>
            <Text style={{ color: !selected ? C.accent : C.textPrimary, fontSize: 14, fontWeight: !selected ? '700' : '400' }}>Todos</Text>
          </Pressable>
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
