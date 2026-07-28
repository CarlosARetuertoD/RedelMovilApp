# KarolayJeansMovilApp — Guía completa

## Qué es

App móvil de inventario para **Negocios e Inversiones Karolay** (tienda de ropa). Permite al personal de almacén consultar productos, trasladar stock entre almacenes (con impresión de etiquetas), confirmar ingresos de lotes desde Almacén Principal (solo admin/supervisor) y escanear códigos de barras usando **pistola láser USB** o **cámara del celular** (expo-camera).

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
- **Zustand 5** (auth, sync, settings stores)
- **TanStack React Query 5** (server state/cache)
- **expo-sqlite 16** (BD local offline-first)
- **expo-camera 17** (escaneo con cámara)
- **react-native-webview** (rasterizado de etiquetas a TSPL2 en WebView oculto)
- **expo-dev-client** (development build — necesario porque hay módulo nativo propio)
- **Módulo nativo local `modules/spp-printer`** (Kotlin, Bluetooth SPP → impresora térmica)
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
    La app (escáner, consultas, traslados, ingresos)
            │
            └── POST /api/operaciones/encolar/ o /registrar/  ──► Traslados enviados a Railway
            └── POST /api/inventario/distribuciones/<id>/enviar-a-tiendas/  ──► Ingresos confirmados
```

### Lectura (todo desde SQLite local):
- Escáner, Consultas, Traslados → leen de SQLite, NUNCA directo a la red
- Catálogos (marcas, fits, colores, tallas, etc.) → cacheados en memoria desde SQLite
- **Ingresos es la excepción**: el listado de "pendiente en Principal" es estado live del ERP (no está en el sync de SQLite), se pide directo a Railway cada vez que se abre la pantalla

### Escritura (directo a Railway):
- Traslado (almacenero) → `POST /api/operaciones/encolar/` (cola de aprobación)
- Traslado (admin/supervisor) → `POST /api/operaciones/registrar/` (uno por item, directo)
- Ingreso (solo admin/supervisor) → `POST /api/inventario/distribuciones/<id>/enviar-a-tiendas/` (uno por lote involucrado, sin cola de aprobación — no existe ese tipo_operacion en el backend)
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
- `POST /api/operaciones/encolar/` — traslado de almacenero (a cola de aprobación)
- `POST /api/operaciones/registrar/` — traslado directo (admin/supervisor, un POST por item)
- `GET /api/plantillas-etiqueta/` — plantilla de etiqueta 50×25 (elementos + es_default)
- `GET /api/inventario/distribuciones/pendiente-principal/` — lotes con items pendientes en Almacén Principal
- `POST /api/inventario/distribuciones/<id>/enviar-a-tiendas/` — confirma ingreso (Fase 2), body `{items:[{detalle_id,cantidad}]}`

## Estructura del proyecto

```
KarolayJeansMovilApp/
├── app/
│   ├── _layout.tsx              # Root: AuthGate + Sync + SplashScreen
│   ├── login.tsx                # Login contra Railway
│   ├── perfil.tsx               # Perfil: user info, sync manual, config escáner
│   └── (tabs)/
│       ├── _layout.tsx          # Tab navigator (initialRouteName: escaner; ingresos oculto para almacenero)
│       ├── consultas.tsx        # Consultas
│       ├── escaner.tsx          # Escáner con cámara + pistola
│       ├── traslados.tsx        # Traslado entre almacenes + impresión de etiquetas
│       └── ingresos.tsx         # Confirmar ingreso de lotes (Fase 2) — solo admin/supervisor
├── components/
│   └── LabelRenderer.tsx        # WebView oculto: etiquetas → TSPL2 base64 (promesa)
├── lib/
│   ├── railway.ts               # Cliente HTTP a Railway (railwayGet, railwayPost + JWT)
│   ├── localDB.ts               # SQLite: tablas, upsert, queries
│   ├── sync.ts                  # Sync Railway → SQLite
│   ├── queries.ts               # Todas las consultas (leen de SQLite)
│   ├── distribuciones.ts        # Ingresos de Stock: pendiente-principal + enviar-a-tiendas (Railway directo)
│   ├── labelPrint.ts            # Plantilla ERP + HTML del renderizador TSPL2
│   ├── vendor/jsbarcodeSource.ts# Bundle UMD de jsbarcode como string (generado, no editar)
│   ├── colors.ts                # Paleta mocha/carbon
│   └── types.ts                 # Interfaces TypeScript
├── modules/
│   └── spp-printer/             # Módulo nativo local (Expo Modules API)
│       ├── index.ts             # API JS (printerStatus, printBase64, permisos; null-safe en Expo Go)
│       ├── expo-module.config.json
│       └── android/…/SppPrinterModule.kt  # Port del PrinterBridge+SppPrinter de RedelPrint
├── store/
│   ├── authStore.ts             # Login/logout/session contra Railway
│   ├── syncStore.ts             # Estado de sincronización
│   └── settingsStore.ts         # Configuración (modo escáner)
├── app.json
├── package.json
├── tsconfig.json
└── babel.config.js
```

## Impresión de etiquetas (Bluetooth térmica) — 2026-07-18

Mismo pipeline que la PWA en la tablet (KarolayJeansApp + RedelPrint), pero autocontenido:

```
plantilla (GET /api/plantillas-etiqueta/, la es_default)
  → LabelRenderer (WebView oculto): canvas + jsbarcode CODE128 → BITMAP TSPL2 → base64
    → modules/spp-printer (Kotlin): Bluetooth SPP → ADV-9013N / HL80 ("Thermal Printer")
```

- **Protocolo TSPL2** idéntico al de la PWA (`labelPrint.ts` es un port 1:1 del de KarolayJeansApp):
  etiqueta 50×25mm, 203dpi (8 dots/mm), cabecera capturada de la app oficial, barcode sin antialias.
- **El Kotlin es un port del PrinterBridge/SppPrinter de RedelPrint** (verificado en hardware):
  mismos name hints, mismo timeout de connect 8s (write sin timeout), mismo fallback reflexión canal 1.
  Regla del ecosistema: si cambia el puente en RedelPrint/Kiosko, revisar este port.
- **Permiso**: BLUETOOTH_CONNECT se pide en runtime (Android 12+). La impresora debe estar
  **emparejada** en los Ajustes de Bluetooth del celular (una sola vez).
- **En Expo Go NO imprime** (módulo nativo ausente): `requireOptionalNativeModule` devuelve null
  y la UI muestra "requiere APK nativo". Todo lo demás de la app sigue funcionando en Expo Go.

## Pantallas

### Tabs (orden): Escáner → Consultas → Traslado → Ingresos (Ingresos solo visible para admin/supervisor)
(2026-07-27: se eliminaron definitivamente Conteo, Operaciones, Movimientos e index.tsx —
código muerto sin uso; ver "Notas técnicas" para detalle. `escaner` es la ruta inicial via
`unstable_settings` en `_layout.tsx`. Mismo día se agregó el tab Ingresos.)

### 1. Consultas (`app/(tabs)/consultas.tsx`)
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

### 3. Traslados (`app/(tabs)/traslados.tsx`)
- **Origen → Destino**: pills horizontales con `color_hex` de BD + `textForBg()` (destino excluye el origen). Barra de ruta visual al quedar ambos elegidos
- **Escaneo**: al armar la ruta se abre la **cámara automáticamente** (sin teclado — pide permiso si falta). El cuadro de texto queda debajo como alternativa (pistola / tipeo manual); el teclado solo aparece si el usuario lo toca. Re-escanear el mismo código incrementa cantidad (capado al stock del origen)
- Valida stock en origen desde SQLite (`escanearProducto`); vibración 80ms OK / 300ms error
- **Lista de items**: cantidad con stepper +/- (máx = stock origen), eliminar
- **Ejecutar** según rol: almacenero → `POST /api/operaciones/encolar/` ("Enviado para aprobación"); admin/supervisor → `POST /api/operaciones/registrar/` por item (junta errores por item). Tras registrar directo dispara `syncDatabase()` para refrescar stock local
- **Impresión de etiquetas**: toggle "Imprimir etiquetas" (default ON) + chip de estado de impresora (tap = refrescar). Imprime al ejecutar y hay botón Imprimir/Reimprimir en la pantalla de resultado
- Pantalla de resultado: header ✓/⚠, errores por item si los hay, estado de impresión, "Nuevo traslado"

### 4. Ingresos (`app/(tabs)/ingresos.tsx`) — solo admin/supervisor
Confirma la **Fase 2 ("Enviar a Tiendas")** del flujo "Ingresos de Stock" / "Lotes Por Ingresar" del ERP
(modelo `Distribucion`/`DistribucionDetalle`, app Django `inventario`). La Fase 1 (armar el lote,
"Recibir en Principal", que es cuando se consume la etiqueta física) sigue siendo tarea de escritorio
en KarolayJeansApp — esta pantalla solo cubre la entrega física del Almacén Principal al destino final.
- **Destino**: pills horizontales (mismo filtro que Traslados, excluye Almacén Principal — acá es el origen implícito)
- Al elegir destino, pide `GET /api/inventario/distribuciones/pendiente-principal/` (Railway directo, no SQLite)
  y muestra cuántas referencias/prendas hay pendientes de ingresar a ese almacén
- **Escaneo**: cámara automática igual que Traslados. Cada scan resuelve el código de barras a `variante_id`
  vía `escanearProducto()` (SQLite local) y lo cruza contra los items pendientes del destino elegido
- Si la variante no tiene nada pendiente para ese destino → error (rojo, vibración 300ms)
- **Multi-lote**: si la misma variante+destino tiene pendiente repartido en varios lotes, se reparte
  FIFO por fecha (orden que ya devuelve el backend) al momento de "Ejecutar" — el usuario no necesita saber
  a qué lote pertenece cada unidad física
- **Ejecutar**: agrupa los items del carrito por `distribucion_id` y llama `enviar-a-tiendas` una vez
  por lote involucrado (body `{items:[{detalle_id,cantidad}]}`). **Esto SÍ mueve stock real**
  (TRASLADO Almacén Principal → destino) — lo que NO se vuelve a tocar es el conteo de etiquetas,
  ya consumido en Fase 1. Tras ejecutar dispara `syncDatabase()` y refresca el pendiente
- **Sin cola de aprobación**: no existe `tipo_operacion` encolable para esta fase en el backend — por eso
  la pantalla completa está oculta para `rol === 'almacenero'` en `_layout.tsx` (`href: null`), no solo
  el botón de ejecutar

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
| `fetchVariantesConStock(filtros)` | SQLite | Para consultas y traslados, con stock por almacén |
| `fetchTopMarcasYFits(filtros)` | SQLite | Top marcas/fits para pills inline |
| `fetchFilterOptions()` | SQLite | Opciones de filtro (categorías, tallas, etc.) |
| `parseSmartSearch(input)` | Memoria | Detecta filtros en texto libre |
| `fetchPlantillaEtiqueta()` (labelPrint.ts) | Railway | GET /api/plantillas-etiqueta/ (la es_default) |

## Desarrollo

> ⚠️ Desde que existe el módulo nativo `spp-printer`, con `expo-dev-client` instalado
> `npx expo start` apunta por defecto al **development build**. Para Expo Go usar `--go`.

```bash
# Dev con el development build instalado en el celular (recomendado — imprime de verdad)
npx expo start --clear

# Dev con Expo Go (todo funciona MENOS imprimir; el módulo nativo degrada con aviso)
npx expo start --clear --go

# Celular y PC en la misma red WiFi, o:
npx expo start --tunnel
```

### Development build (una vez, y cada vez que cambie el módulo nativo)
```bash
eas build --platform android --profile development
```
Genera un APK con dev-client: se instala en el celular y reemplaza a Expo Go para
desarrollo (hot reload igual). Solo hay que regenerarlo si cambia código nativo
(modules/spp-printer) o se agregan libs nativas — el JS/TS se sigue recargando en vivo.

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
- **development** → `.apk` con expo-dev-client (reemplaza a Expo Go para desarrollo; imprime de verdad)
- **preview** → genera `.apk` (instalación directa, para testing y distribución interna)
- **production** → genera `.aab` (para subir a Google Play Store)

Los tres compilan el módulo nativo `modules/spp-printer` (autolinking de Expo Modules).

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
- **2026-07-27 — Conteo, Operaciones, Movimientos e index.tsx eliminados definitivamente**: eran código muerto (Conteo llevaba oculto desde 07-18 sin plan de retomarlo; Operaciones/Movimientos placeholders sin implementación; index.tsx era solo un redirect a /escaner, reemplazado por `unstable_settings.initialRouteName` en `_layout.tsx`). Se borró también `store/conteoStore.ts` (sin otros consumidores) y `crearSolicitud()` de `queries.ts` (solo la usaba Conteo). Si se recupera la necesidad de conteo de inventario, recrear desde el historial de git (`git log --diff-filter=D -- "app/(tabs)/conteo.tsx"`).
- **Impresión SPP**: el módulo nativo (`modules/spp-printer`) es un port del PrinterBridge/SppPrinter de RedelPrint — mismos name hints ("Thermal Printer", ADV-9013N, HL80…), connect con timeout 8s + fallback reflexión canal 1, write sin timeout. Si cambia el puente en RedelPrint/Redel Kiosko, revisar este port.
- **Rasterizado de etiquetas**: RN no tiene canvas — se hace en un WebView oculto (`components/LabelRenderer.tsx`) con el HTML de `lib/labelPrint.ts` (port 1:1 del labelPrint.ts de la PWA: canvas 400×200, serif, CODE128 sin suavizado, TSPL2). jsbarcode va vendorizado como string en `lib/vendor/jsbarcodeSource.ts` (regenerar con Node desde node_modules de KarolayJeansApp si se actualiza).
- **Expo Go sigue sirviendo** para todo menos imprimir: `requireOptionalNativeModule('SppPrinter')` devuelve null y la UI lo indica. Con expo-dev-client instalado, `npx expo start` apunta al dev build; usar `--go` para Expo Go.
- **Ingresos (2026-07-27)**: decisión explícita de Carlos — solo cubre Fase 2 (Enviar a Tiendas) y solo
  admin/supervisor puede ejecutarla, replicando la regla que ya existe en el proxy Next.js de KarolayJeansApp
  (`SOLO_EJECUCION_DIRECTA`), que Django no aplica del lado del servidor. Si más adelante se quiere que
  almacenero también pueda confirmar ingresos desde el celular, hace falta agregar `ENVIAR_A_TIENDAS` como
  `tipo_operacion` encolable en KarolayJeansERP (`apps/operaciones/views.py::EncolarPendienteView` y
  `apps/sync/views.py::_process_movement_rows()`) — hoy esa cola solo soporta `RECIBIR_EN_PRINCIPAL`.
  El endpoint `enviar-a-tiendas` es por lote (`distribucion_id` en la URL), no por variante — por eso
  `ingresos.tsx` agrupa el carrito por lote antes de ejecutar.
