import { useEffect, useRef, useState } from 'react';

import { theme } from '../../shared/theme';

/** Prevents short operations from flashing a spinner while keeping longer work honest. */
export default function useDelayedBusy(
  busy: boolean,
  delayMs = theme.motion.loadingDelay,
  minimumVisibleMs = theme.motion.loadingMinimum,
) {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (busy && !visible) {
      timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delayMs);
    } else if (!busy && visible) {
      const remaining = Math.max(0, minimumVisibleMs - (Date.now() - shownAtRef.current));
      timer = setTimeout(() => setVisible(false), remaining);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [busy, delayMs, minimumVisibleMs, visible]);

  return visible;
}
