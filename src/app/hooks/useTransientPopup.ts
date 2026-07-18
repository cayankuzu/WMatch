import { useCallback, useEffect, useRef, useState } from 'react';

export default function useTransientPopup(defaultDurationMs = 1800) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hidePopup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setMessage(null);
  }, []);

  const showPopup = useCallback((nextMessage: string, durationMs = defaultDurationMs) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setMessage(nextMessage);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setMessage(null);
    }, durationMs);
  }, [defaultDurationMs]);

  useEffect(() => hidePopup, [hidePopup]);

  return {
    message,
    visible: message != null,
    showPopup,
    hidePopup,
  };
}
