import { Component, type ReactNode } from 'react';

/** Whether the browser/webview can actually create a WebGL context. Some environments —
 *  headless runs, a sandboxed webview with the GPU disabled, hardware acceleration turned
 *  off — hand back no context, and three.js throws when it can't make a renderer. Checking
 *  first lets the 3D view degrade to a message instead of an uncaught error. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Free the probe context so it doesn't count against the browser's context limit.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/** Backstop for a WebGL/three.js init throw that slips past the pre-check (a context is
 *  granted but then fails on real use): render the fallback instead of taking down the app. */
export class WebGLBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  componentDidCatch() {
    /* swallow — the fallback already explains the 3D view is unavailable */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
