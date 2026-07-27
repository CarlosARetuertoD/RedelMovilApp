/**
 * API JS del módulo nativo SppPrinter (Bluetooth SPP → impresora térmica).
 *
 * En Expo Go el módulo nativo no existe: `requireOptionalNativeModule` devuelve
 * null y todas las funciones degradan con un error claro — el resto de la app
 * sigue funcionando. Para imprimir se necesita el development build / APK
 * (`eas build`), que compila modules/spp-printer/android.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface PrinterStatus {
  bluetoothOn: boolean;
  found: boolean;
  name?: string;
  address?: string;
}

export interface PrintResult {
  ok: boolean;
  printer?: string;
  bytes?: number;
  error?: string;
}

interface PermissionResponse {
  status: string;
  granted: boolean;
  canAskAgain?: boolean;
}

interface SppPrinterNative {
  printerStatus(): Promise<PrinterStatus>;
  printBase64(b64: string): Promise<PrintResult>;
  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
}

const native = requireOptionalNativeModule<SppPrinterNative>('SppPrinter');

export const NO_NATIVE_MSG =
  'Impresión no disponible en Expo Go — instala el build nativo (eas build)';

/** ¿Está compilado el módulo nativo? (false en Expo Go) */
export function isNativePrinterAvailable(): boolean {
  return native != null;
}

export async function printerStatus(): Promise<PrinterStatus> {
  if (!native) return { bluetoothOn: false, found: false };
  try {
    return await native.printerStatus();
  } catch {
    return { bluetoothOn: false, found: false };
  }
}

export async function printBase64(b64: string): Promise<PrintResult> {
  if (!native) return { ok: false, error: NO_NATIVE_MSG };
  try {
    return await native.printBase64(b64);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'error de impresión' };
  }
}

/** Pide el permiso BLUETOOTH_CONNECT (runtime en Android 12+). */
export async function requestBluetoothPermission(): Promise<boolean> {
  if (!native) return false;
  try {
    const r = await native.requestPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}

export async function hasBluetoothPermission(): Promise<boolean> {
  if (!native) return false;
  try {
    const r = await native.getPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}
