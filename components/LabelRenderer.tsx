/**
 * WebView oculto que rasteriza etiquetas a TSPL2 base64 (ver lib/labelPrint.ts).
 * Montarlo en la pantalla que imprime y llamar `ref.current.render(jobs)`.
 */
import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LABEL_RENDER_HTML, type LabelJob } from '../lib/labelPrint';

export interface LabelRendererHandle {
  /** Rasteriza los trabajos y devuelve el stream TSPL2 completo en base64. */
  render(jobs: LabelJob[]): Promise<string>;
}

type Pending = { resolve: (b64: string) => void; reject: (e: Error) => void };

const RENDER_TIMEOUT_MS = 20000;

const LabelRenderer = forwardRef<LabelRendererHandle>(function LabelRenderer(_, ref) {
  const webRef = useRef<WebView>(null);
  const pending = useRef(new Map<string, Pending>());
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    render(jobs: LabelJob[]) {
      return new Promise<string>((resolve, reject) => {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        pending.current.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.current.has(id)) {
            pending.current.delete(id);
            reject(new Error('Timeout generando etiquetas'));
          }
        }, RENDER_TIMEOUT_MS);
        const js = `window.__renderJobs(${JSON.stringify({ id, jobs })}); true;`;
        if (readyRef.current) webRef.current?.injectJavaScript(js);
        else queueRef.current.push(js);
      });
    },
  }));

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type === 'ready') {
      readyRef.current = true;
      queueRef.current.forEach(js => webRef.current?.injectJavaScript(js));
      queueRef.current = [];
      return;
    }
    const p = pending.current.get(msg?.id);
    if (!p) return;
    pending.current.delete(msg.id);
    if (msg.ok) p.resolve(msg.b64);
    else p.reject(new Error(msg.error || 'Error generando etiqueta'));
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 }}>
      <WebView
        ref={webRef}
        source={{ html: LABEL_RENDER_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        // si el renderer del WebView muere, re-crear y re-armar el ready
        onContentProcessDidTerminate={() => { readyRef.current = false; webRef.current?.reload(); }}
        onRenderProcessGone={() => { readyRef.current = false; webRef.current?.reload(); }}
      />
    </View>
  );
});

export default LabelRenderer;
