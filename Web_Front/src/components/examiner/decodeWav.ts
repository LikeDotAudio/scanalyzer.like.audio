// A minimal, dependency-free WAV → AudioBuffer decoder.
//
// The desktop webview (WebKitGTK) intermittently fails Web Audio's decodeAudioData even on
// plain PCM WAV — the GStreamer path it delegates to is missing plug-ins — which left the
// Examiner's waveform + circular preview blank. Since most of the library is WAV, parsing
// the header ourselves is a reliable fallback that needs no native rebuild. (Playback still
// goes through the <audio> element, which decodes fine; this is only for the visual trace.)
//
// Handles PCM (8/16/24/32-bit), IEEE float (32-bit), and WAVE_FORMAT_EXTENSIBLE. Returns
// null for anything it can't parse (e.g. a compressed codec), so the caller can give up
// gracefully rather than crash.

export function decodeWav(data: ArrayBuffer, ctx: BaseAudioContext): AudioBuffer | null {
  try {
    const dv = new DataView(data);
    if (dv.byteLength < 44) return null;
    // "RIFF" .... "WAVE"
    if (dv.getUint32(0, false) !== 0x52494646 /* RIFF */) return null;
    if (dv.getUint32(8, false) !== 0x57415645 /* WAVE */) return null;

    let fmtOffset = -1, fmtSize = 0, dataOffset = -1, dataSize = 0;
    let pos = 12;
    while (pos + 8 <= dv.byteLength) {
      const id = dv.getUint32(pos, false);
      const size = dv.getUint32(pos + 4, true);
      const body = pos + 8;
      if (id === 0x666d7420 /* "fmt " */) { fmtOffset = body; fmtSize = size; }
      else if (id === 0x64617461 /* "data" */) { dataOffset = body; dataSize = size; }
      pos = body + size + (size & 1); // chunks are word-aligned
    }
    if (fmtOffset < 0 || dataOffset < 0) return null;

    let format = dv.getUint16(fmtOffset, true);
    const channels = dv.getUint16(fmtOffset + 2, true);
    const sampleRate = dv.getUint32(fmtOffset + 4, true);
    const bits = dv.getUint16(fmtOffset + 14, true);
    // WAVE_FORMAT_EXTENSIBLE: the real format code is the first 2 bytes of the SubFormat GUID.
    if (format === 0xfffe && fmtSize >= 26) format = dv.getUint16(fmtOffset + 24, true);
    if (!channels || !sampleRate || !bits) return null;

    const bytesPer = bits >> 3;
    const frameBytes = bytesPer * channels;
    if (!frameBytes) return null;
    const frames = Math.floor(Math.min(dataSize, dv.byteLength - dataOffset) / frameBytes);
    if (frames <= 0) return null;

    const isFloat = format === 3;
    const isPcm = format === 1;
    if (!isFloat && !isPcm) return null;

    const buffer = ctx.createBuffer(channels, frames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const out = buffer.getChannelData(ch);
      let p = dataOffset + ch * bytesPer;
      for (let i = 0; i < frames; i++, p += frameBytes) {
        let s: number;
        if (isFloat) {
          s = dv.getFloat32(p, true);
        } else if (bits === 16) {
          s = dv.getInt16(p, true) / 32768;
        } else if (bits === 24) {
          const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getUint8(p + 2);
          let v = b0 | (b1 << 8) | (b2 << 16);
          if (v & 0x800000) v |= ~0xffffff; // sign-extend 24 → 32 bit
          s = v / 8388608;
        } else if (bits === 32) {
          s = dv.getInt32(p, true) / 2147483648;
        } else if (bits === 8) {
          s = (dv.getUint8(p) - 128) / 128; // 8-bit WAV is unsigned
        } else {
          return null;
        }
        out[i] = s;
      }
    }
    return buffer;
  } catch {
    return null;
  }
}
