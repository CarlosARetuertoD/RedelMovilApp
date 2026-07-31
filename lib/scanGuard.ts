import { useCallback, useRef } from 'react';

// Cuánto tiempo sin que la cámara detecte NINGÚN código hace falta para soltar el candado.
// Mientras siga viendo un código (el mismo u otro) el candado se mantiene tomado — así
// sostener la prenda frente a la cámara más de lo esperado no dispara un segundo escaneo
// del mismo código, y una sola lectura física no puede colar dos llamadas por una condición
// de carrera entre frames. Se libera recién cuando la cámara deja de ver algo por este lapso,
// que en la práctica coincide con el gesto natural de apartarla para apuntar a la siguiente prenda.
const IDLE_RELEASE_MS = 700;

export function useScanGuard() {
  const lockedRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guard = useCallback((data: string, onAccepted: (data: string) => void) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { lockedRef.current = false; }, IDLE_RELEASE_MS);

    if (lockedRef.current) return;
    lockedRef.current = true;
    onAccepted(data);
  }, []);

  const reset = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    lockedRef.current = false;
  }, []);

  return { guard, reset };
}
