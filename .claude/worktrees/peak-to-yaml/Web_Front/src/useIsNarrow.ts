import { useEffect, useState } from 'react';

// True on narrow (mobile) viewports. Layouts that tile side-by-side on desktop —
// the scope chip grid, the 2D charts — collapse to a single stacked column here.
// Kept in sync with a media query so it tracks orientation / resize changes.
export function useIsNarrow(maxWidthPx = 640): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [maxWidthPx]);
  return narrow;
}
