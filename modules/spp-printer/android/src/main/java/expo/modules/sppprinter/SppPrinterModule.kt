package expo.modules.sppprinter

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.concurrent.thread

/**
 * Impresión térmica Bluetooth SPP para KarolayJeansMovilApp.
 *
 * Port del puente de RedelPrint/Redel Kiosko (PrinterBridge + SppPrinter, verificado
 * en hardware con la ADV-9013N emparejada como "Thermal Printer"). El JS arma el
 * stream TSPL2 completo y lo pasa en base64; aquí solo se decodifica, se localiza la
 * impresora emparejada y se empuja por RFCOMM/SPP.
 */
class SppPrinterModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SppPrinter")

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Permissions.getPermissionsWithPermissionsManager(
          appContext.permissions, promise, Manifest.permission.BLUETOOTH_CONNECT,
        )
      } else {
        promise.resolve(grantedResponse())
      }
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Permissions.askForPermissionsWithPermissionsManager(
          appContext.permissions, promise, Manifest.permission.BLUETOOTH_CONNECT,
        )
      } else {
        promise.resolve(grantedResponse())
      }
    }

    AsyncFunction("printerStatus") { promise: Promise ->
      val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
      val device = findPrinter()
      val map = mutableMapOf<String, Any?>(
        "bluetoothOn" to (adapter?.isEnabled == true),
        "found" to (device != null),
      )
      if (device != null) {
        map["name"] = safeName(device) ?: ""
        map["address"] = device.address
      }
      promise.resolve(map)
    }

    AsyncFunction("printBase64") { b64: String, promise: Promise ->
      thread(name = "SppPrint") {
        promise.resolve(doPrint(b64))
      }
    }
  }

  // ───── impresión ─────

  private fun doPrint(b64: String): Map<String, Any?> {
    val bytes = try {
      Base64.decode(b64, Base64.DEFAULT)
    } catch (e: Exception) {
      return err("base64 inválido: ${e.message}")
    }
    if (bytes.isEmpty()) return err("stream de impresión vacío")

    val device = findPrinter()
      ?: return err("No hay impresora emparejada (busca ${PRINTER_NAME_HINTS.joinToString("/")})")

    val printer = Spp(device)
    return try {
      connectWithTimeout(printer, device)
      // La escritura NO lleva timeout: en un lote grande el write bloquea hasta que
      // la impresora drena su buffer; cortarlo truncaría la etiqueta a medias.
      printer.write(bytes)
      Log.i(TAG, "Impresos ${bytes.size} bytes a ${printerLabel(device)}")
      mapOf("ok" to true, "printer" to printerLabel(device), "bytes" to bytes.size)
    } catch (e: Exception) {
      val cause = if (e is ExecutionException) (e.cause ?: e) else e
      Log.w(TAG, "Error imprimiendo a ${printerLabel(device)}", cause)
      err(cause.message ?: "error de impresión")
    } finally {
      printer.close()
    }
  }

  private fun connectWithTimeout(printer: Spp, device: BluetoothDevice) {
    val exec = Executors.newSingleThreadExecutor()
    try {
      exec.submit { printer.connect() }.get(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (e: TimeoutException) {
      printer.close()
      throw IOException("Timeout conectando a ${printerLabel(device)} (apagada o fuera de rango)")
    } finally {
      exec.shutdownNow()
    }
  }

  @SuppressLint("MissingPermission") // BLUETOOTH_CONNECT se pide en runtime desde JS
  private fun findPrinter(): BluetoothDevice? {
    val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return null
    if (!adapter.isEnabled) return null
    val bonded = try {
      adapter.bondedDevices
    } catch (e: SecurityException) {
      Log.w(TAG, "Sin permiso para leer dispositivos emparejados", e)
      null
    } ?: return null
    return bonded.firstOrNull { d ->
      val n = safeName(d) ?: return@firstOrNull false
      PRINTER_NAME_HINTS.any { hint -> n.contains(hint, ignoreCase = true) }
    }
  }

  @SuppressLint("MissingPermission")
  private fun safeName(device: BluetoothDevice): String? = try {
    device.name
  } catch (_: SecurityException) {
    null
  }

  private fun printerLabel(device: BluetoothDevice): String =
    safeName(device) ?: device.address

  private fun err(message: String): Map<String, Any?> =
    mapOf("ok" to false, "error" to message)

  private fun grantedResponse(): Map<String, Any?> =
    mapOf("status" to "granted", "granted" to true, "canAskAgain" to true, "expires" to "never")

  /**
   * Transporte RFCOMM/SPP — mismo workaround que RedelPrint: si el connect estándar
   * falla (módulos SPP baratos sin service record), reintenta por reflexión canal 1.
   */
  @SuppressLint("MissingPermission")
  private class Spp(private val device: BluetoothDevice) {
    private var socket: BluetoothSocket? = null
    private var output: OutputStream? = null

    @Throws(IOException::class)
    fun connect() {
      val primary = device.createRfcommSocketToServiceRecord(SPP_UUID)
      try {
        primary.connect()
        socket = primary
        output = primary.outputStream
        return
      } catch (first: IOException) {
        try { primary.close() } catch (_: IOException) {}
        Log.w(TAG, "connect estándar falló (${first.message}); intentando fallback canal 1")
        val fallback = try {
          val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          (m.invoke(device, 1) as BluetoothSocket).also { it.connect() }
        } catch (second: Exception) {
          throw IOException(
            "No se pudo abrir SPP con ${device.address}: " +
              "estándar='${first.message}', fallback='${second.message}'",
            first,
          )
        }
        socket = fallback
        output = fallback.outputStream
      }
    }

    @Throws(IOException::class)
    fun write(bytes: ByteArray) {
      val out = output ?: throw IOException("Impresora no conectada")
      out.write(bytes)
      out.flush()
    }

    fun close() {
      try { output?.flush() } catch (_: IOException) {}
      try { output?.close() } catch (_: IOException) {}
      try { socket?.close() } catch (_: IOException) {}
      output = null
      socket = null
    }
  }

  companion object {
    private const val TAG = "SppPrinter"
    private const val CONNECT_TIMEOUT_MS = 8_000L

    /** UUID estándar de Serial Port Profile (SPP). */
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** Nombres Bluetooth con los que puede aparecer la impresora (igual que RedelPrint). */
    val PRINTER_NAME_HINTS =
      listOf("HL80", "ADV-9013N", "ADV9013", "ADV-9013", "Thermal Printer", "Thermal", "Printer")
  }
}
