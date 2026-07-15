// A tiny, framework-free "Install app" affordance. Chromium browsers fire
// `beforeinstallprompt` once the PWA is installable (valid manifest + service worker +
// HTTPS/localhost); we stash the event and show a button that opens the native install
// dialog. iOS/Safari don't fire it — there install is manual (Share → Add to Home Screen),
// so nothing shows, which is correct. Kept out of React so it doesn't touch app UI code.
let deferred: (Event & { prompt: () => void; userChoice: Promise<unknown> }) | null = null;
const BTN_ID = 'pwa-install-btn';

export function setupInstallPrompt() {
  // Skip inside the Tauri desktop app (already native) and when already installed.
  if ((window as any).__TAURI_INTERNALS__) return;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferred = e as any;
    showButton();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    document.getElementById(BTN_ID)?.remove();
  });
}

function showButton() {
  if (document.getElementById(BTN_ID)) return;
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.textContent = '⬇ Install app';
  btn.title = 'Install Scanalyzer to your desktop / home screen';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '14px', left: '14px', zIndex: '2147483000',
    background: '#f4902c', color: '#000', border: 'none', borderRadius: '6px',
    padding: '0.5rem 0.85rem', fontSize: '0.85rem', fontWeight: '600',
    cursor: 'pointer', boxShadow: '0 3px 12px rgba(0,0,0,0.5)', fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  btn.onclick = async () => {
    if (!deferred) return;
    btn.disabled = true;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* dismissed */ }
    deferred = null;
    btn.remove();
  };
  document.body.appendChild(btn);
}
