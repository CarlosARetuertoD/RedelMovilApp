# RedelMovilApp — Guía completa

## Qué es

App móvil de inventario para **Negocios e Inversiones Karolay** (tienda de ropa). Permite al personal de almacén consultar productos, hacer conteos de inventario y escanear códigos de barras usando **pistola láser USB** o **cámara del celular** (expo-camera).

Es parte del ecosistema Redel:
- **RedelERP** (Django + React) — Fuente de verdad, BD principal
- **RedelApp** (Next.js) — Gestión remota
- **PagosLetrasApp** (Expo/React Native) — Pagos y letras de cambio
- **RedelMovilApp** (Expo/React Native) — **Esta app**, inventario móvil
- **BoletasApp** (Next.js) — Punto de venta
- **ClubKarolayJeansWeb** (Next.js) — Web pública

## REGLA PRINCIPAL

**Esta app NUNCA modifica `codigo_barras` en ninguna circunstancia.** Los barcodes son inmutables (están impresos en etiquetas físicas). Solo RedelERP puede crear/modificar productos y variantes.

## Stack tecnológico

- **Expo SDK 54** + React Native 0.81.5 + React 19.1
- **Expo Router 6** (file-based navigation)
- **TypeScript 5.3** (strict mode)
- **Zustand 5** (auth, conteo, sync, settings stores)
- **TanStack React Query 5** (server state/cache)
- **Supabase JS 2** (auth + escritura de solicitudes)
- **expo-sqlite 16** (BD local offline-first)
- **expo-camera 17** (escaneo con cámara)
- **Lucide React Native** (iconos)
- **AsyncStorage** (sesión, borradores, configuración)
- Dark theme mocha/carbon (consistente con ecosistema Redel)

**IMPORTANTE**: expo-sqlite usa API sync (`openDatabaseSync`, `getAllSync`, `getFirstSync`, `execSync`) porque la API async (`prepareAsync`) tiene un bug de NullPointerException en Expo Go SDK 54. NO cambiar a API async.

## Arquitectura offline-first

```
RedelERP (Django + PostgreSQL local)
    │ PUSH (sync manual)
    ▼
SUPABASE (nube)
    │ Sync: primera vez full, luego incremental cada 2 min
    ▼
SQLite local (redelmovil.db en el celular)
    │ Lectura instantánea, 0 latencia
    ▼
La app (escáner, consultas, conteo)
```

### Lectura (todo desde SQLite local):
- Escáner, Consultas, Conteo → leen de SQLite, NUNCA de Supabase directo
- Catálogos (marcas, fits, colores, tallas, etc.) → cacheados en memoria desde SQLite

### Escritura (directo a Supabase):
- Conteo (enviar ajuste) → `solicitudes_movil` en Supabase
- Login → consulta `usuarios` + `perfiles_usuario` en Supabase

### Sincronización (`lib/sync.ts`):
- **Primera vez**: descarga TODAS las tablas de Supabase → SQLite (bloquea la app hasta completar)
- **Incremental**: cada 2 min, solo registros con `updated_at > lastSync`
- **Manual**: desde Perfil → "Sincronizar ahora" o "Resetear y descargar todo"
- **Stock**: solo descarga filas con `cantidad > 0` (~3k filas en vez de 125k)
- Paginación por cursor (`gt('id', lastId)`) — Supabase limita 1000 filas por request

### Tablas en SQLite:
```
marcas, fits, colores, tallas, categorias, subcategorias, generos,
almacenes, productos, variantes, stock, sync_meta
```

### Tablas reales en Supabase (esquema real, NO lo que decía el MD anterior):
- `variantes`: id, sku_variant, codigo_barras, producto_id, color_id, talla_id, precio, activo
- `productos`: id, sku_product, modelo, categoria_id, subcategoria_id, marca_id, fit_id, genero_id, precio, activo
- `stock`: id, variante_id, almacen_id, cantidad
- Catálogos: marcas, fits, colores, tallas, categorias, subcategorias, generos, almacenes
- `variantes_cache`: existe pero NO se usa — le faltan columnas (marca_nombre, fit_nombre, etc.)
- NO hay foreign keys en Supabase — resolución de nombres se hace en memoria con catálogos cacheados

## Estructura del proyecto

```
RedelMovilApp/
├── app/
│   ├── _layout.tsx              # Root: AuthGate + Sync + SplashScreen
│   ├── login.tsx                # Login contra Supabase
│   ├── perfil.tsx               # Perfil: user info, sync manual, config escáner
│   └── (tabs)/
│       ├── _layout.tsx          # Tab navigator (4 tabs activos)
│       ├── index.tsx            # Consultas (tab por defecto)
│       ├── escaner.tsx          # Escáner con cámara + pistola
│       ├── conteo.tsx           # Conteo de inventario (3 fases)
│       ├── operaciones.tsx      # En construcción
│       └── movimientos.tsx      # Oculto (href: null)
├── lib/
│   ├── supabase.ts              # Cliente Supabase
│   ├── localDB.ts               # SQLite: tablas, upsert, queries
│   ├── sync.ts                  # Sync Supabase → SQLite
│   ├── queries.ts               # Todas las consultas (leen de SQLite)
│   ├── colors.ts                # Paleta mocha/carbon
│   └── types.ts                 # Interfaces TypeScript
├── store/
│   ├── authStore.ts             # Login/logout/session
│   ├── conteoStore.ts           # Matriz, sobrantes, fases
│   ├── syncStore.ts             # Estado de sincronización
│   └── settingsStore.ts         # Configuración (modo escáner)
├── app.json
├── package.json
├── tsconfig.json
└── babel.config.js
```

## Pantallas

### Tabs (orden): Consultas → Escáner → Conteo → Operaciones

### 1. Consultas (`app/(tabs)/index.tsx`) — Tab por defecto
- **Atajos rápidos**: Jean Dama, Jean Varón, Drill Dama, Drill Varón (asumen Pantalón)
- **Filtros cascada**: Categoría → Subcategoría → Género → Marca (top 5 pills) → Fit (top 5 pills) → Talla
- **Tallas inteligentes**: numéricas para pantalón/bermuda, alfanuméricas para casaca
- **Búsqueda inteligente**: "pionier pitillo 30" detecta marca+fit+talla automáticamente
- **Resultados**: agrupados por producto → colores → tallas con stock por almacén
- **Agrupar por Fit**: toggle para ver subtotales por fit (solo si no hay fit seleccionado)
- Filtro de almacén con desglose de stock por ubicación
- Botón "Nueva búsqueda" para volver a atajos

### 2. Escáner (`app/(tabs)/escaner.tsx`)
- **Modo "Cámara + Pistola"** (default): input texto + cámara toggle + pistola USB
- **Modo "Solo cámara"**: solo botón de cámara, sin input texto
- Configurable desde Perfil → Escáner
- expo-camera con barcode scanning (EAN-13, EAN-8, Code128, Code39, QR)
- Info del producto: categoría/subcategoría/género arriba, modelo grande, precio, detalle en grid 2x2 (marca, fit, color, talla)
- Stock por almacén con desglose
- **Tallas tocables**: tap navega a esa variante (misma familia)
- **Colores tocables**: tap navega a ese color del mismo producto
- Feedback visual al navegar (spinner en la talla/color seleccionado)

### 3. Conteo (`app/(tabs)/conteo.tsx`)
**3 fases:**

#### FASE 1 — Preparación con preview en vivo
- Almacén: pills horizontales (orden: A11, A20, B80, B77, C26, Almacen 1, Almacen 2)
- Atajos: Jean Dama/Varón, Drill Dama/Varón + "Otra categoría"
- Filtros cascada: igual que consultas (marca top 5, fit top 5, talla inteligente)
- **Preview automático**: conforme agregas filtros, muestra variantes con stock en tiempo real
- Contador: "23 variantes · 45 prendas en A11"
- Si no hay stock → mensaje amarillo explicativo
- Botón fijo abajo: "Empezar conteo (45 prendas)"

#### FASE 2 — Escaneo
- Input para pistola láser
- Cada escaneo busca en la matriz local (SQLite si es sobrante)
- Barra de progreso, contadores color-coded
- Acciones: Deshacer, Pausar, Ver resultados

#### FASE 3 — Resultados
- Cuadra / No cuadra
- Detalle de faltantes, excedentes, sobrantes
- Enviar solicitud de ajuste → `solicitudes_movil` en Supabase

### 4. Operaciones (`app/(tabs)/operaciones.tsx`)
- **En construcción** — muestra placeholder

### 5. Perfil (`app/perfil.tsx`)
- Info del usuario (nombre, username, rol)
- **Base de datos local**: última sync, variantes, stock, estado
- Botón "Sincronizar ahora" (incremental)
- Botón "Resetear y descargar todo" (borra SQLite + full sync)
- **Escáner**: elegir entre "Cámara + Pistola" o "Solo cámara"
- Cerrar sesión

## Autenticación

Login contra Supabase (NO SQLite): `usuarios` + `perfiles_usuario`
- Verifica: is_active, activo, password_visible, rol
- Roles permitidos: admin, supervisor, almacenero
- Trim + lowercase en username, trim en password
- Sesión: AsyncStorage key `@redelmovil_user`

## Queries principales (`lib/queries.ts`)

Todas leen de SQLite local. Los parámetros `?` se reemplazan con valores escapados en el SQL (no usa bind params por el bug de prepareAsync).

| Función | Fuente | Descripción |
|---------|--------|-------------|
| `loadCatalogs()` | SQLite | Carga catálogos en memoria (Maps id→valor) |
| `escanearProducto(code)` | SQLite | Info completa + stock + tallas hermanas + colores |
| `fetchVariantesConStock(filtros)` | SQLite | Para consultas y conteo, con stock por almacén |
| `fetchTopMarcasYFits(filtros)` | SQLite | Top marcas/fits para pills inline |
| `fetchFilterOptions()` | SQLite | Opciones de filtro (categorías, tallas, etc.) |
| `parseSmartSearch(input)` | Memoria | Detecta filtros en texto libre |
| `crearSolicitud(...)` | Supabase | Escritura directa a la nube |

## Desarrollo

```bash
# Iniciar dev server
npx expo start --clear

# Testing con Expo Go (escanear QR)
# Celular y PC en la misma red WiFi, o:
npx expo start --tunnel

# Build APK
npx eas build --platform android --profile preview
```

## Pendiente / TODO

- [ ] Crear tabla `solicitudes_movil` en Supabase
- [ ] Completar sección Operaciones
- [ ] Sección "Mis Solicitudes" — ver estado de solicitudes enviadas
- [ ] Sync: detectar borrados (soft-delete con activo=false en RedelERP)
- [ ] Sync: RedelERP no sincroniza `password_visible` de perfiles nuevos
- [ ] Exportar resumen de conteo al clipboard
- [ ] Build APK con EAS

## Notas técnicas

- **expo-sqlite v16 con API SYNC** — la API async tiene NullPointerException en Expo Go. NO usar `openDatabaseAsync`, `getAllAsync`, etc. Usar `openDatabaseSync`, `getAllSync`, `getFirstSync`, `execSync`.
- **Booleans**: Supabase devuelve `true/false`, SQLite necesita `1/0`. La función `esc()` en localDB.ts convierte automáticamente.
- **Paginación Supabase**: máximo 1000 filas por request. Usar cursor `gt('id', lastId)`, NO `range()` con filtros.
- **Orden almacenes**: custom hardcoded en queries.ts: A11, A20, B80, B77, C26, Almacen 1, Almacen 2
- Los barcodes se padean a 13 dígitos con `padStart(13, '0')` antes de buscar
- La app NO crea ni modifica productos, variantes, stock directamente
- `variantes_cache` existe en Supabase pero NO se usa — le faltan columnas
