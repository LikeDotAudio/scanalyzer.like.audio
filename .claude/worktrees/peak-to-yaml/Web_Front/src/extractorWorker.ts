// The Extractor's cutting engine, off the main thread. Holds ONE ExtractorSession (the
// decoded PCM + its envelope live in wasm), so live slider re-detects only send a small
// params string — the multi-megabyte buffer crosses the boundary once, on load. This is
// what keeps the UI from freezing while you drag the detection sliders.
import initWasm, { ExtractorSession, extractor_version } from 'wasm_extractor';
import wasmUrl from 'wasm_extractor/wasm_extractor_bg.wasm?url';

// Fetch the wasm as bytes and instantiate those (see wasmWorker.ts) so a wrong .wasm MIME
// type doesn't trigger the instantiateStreaming warning/fallback.
async function initWasmBytes() {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  return initWasm(bytes);
}

let ready = false;
let session: ExtractorSession | null = null;

initWasmBytes().then(() => {
  ready = true;
  postMessage({ type: 'ready', version: extractor_version() });
});

onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (!ready) {
    postMessage({ type: 'result', id: msg.id, error: 'extractor wasm not ready' });
    return;
  }
  try {
    switch (msg.type) {
      case 'load': {
        // msg.samples is a transferred ArrayBuffer of Float32 mono PCM.
        session = new ExtractorSession(new Float32Array(msg.samples), msg.sampleRate);
        postMessage({ type: 'result', id: msg.id, result: 'ok' });
        break;
      }
      case 'detect': {
        if (!session) throw new Error('no session loaded');
        postMessage({ type: 'result', id: msg.id, result: session.detect(msg.paramsJson) });
        break;
      }
      case 'sliceWav': {
        if (!session) throw new Error('no session loaded');
        const bytes: Uint8Array = session.slice_wav(msg.regionJson);
        // A slice is small; structured-clone copy is fine (no transferable-overload fuss).
        postMessage({ type: 'result', id: msg.id, result: bytes });
        break;
      }
      case 'analyzeChunk': {
        if (!session) throw new Error('no session loaded');
        postMessage({
          type: 'result',
          id: msg.id,
          result: session.analyze_chunk(msg.regionJson, msg.name, msg.folder),
        });
        break;
      }
      default:
        throw new Error(`unknown message ${msg.type}`);
    }
  } catch (err) {
    postMessage({ type: 'result', id: msg.id, error: String(err) });
  }
};
