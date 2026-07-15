# KarolayJeansMovilApp — Guía completa

## Qué es

App móvil de inventario para **Negocios e Inversiones Karolay** (tienda de ropa). Permite al personal de almacén consultar productos, hacer conteos de inventario y escanear códigos de barras usando **pistola láser USB** o **cámara del celular** (expo-camera).

Es parte del ecosistema Redel:
- **KarolayJeansERP** (antes "RedelERP"; Django + React, Railway) — Fuente de verdad, BD principal
- **RedelApp** (Next.js) — Gestión remota via Supabase
- **FacturacionBoletasApp** (Next.js) — Punto de venta
- **KarolayJeansMovilApp** (Expo/React Native) — **Esta app**, inventario móvil
- **ClubKarolayJeansWeb** (Next.js) — Web pública

## REGLA PRINCIPAL

**Esta app NUNCA modifica `codigo_barras` en ninguna circunstancia.** Los barcodes son inmutables (están impresos en etiquetas físicas). Solo KarolayJeansERP puede crear/modificar productos y variantes.

## Stack tecnológico

- **Expo SDK 54** + React Native 0.81.5 + React 19.1
- **Expo Router 6** (file-based navigation)
- **TypeScript 5.3** (strict mode)
- **Zustand 5** (auth, conteo, sync, settings stores)
- **TanStack React Query 5** (server state/cache)
- **expo-sqlite 16** (BD local offline-first)
- **expo-camera 17** (escaneo con cámara)
- **Lucide React Native** (iconos)
- **AsyncStorage** (sesión, borradores, configuración)
- Dark theme mocha/carbon (consistente con ecosistema Redel)
- **NO usa Supabase** — conecta directamente a KarolayJeansERP en Railway via HTTP + JWT

**IMPORTANTE**: expo-sqlite usa API sync (`openDatabaseSync`, `getAllSync`, `getFirstSync`, `execSync`) porque la API async (`prepareAsync`) tiene un bug de NullPointerException en Expo Go SDK 54. NO cambiar a API async.

## Arquitectura offline-first

```
KarolayJeansERP (Django + PostgreSQL en Railway)
    │
    ├── POST /api/auth/token-movil/  ──► JWT (access + refresh en AsyncStorage)
    │
    └── GET /api/movil/sync/{tabla}/?since=ISO&page=N
            │ Primera vez: descarga TODAS las tablas (full)
            │ Luego: incremental cada 2 min (solo updated_at > lastSync)
            ▼
    SQLite local (karolayjeansmovil.db en el celular)
            │ Lectura instantánea, 0 latencia
            ▼
    La app (escáner, consultas, conteo)
            │
            └── POST /api/movil/solicitud/  ──► Ajustes/conteos enviados a Railway
```

### Lectura (todo desde SQLite local):
- Escáner, Consultas, Conteo → leen de SQLite, NUNCA directo a la red
- Catálogos (marcas, fits, colores, tallas, etc.) → cacheados en memoria desde SQLite

### Escritura (directo a Railway):
- Conteo (enviar ajuste) → `POST /api/movil/solicitud/` en KarolayJeansERP
- Login → `POST /api/auth/token-movil/` en KarolayJeansERP

### Sincronización (`lib/sync.ts`):
- **Primera vez**: descarga TODAS las tablas de Railway → SQLite (bloquea la app hasta completar)
- **Incremental**: cada 2 min, solo registros con `updated_at > lastSync`
- **Manual**: desde Perfil → "Sincronizar ahora" o "Resetear y descargar todo"
- **Stock**: solo descarga filas con `cantidad > 0` (~3k filas en vez de 125k)
- Paginación por página (`?page=N`), PAGE_SIZE = 900 filas/request

### Tablas en SQLite:
```
marcas, fits, colores, tallas, categorias, subcategorias, generos,
almacenes, productos, variantes, stock, sync_meta
```

### Endpoints Railway usados:
- `POST /api/auth/token-movil/` — login (requiere is_staff O rol admin/supervisor/almacenero)
- `GET /api/movil/sync/{tabla}/` — sync incremental/full por tabla
- `POST /api/movil/solicitud/` — enviar solicitud de ajuste de inventario

## Estructura del proyecto

```
KarolayJeansMovilApp/
├── app/
│   ├── _layout.tsx              # Root: AuthGate + Sync + SplashScreen
│   ├── login.tsx                # Login contra Railway
│   ├── perfil.tsx               # Perfil: user info, sync manual, config escáner
│   └── (tabs)/
│       ├── _layout.tsx          # Tab navigator (4 tabs activos)
│       ├── index.tsx            # Consultas (tab por defecto)
│       ├── escaner.tsx          # Escáner con cámara + pistola
│       ├── conteo.tsx           # Conteo de inventario (3 fases)
│       ├── operaciones.tsx      # En construcción
│       └── movimientos.tsx      # Oculto (href: null)
├── lib/
│   ├── railway.ts               # Cliente HTTP a Railway (railwayGet, railwayPost + JWT)
│   ├── localDB.ts               # SQLite: tablas, upsert, queries
│   ├── sync.ts                  # Sync Railway → SQLite
│   ├── queries.ts               # Todas las consultas (leen de SQLite)
│   ├── colors.ts                # Paleta mocha/carbon
│   └── types.ts                 # Interfaces TypeScript
├── store/
│   ├── authStore.ts             # Login/logout/session contra Railway
│   ├── conteoStore.ts           # Matriz, sobrantes, fases
│   ├── syncStore.ts             # Estado de sincronización
│   └── settingsStore.ts         # Configuración (modo escáner)
├── app.json
├── package.json
├── tsconfig.json
└── babel.config.js
```

## Pantallas

### Tabs (orden): Escáner → Consultas → Conteo

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
- Almacén: pills horizontales con color_hex de BD + `textForBg()` para contraste (orden: A11, A20, B80, B77, C26, Almacen 1, Almacen 2)
- **Búsqueda por modelo**: TextInput con debounce 450ms — activa el preview desde 2 caracteres. Si se escribe modelo SIN seleccionar atajos, oculta los atajos y filtros en cascada (modo búsqueda directa).
- Atajos: Jean Dama/Varón, Drill Dama/Varón + "Otra categoría" — solo visibles si no hay texto en modelo
- Filtros cascada: Categoría → Subcategoría → Género → Marca (top 5) → Fit (top 5) → Talla. Visibles cuando se usaron atajos; modelo actúa como refinamiento adicional
- **Preview agrupado en 2 niveles**:
  - Nivel 1: tarjetas por **modelo** — nombre, tags (subcategoría, género, marca, fit), cantidad de colores, total prendas. Tap expande/colapsa
  - Nivel 2: dentro de cada modelo, cards por **color** con tallas y stock (T28:2, T30:4…)
- **Selección de modelos**: checkbox por tarjeta. `null` = todo seleccionado (default). Botones "Todo / Ninguno". Barra muestra "X de Y modelos · N prendas"
- Botón fijo: "Empezar conteo · todo · N prendas" o "X modelos · N prendas". Deshabilitado si nada seleccionado
- `fetchVariantesConStock` soporta parámetro `search` que filtra por `modelo LIKE ?` en productos

#### FASE 2 — Escaneo
- Input para pistola láser
- **Vibración háptica**: OK → 80ms, COMPLETO → doble pulso (80+80ms), EXCEDE/SOBRANTE → 300ms
- Barra de progreso, contadores color-coded (OK/Pendientes/Excedentes/Sobrantes)
- Acciones: Deshacer, Pausar (guarda borrador), Ver resultados

#### FASE 3 — Resultados
- Header con ícono grande (✓ verde / ⚠ rojo) + nombre almacén + fecha
- 3 tarjetas de totales grandes: Esperado / Contado / Diferencia
- Barra de precisión con % color-coded + 4 stats
- Secciones colapsables: Faltantes, Sobrantes, Excedentes — con count badge y toggle
- Cada fila: descripción + contado/esperado + badge de diferencia con fondo de color
- Acciones fijas al pie: "Enviar solicitud" (prominente, solo si no cuadra) + fila Continuar/Compartir/Reset + "Nuevo conteo"
- "Compartir" → `Share.share()` nativo (WhatsApp, copiar, email…)
- Tras enviar exitosamente → badge verde "Solicitud enviada" reemplaza el botón

### 4. Operaciones (`app/(tabs)/operaciones.tsx`)
- **En construcción** — muestra placeholder (oculto con `href: null`)

### 5. Perfil (`app/perfil.tsx`)
- Info del usuario (nombre, username, rol)
- **Base de datos local**: última sync, variantes, stock, estado
- Botón "Sincronizar ahora" (incremental)
- Botón "Resetear y descargar todo" (borra SQLite + full sync)
- **Escáner**: elegir entre "Cámara + Pistola" o "Solo cámara"
- Cerrar sesión

## Autenticación

Login contra Railway (`POST /api/auth/token-movil/`):
- Devuelve JWT access + refresh tokens, guardados en AsyncStorage
- Verifica: is_staff O rol in {admin, supervisor, almacenero}
- Trim + lowercase en username, trim en password
- Sesión: AsyncStorage key `@karolayjeansmovil_user`
- Auto-refresh del token en interceptor de railway.ts

## Queries principales (`lib/queries.ts`)

Todas leen de SQLite local. Los parámetros `?` se reemplazan con valores escapados en el SQL (no usa bind params por el bug de expo-sqlite).

| Función | Fuente | Descripción |
|---------|--------|-------------|
| `loadCatalogs()` | SQLite | Carga catálogos en memoria (Maps id→valor) |
| `escanearProducto(code)` | SQLite | Info completa + stock + tallas hermanas + colores |
| `fetchVariantesConStock(filtros)` | SQLite | Para consultas y conteo, con stock por almacén |
| `fetchTopMarcasYFits(filtros)` | SQLite | Top marcas/fits para pills inline |
| `fetchFilterOptions()` | SQLite | Opciones de filtro (categorías, tallas, etc.) |
| `parseSmartSearch(input)` | Memoria | Detecta filtros en texto libre |
| `crearSolicitud(...)` | Railway | POST /api/movil/solicitud/ |

## Desarrollo

```bash
# Iniciar dev server
npx expo start --clear

# Testing con Expo Go (escanear QR)
# Celular y PC en la misma red WiFi, o:
npx expo start --tunnel
```

## Build APK

### Requisitos (una sola vez)
```bash
# Instalar EAS CLI global
npm install -g eas-cli

# Loguearse en Expo
eas login
# Cuenta: carlosretuerto / cretuertodelgado@gmail.com

# Inicializar proyecto EAS (ya hecho)
eas init
```

### Generar APK (cada vez que quieras una nueva versión)
```bash
cd KarolayJeansMovilApp
eas build --platform android --profile preview
```
- Tarda ~10-15 minutos
- Se genera en la nube de Expo (no necesitas Android Studio)
- Al terminar da un link para descargar el `.apk`
- El APK se instala directo en cualquier Android

### Perfiles de build (`eas.json`)
- **preview** → genera `.apk` (instalación directa, para testing y distribución interna)
- **production** → genera `.aab` (para subir a Google Play Store)

### Variables de entorno
La URL de Railway está en `lib/railway.ts` como constante. No hay vars de entorno de Supabase.

Para builds EAS, las variables se configuran en expo.dev → proyecto → Settings → Environment variables.

### Archivo `.env` (solo si se necesita para desarrollo local)
```
EXPO_PUBLIC_RAILWAY_URL=https://redelerp-backend-production.up.railway.app
```

### Configuración importante
- `.npmrc` tiene `legacy-peer-deps=true` — necesario para que EAS instale dependencias sin conflictos
- `app.json` tiene permisos de CAMERA configurados
- Keystore de Android se genera automáticamente en la nube de Expo

### GitHub
- Repo: https://github.com/CarlosARetuertoD/KarolayJeansMovilApp
- Branch: `main`
- Un push a main NO genera APK automáticamente (hay que lanzar build manual)

### Primer APK generado
- Build ID: `8dc451a5-c953-4e44-9113-b283531d4083`
- Link: https://expo.dev/accounts/carlosretuerto/projects/redel-movil-app/builds/8dc451a5-c953-4e44-9113-b283531d4083

## Pendiente / TODO

- [ ] Completar sección Operaciones → "Mis Solicitudes" (ver estado de solicitudes enviadas)
- [ ] Sync: detectar borrados (soft-delete con activo=false en KarolayJeansERP)
- [ ] Configurar auto-build desde GitHub

## Notas técnicas

- **expo-sqlite v16 con API SYNC** — la API async tiene NullPointerException en Expo Go. NO usar `openDatabaseAsync`, `getAllAsync`, etc. Usar `openDatabaseSync`, `getAllSync`, `getFirstSync`, `execSync`.
- **Parámetros SQL**: NO usar bind params (`?`) con `getAllSync`/`getFirstSync` — causa NullPointerException. En su lugar, la función `esc()` en localDB.ts escapa los valores y los inyecta directo en el SQL.
- **Booleans**: Railway/Django devuelve `true/false`, SQLite necesita `1/0`. La función `esc()` convierte automáticamente.
- **Orden almacenes**: custom hardcoded en queries.ts: A11, A20, B80, B77, C26, Almacen 1, Almacen 2
- Los barcodes se padean a 13 dígitos con `padStart(13, '0')` antes de buscar
- La app NO crea ni modifica productos, variantes, stock directamente
- Login va directo a Railway (JWT) — hace trim + lowercase del username
- **Almacenes color_hex**: la tabla almacenes tiene `color_hex`. Al replicar el scanner, agregar esta columna al SQLite local (localDB.ts createTables) y al sync (sync.ts).
- **Scanner replicable**: ver `Scanner_RedelERP_Instrucciones.txt` en el Escritorio para instrucciones completas. La función `escanearProducto()` en queries.ts ya implementa la lógica central (tallas hermanas, colores disponibles, stock por almacén).
- **Filtros UX**: usar pills para categoría, subcategoría, género, talla (Casaca→alfabéticas), almacén (con color_hex de BD + textForBg). Selects solo para marca/fit. Ocultar "Unisex" de género.
- **Conteo — selección de modelos**: `selectedModelos` en Preparacion usa `null` para "todo seleccionado" (evita timing issue con useEffect). Solo se convierte en `Set<string>` cuando el usuario hace una selección explícita. `filasForConteo` devuelve todas las filas si `selectedModelos === null`.
- **Conteo — agrupación preview**: `previewGrupos` agrupa `previewData.variantes` por `producto_id` → colores → tallas. Incluye metadata (categoria, subcategoria, genero, marca, fit) del primer variante del producto para mostrar `InfoTag` en la tarjeta.
- **`ConteoFila`** tiene campo `producto_id?: string` para filtrar selección por modelo.
