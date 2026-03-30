import { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { Search, X, ChevronDown, ChevronUp, Layers } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchVariantesConStock, fetchFilterOptions, fetchAlmacenes, fetchTopMarcasYFits, parseSmartSearch } from '../../lib/queries';
import { C } from '../../lib/colors';

// ─── Types ────────────────────────────────────────────

type Filtros = {
  search: string; categoria: string; subcategoria: string;
  marca: string; fit: string; genero: string; talla: string;
  almacen_id: string; almacen_nombre: string;
};

type StockAlmacen = { almacen_id: string; almacen_nombre: string; cantidad: number };
type StockDetail = { total: number; porAlmacen: StockAlmacen[] };
type VarianteTalla = { talla: string; stock: StockDetail; codigo_barras: string; sku_variant: string };
type ColorGroup = { color_nombre: string; color_id: string; stockTotal: number; variantes: VarianteTalla[]; almacenResumen: StockAlmacen[] };
type ProductGroup = {
  producto_id: string; producto_sku: string; producto_modelo: string;
  marca_nombre: string; fit_nombre: string; categoria_nombre: string;
  subcategoria_nombre: string; genero_nombre: string;
  precio: number; stockTotal: number; colores: ColorGroup[];
};
type FitGroup = { fit_nombre: string; stockTotal: number; productos: ProductGroup[] };
type ListItem = { type: 'fit_header'; fit: FitGroup } | { type: 'product'; prod: ProductGroup };

const EMPTY_FILTROS: Filtros = {
  search: '', categoria: '', subcategoria: '', marca: '', fit: '', genero: '', talla: '',
  almacen_id: '', almacen_nombre: '',
};

const SHORTCUTS = [
  { label: 'Jean Dama', categoria: 'Pantalon', subcategoria: 'Jean', genero: 'Dama' },
  { label: 'Jean Varón', categoria: 'Pantalon', subcategoria: 'Jean', genero: 'Varon' },
  { label: 'Drill Dama', categoria: 'Pantalon', subcategoria: 'Drill', genero: 'Dama' },
  { label: 'Drill Varón', categoria: 'Pantalon', subcategoria: 'Drill', genero: 'Varon' },
];

const FILTER_LABELS: Record<string, string> = {
  categoria: 'Categoría', subcategoria: 'Subcategoría', marca: 'Marca',
  fit: 'Fit', genero: 'Género', talla: 'Talla',
};

const MAX_PILLS = 5;

// ─── Grouping ─────────────────────────────────────────

function sortTallas(a: VarianteTalla, b: VarianteTalla) {
  const na = parseInt(a.talla), nb = parseInt(b.talla);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.talla.localeCompare(b.talla);
}

function buildAlmacenResumen(variantes: VarianteTalla[]): StockAlmacen[] {
  const m = new Map<string, StockAlmacen>();
  for (const v of variantes) for (const a of v.stock.porAlmacen) {
    const e = m.get(a.almacen_id);
    if (e) e.cantidad += a.cantidad; else m.set(a.almacen_id, { ...a });
  }
  return Array.from(m.values()).sort((a, b) => b.cantidad - a.cantidad);
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
    if (!cg) { cg = { color_nombre: v.color_nombre, color_id: v.color_id, stockTotal: 0, variantes: [], almacenResumen: [] }; p.colores.push(cg); }
    cg.stockTotal += sd.total;
    cg.variantes.push({ talla: v.talla_valor, stock: sd, codigo_barras: v.codigo_barras, sku_variant: v.sku_variant });
  }

  for (const p of prodMap.values()) {
    for (const c of p.colores) { c.variantes.sort(sortTallas); c.almacenResumen = buildAlmacenResumen(c.variantes); }
    p.colores.sort((a, b) => b.stockTotal - a.stockTotal);
  }
  return Array.from(prodMap.values()).sort((a, b) => b.stockTotal - a.stockTotal);
}

function groupByFit(prods: ProductGroup[]): FitGroup[] {
  const m = new Map<string, FitGroup>();
  for (const p of prods) {
    const k = p.fit_nombre || 'Sin fit';
    let fg = m.get(k);
    if (!fg) { fg = { fit_nombre: k, stockTotal: 0, productos: [] }; m.set(k, fg); }
    fg.stockTotal += p.stockTotal; fg.productos.push(p);
  }
  return Array.from(m.values()).sort((a, b) => b.stockTotal - a.stockTotal);
}

function buildFitList(groups: FitGroup[]): ListItem[] {
  const items: ListItem[] = [];
  for (const fg of groups) { items.push({ type: 'fit_header', fit: fg }); for (const p of fg.productos) items.push({ type: 'product', prod: p }); }
  return items;
}

// ─── Screen ───────────────────────────────────────────

export default function ConsultasScreen() {
  const [filtros, setFiltros] = useState<Filtros>({ ...EMPTY_FILTROS });
  const [appliedFiltros, setAppliedFiltros] = useState<Filtros | null>(null);
  const [expandedProd, setExpandedProd] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState<string | null>(null);
  const [showAlmacenModal, setShowAlmacenModal] = useState(false);
  const [agruparFit, setAgruparFit] = useState(false);
  const searchRef = useRef<TextInput>(null);

  const { data: filterOptions } = useQuery({ queryKey: ['filterOptions'], queryFn: fetchFilterOptions, staleTime: 60000 });
  const { data: almacenes } = useQuery({ queryKey: ['almacenes'], queryFn: fetchAlmacenes, staleTime: 60000 });

  const hasActiveFilters = filtros.categoria || filtros.subcategoria || filtros.marca || filtros.fit || filtros.genero || filtros.talla;
  const hasApplied = appliedFiltros && (appliedFiltros.search || appliedFiltros.categoria || appliedFiltros.subcategoria || appliedFiltros.marca || appliedFiltros.fit || appliedFiltros.genero || appliedFiltros.talla);

  // Top marcas/fits cascadas
  const { data: topData } = useQuery({
    queryKey: ['topMarcasFits', filtros.categoria, filtros.subcategoria, filtros.genero, filtros.marca],
    queryFn: () => fetchTopMarcasYFits({
      categoria: filtros.categoria || undefined,
      subcategoria: filtros.subcategoria || undefined,
      genero: filtros.genero || undefined,
      marca: filtros.marca || undefined,
    }),
    enabled: !!(filtros.categoria || filtros.subcategoria || filtros.genero),
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
  const listItems = useMemo<ListItem[]>(() => {
    if (!agruparFit) return productos.map(p => ({ type: 'product' as const, prod: p }));
    return buildFitList(groupByFit(productos));
  }, [productos, agruparFit]);

  const applySearch = useCallback((f: Filtros) => {
    setAppliedFiltros({ ...f }); setExpandedProd(null);
  }, []);

  const updateFilter = useCallback((key: string, value: string, autoApply = true) => {
    if (key === 'fit' && value) setAgruparFit(false);
    setFiltros(prev => {
      const next = { ...prev, [key]: value };
      if (autoApply && key !== 'search') setTimeout(() => applySearch(next), 0);
      return next;
    });
  }, [applySearch]);

  const applyShortcut = useCallback((s: typeof SHORTCUTS[0]) => {
    const next = { ...EMPTY_FILTROS, categoria: s.categoria, subcategoria: s.subcategoria, genero: s.genero };
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
      if (appliedFiltros) setTimeout(() => applySearch(next), 0);
      return next;
    });
    setShowAlmacenModal(false);
  }, [applySearch, appliedFiltros]);

  const clearAll = useCallback(() => {
    setFiltros({ ...EMPTY_FILTROS }); setAppliedFiltros(null); setExpandedProd(null);
  }, []);

  const showAlmDesglose = !filtros.almacen_id;
  const topMarcas = topData?.marcas.slice(0, MAX_PILLS) || [];
  const topFits = topData?.fits.slice(0, MAX_PILLS) || [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ padding: 12, gap: 8 }}>
        {/* Search bar */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput ref={searchRef} value={filtros.search}
            onChangeText={v => updateFilter('search', v, false)} onSubmitEditing={doSmartSearch}
            placeholder="pionier pitillo 30 o escribe lo que sea..."
            placeholderTextColor={C.textMuted} autoCapitalize="none" returnKeyType="search"
            style={{ flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: C.white, fontSize: 14, borderWidth: 1, borderColor: C.border }} />
          <Pressable onPress={doSmartSearch} style={{ backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' }}>
            <Search size={20} color={C.white} />
          </Pressable>
        </View>

        {/* Active filters + cascading selectors */}
        {hasActiveFilters ? (
          <View style={{ gap: 10 }}>
            {/* Chips + Limpiar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5, flex: 1 }}>
                {filtros.almacen_id ? <PillChip label={filtros.almacen_nombre} color={C.cyan} onRemove={() => setAlmacen('', '')} /> : null}
                {filtros.categoria ? <PillChip label={filtros.categoria} color={C.accent} onRemove={() => updateFilter('categoria', '')} /> : null}
                {filtros.subcategoria ? <PillChip label={filtros.subcategoria} color={C.accent} onRemove={() => updateFilter('subcategoria', '')} /> : null}
                {filtros.genero ? <PillChip label={filtros.genero} color={C.accent} onRemove={() => updateFilter('genero', '')} /> : null}
                {filtros.marca ? <PillChip label={filtros.marca} color={C.blue} onRemove={() => updateFilter('marca', '')} /> : null}
                {filtros.fit ? <PillChip label={filtros.fit} color={C.violet} onRemove={() => updateFilter('fit', '')} /> : null}
                {filtros.talla ? <PillChip label={`T${filtros.talla}`} color={C.cyan} onRemove={() => updateFilter('talla', '')} /> : null}
              </ScrollView>
              <Pressable onPress={clearAll}
                style={{ backgroundColor: C.redSurface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.red }}>
                <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>Limpiar</Text>
              </Pressable>
            </View>

            {/* Cascada: subcategoría si falta */}
            {filtros.categoria && !filtros.subcategoria && filterOptions && (
              <InlinePickerRow label="SUBCATEGORÍA" color={C.accent}
                options={filterOptions.subcategoria} onSelect={v => updateFilter('subcategoria', v)}
                onShowAll={() => setModalFilter('subcategoria')} />
            )}

            {/* Cascada: género si falta */}
            {filtros.categoria && filtros.subcategoria && !filtros.genero && filterOptions && (
              <InlinePickerRow label="GÉNERO" color={C.accent}
                options={filterOptions.genero} onSelect={v => updateFilter('genero', v)}
                onShowAll={() => setModalFilter('genero')} />
            )}

            {/* Almacén si no hay */}
            {!filtros.almacen_id && (
              <Pressable onPress={() => setShowAlmacenModal(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>Filtrar por almacén</Text>
                <ChevronDown size={14} color={C.textMuted} />
              </Pressable>
            )}

            {/* Marca — pills grandes */}
            {!filtros.marca && topMarcas.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: C.blue, fontSize: 13, fontWeight: '800' }}>MARCA</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {topMarcas.map(m => (
                    <Pressable key={m.nombre} onPress={() => updateFilter('marca', m.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.blue + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700' }}>{m.nombre}</Text>
                      <Text style={{ color: C.textMuted, fontSize: 10 }}>{m.count} modelos</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalFilter('marca')}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.blue, justifyContent: 'center' }}>
                    <Text style={{ color: C.blue, fontSize: 13, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}

            {/* Fit — pills grandes */}
            {!filtros.fit && topFits.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={{ color: C.violet, fontSize: 13, fontWeight: '800' }}>FIT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {topFits.map(f => (
                    <Pressable key={f.nombre} onPress={() => updateFilter('fit', f.nombre)}
                      style={{ backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.violet + '40' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700' }}>{f.nombre}</Text>
                      <Text style={{ color: C.textMuted, fontSize: 10 }}>{f.count} modelos</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setModalFilter('fit')}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.violet, justifyContent: 'center' }}>
                    <Text style={{ color: C.violet, fontSize: 13, fontWeight: '700' }}>Ver todo</Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}

            {/* Talla — inteligente por categoría */}
            {filterOptions && (() => {
              const cat = filtros.categoria?.toLowerCase() || '';
              const usarNumericas = cat === 'pantalon' || cat === 'bermuda';
              const usarAlfanumericas = cat === 'casaca';
              const tallaPrimaria = usarNumericas ? (filterOptions as any).tallasNumericas
                : usarAlfanumericas ? (filterOptions as any).tallasAlfanumericas
                : filterOptions.talla;
              const tallaSecundaria = usarNumericas ? (filterOptions as any).tallasAlfanumericas
                : usarAlfanumericas ? (filterOptions as any).tallasNumericas
                : null;
              return (
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '800' }}>TALLA</Text>
                    {filtros.talla ? (
                      <Pressable onPress={() => updateFilter('talla', '')}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={{ color: C.textMuted, fontSize: 11 }}>Cambiar</Text>
                        <X size={12} color={C.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                  {!filtros.talla ? (
                    <View style={{ gap: 6 }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                        {(tallaPrimaria || []).map((t: string) => (
                          <Pressable key={t} onPress={() => updateFilter('talla', t)}
                            style={{ backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.cyan + '40', minWidth: 44, alignItems: 'center' }}>
                            <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{t}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                      {tallaSecundaria && tallaSecundaria.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                          {tallaSecundaria.map((t: string) => (
                            <Pressable key={t} onPress={() => updateFilter('talla', t)}
                              style={{ backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border, minWidth: 44, alignItems: 'center' }}>
                              <Text style={{ color: C.textMuted, fontSize: 14, fontWeight: '600' }}>{t}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <View style={{ backgroundColor: C.cyanSurface, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: C.cyan }}>
                        <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '800' }}>{filtros.talla}</Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        ) : null}
      </View>

      {/* Shortcuts — estado inicial */}
      {!hasActiveFilters && !hasApplied && (
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '600' }}>PANTALÓN</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SHORTCUTS.map(s => (
              <Pressable key={s.label} onPress={() => applyShortcut(s)}
                style={{
                  flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 12,
                  padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border,
                }}>
                <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setModalFilter('categoria')}
            style={{ padding: 14, backgroundColor: C.card, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.accent }}>
            <Text style={{ color: C.accent, fontSize: 14, fontWeight: '600' }}>Otra categoría...</Text>
          </Pressable>
        </View>
      )}

      {/* Summary bar */}
      {hasApplied && productos.length > 0 && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ color: C.cyan, fontSize: 18, fontWeight: '800' }}>{stockGrandTotal}</Text>
              <Text style={{ color: C.textMuted, fontSize: 11 }}>
                prendas · {productos.length} modelo{productos.length !== 1 ? 's' : ''}
              </Text>
            </View>
            {!filtros.fit && <Pressable onPress={() => setAgruparFit(!agruparFit)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
                backgroundColor: agruparFit ? C.violetSurface : C.card,
                borderWidth: 1, borderColor: agruparFit ? C.violet : C.border,
              }}>
              <Layers size={12} color={agruparFit ? C.violet : C.textMuted} />
              <Text style={{ color: agruparFit ? C.violet : C.textMuted, fontSize: 11, fontWeight: '600' }}>
                {agruparFit ? 'Por Fit' : 'Agrupar'}
              </Text>
            </Pressable>}
          </View>
          <Pressable onPress={clearAll}
            style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 8, backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.accent }}>
            <Search size={14} color={C.accent} />
            <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Nueva búsqueda</Text>
          </Pressable>
        </View>
      )}

      {/* Results */}
      {isLoading ? (
        <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={C.accent} size="large" /></View>
      ) : hasApplied ? (
        <FlatList data={listItems}
          keyExtractor={(item, i) => item.type === 'fit_header' ? `fit-${item.fit.fit_nombre}` : item.prod.producto_id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
          ListEmptyComponent={<Text style={{ color: C.textMuted, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>Sin resultados</Text>}
          renderItem={({ item }) => {
            if (item.type === 'fit_header') return (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4, marginTop: 6, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.violet }}>
                <Text style={{ color: C.violet, fontSize: 14, fontWeight: '800' }}>{item.fit.fit_nombre}</Text>
                <Text style={{ color: C.violet, fontSize: 16, fontWeight: '800' }}>{item.fit.stockTotal}</Text>
              </View>
            );
            return <ProductCard prod={item.prod} isExpanded={expandedProd === item.prod.producto_id} showAlmDesglose={showAlmDesglose}
              onToggle={() => setExpandedProd(expandedProd === item.prod.producto_id ? null : item.prod.producto_id)} />;
          }}
        />
      ) : null}

      {/* Modals */}
      <FilterModal visible={!!modalFilter}
        label={modalFilter ? FILTER_LABELS[modalFilter] : ''}
        options={modalFilter && filterOptions ? (filterOptions[modalFilter] || []) : []}
        selected={modalFilter ? (filtros as any)[modalFilter] : ''}
        onSelect={v => { if (modalFilter) updateFilter(modalFilter, v); setModalFilter(null); }}
        onClose={() => setModalFilter(null)} />
      <AlmacenModal visible={showAlmacenModal} almacenes={almacenes || []}
        selectedId={filtros.almacen_id} onSelect={setAlmacen} onClose={() => setShowAlmacenModal(false)} />
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

// ─── Product Card ─────────────────────────────────────

function ProductCard({ prod, isExpanded, showAlmDesglose, onToggle }: {
  prod: ProductGroup; isExpanded: boolean; showAlmDesglose: boolean; onToggle: () => void;
}) {
  const [selectedTalla, setSelectedTalla] = useState<string | null>(null);

  return (
    <View style={{ backgroundColor: C.card, borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
      <Pressable onPress={() => { onToggle(); setSelectedTalla(null); }} style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>{prod.producto_modelo}</Text>
            <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>{prod.marca_nombre} · {prod.fit_nombre} · {prod.genero_nombre}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', marginRight: 6 }}>
            <Text style={{ color: prod.stockTotal > 0 ? C.cyan : C.red, fontSize: 20, fontWeight: '800' }}>{prod.stockTotal}</Text>
            <Text style={{ color: C.emerald, fontSize: 11, fontWeight: '600' }}>S/ {prod.precio}</Text>
          </View>
          {isExpanded ? <ChevronUp size={16} color={C.textMuted} /> : <ChevronDown size={16} color={C.textMuted} />}
        </View>
        {!isExpanded && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {prod.colores.map(c => (
              <View key={c.color_id} style={{ backgroundColor: C.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ color: C.textMuted, fontSize: 10 }}>{c.color_nombre} <Text style={{ color: c.stockTotal > 0 ? C.cyan : C.red, fontWeight: '700' }}>{c.stockTotal}</Text></Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>

      {isExpanded && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
          {prod.colores.map(color => {
            const selV = selectedTalla ? color.variantes.find(v => v.sku_variant === selectedTalla) : null;
            return (
              <View key={color.color_id} style={{ backgroundColor: C.bg, borderRadius: 10, padding: 10, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.stockTotal > 0 ? C.indigo : C.textMuted, marginRight: 8 }} />
                  <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 }}>{color.color_nombre}</Text>
                  <Text style={{ color: color.stockTotal > 0 ? C.cyan : C.red, fontSize: 15, fontWeight: '800' }}>{color.stockTotal}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                  {color.variantes.map(v => {
                    const isSel = selectedTalla === v.sku_variant;
                    return (
                      <Pressable key={v.sku_variant} onPress={() => setSelectedTalla(isSel ? null : v.sku_variant)}
                        style={{ backgroundColor: isSel ? C.indigo : C.card, borderRadius: 8, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, minWidth: 48, borderLeftWidth: 3, borderLeftColor: v.stock.total > 0 ? C.cyan : C.red }}>
                        <Text style={{ color: isSel ? C.white : C.textSecondary, fontSize: 11, fontWeight: '600' }}>{v.talla}</Text>
                        <Text style={{ color: isSel ? C.white : (v.stock.total > 0 ? C.cyan : C.red), fontSize: 16, fontWeight: '800' }}>{v.stock.total}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {selV && (
                  <View style={{ backgroundColor: C.card, borderRadius: 8, padding: 10, gap: 6, borderWidth: 1, borderColor: C.indigo }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '700' }}>{color.color_nombre} · T{selV.talla}</Text>
                      <Text style={{ color: selV.stock.total > 0 ? C.cyan : C.red, fontSize: 18, fontWeight: '800' }}>{selV.stock.total}</Text>
                    </View>
                    <Text style={{ color: C.textMuted, fontSize: 10 }}>{selV.sku_variant}</Text>
                    <Text style={{ color: C.textMuted, fontSize: 10 }}>{selV.codigo_barras}</Text>
                    {selV.stock.porAlmacen.length > 0 ? (
                      <View style={{ gap: 4, marginTop: 2 }}>
                        <Text style={{ color: C.textMuted, fontSize: 10, fontWeight: '600' }}>Ubicación</Text>
                        {selV.stock.porAlmacen.map(a => (
                          <View key={a.almacen_id} style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.bg, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                            <Text style={{ color: C.textSecondary, fontSize: 12 }}>{a.almacen_nombre}</Text>
                            <Text style={{ color: C.cyan, fontSize: 14, fontWeight: '800' }}>{a.cantidad}</Text>
                          </View>
                        ))}
                      </View>
                    ) : <Text style={{ color: C.textMuted, fontSize: 11 }}>Sin stock</Text>}
                  </View>
                )}
                {!selV && showAlmDesglose && color.almacenResumen.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {color.almacenResumen.map(a => (
                      <View key={a.almacen_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.card, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 }}>
                        <Text style={{ color: C.textMuted, fontSize: 9 }}>{a.almacen_nombre}</Text>
                        <Text style={{ color: C.cyan, fontSize: 10, fontWeight: '700' }}>{a.cantidad}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Modals ───────────────────────────────────────────

function AlmacenModal({ visible, almacenes, selectedId, onSelect, onClose }: {
  visible: boolean; almacenes: any[]; selectedId: string;
  onSelect: (id: string, nombre: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ color: C.textPrimary, fontSize: 16, fontWeight: '700' }}>Almacén</Text>
            <Pressable onPress={onClose} hitSlop={12}><X size={20} color={C.textMuted} /></Pressable>
          </View>
          <Pressable onPress={() => onSelect('', '')}
            style={{ padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: !selectedId ? C.cyanSurface : undefined }}>
            <Text style={{ color: !selectedId ? C.cyan : C.textPrimary, fontSize: 14, fontWeight: !selectedId ? '700' : '400' }}>Todos los almacenes</Text>
          </Pressable>
          {almacenes.map((a: any) => (
            <Pressable key={a.id} onPress={() => onSelect(a.id, a.nombre)}
              style={{ padding: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: a.id === selectedId ? C.cyanSurface : undefined }}>
              <Text style={{ color: a.id === selectedId ? C.cyan : C.textPrimary, fontSize: 14, fontWeight: a.id === selectedId ? '700' : '400' }}>{a.nombre}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
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
