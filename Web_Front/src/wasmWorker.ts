import initWasm, { analyze_audio_buffer, analyzer_version } from 'wasm_analyzer';

let ready = false;
initWasm().then(() => {
    ready = true;
    postMessage({ type: 'ready', version: analyzer_version() });
});

onmessage = async (e) => {
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
