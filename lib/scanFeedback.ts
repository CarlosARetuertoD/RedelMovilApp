import { Vibration } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// Se cargan una sola vez (no en cada escaneo) para que el sonido salga sin demora perceptible.
let okPlayer: AudioPlayer | null = null;
let errorPlayer: AudioPlayer | null = null;

function getPlayer(kind: 'ok' | 'error'): AudioPlayer | null {
  try {
    if (kind === 'ok') {
      if (!okPlayer) okPlayer = createAudioPlayer(require('../assets/sounds/scan-ok.wav'));
      return okPlayer;
    }
    if (!errorPlayer) errorPlayer = createAudioPlayer(require('../assets/sounds/scan-error.wav'));
    return errorPlayer;
  } catch {
    // Requiere el módulo nativo de expo-audio (APK/dev build nuevo) — en un build viejo
    // simplemente no suena, la vibración sigue funcionando igual.
    return null;
  }
}

async function play(player: AudioPlayer | null) {
  if (!player) return;
  try {
    await player.seekTo(0);
    player.play();
  } catch {
    // Silencioso a propósito: nunca debe interrumpir el flujo de escaneo.
  }
}

/** Feedback de escaneo aceptado: beep agudo corto + vibración 80ms. */
export function scanFeedbackOk() {
  Vibration.vibrate(80);
  play(getPlayer('ok'));
}

/** Feedback de escaneo rechazado (no encontrado / sin stock / tope alcanzado): dos beeps graves + vibración 300ms. */
export function scanFeedbackError() {
  Vibration.vibrate(300);
  play(getPlayer('error'));
}
