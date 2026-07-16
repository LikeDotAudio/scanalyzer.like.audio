import { useEffect, useState } from 'react';

// True on narrow (mobile / tablet) viewports. Layouts that tile side-by-side on desktop —
// the scope chip grid, the 2D charts, the Examiner's table-over-detail split — collapse to a
// single stacked column here. The 1024px cutoff catches both portrait (768) and landscape
// (1024) tablets; laptops/desktops (≥1025) keep the side-by-side layout.
// Kept in sync with a media query so it tracks orientation / resize changes.
export function useIsNarrow(maxWidthPx = 1024): boolean {
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
