import initWasm, { analyze_audio_buffer, analyzer_version } from 'wasm_analyzer';
import wasmUrl from 'wasm_analyzer/wasm_analyzer_bg.wasm?url';

// Fetch the wasm as bytes and instantiate those, rather than letting wasm-bindgen use
// WebAssembly.instantiateStreaming — which warns and falls back on any server that serves
// .wasm as application/octet-stream (Python's http.server, some static hosts). Streaming
// buys nothing for a local file, so this just silences the MIME warning everywhere.
export async function initWasmBytes() {
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  return initWasm(bytes);
}

let ready = false;
initWasmBytes().then(() => {
    ready = true;
    postMessage({ type: 'ready', version: analyzer_version() });
}).catch(err => {
    postMessage({ type: 'init_error', error: String(err) });
});

onmessage = async (e) => {
    if (e.data.type === 'ping') {
        if (ready) postMessage({ type: 'ready' });
        return;
    }
    const { id, buffer, name, folder } = e.data;
    if (!ready) {
        postMessage({ type: 'result', id, error: 'WASM not ready' });
        return;
    }
    try {
        const uint8Array = new Uint8Array(buffer);
        const jsonResult = analyze_audio_buffer(uint8Array, name, folder);
        postMessage({ type: 'result', id, result: jsonResult });
    } catch (err) {
        postMessage({ type: 'result', id, error: String(err) });
    }
};
