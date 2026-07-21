import { useEffect } from 'react';

import { subscribeToTabReselect } from '../../services/tabNavigation';
import type { AppTab } from '../../shared/types';

export default function useTabReselect(tab: AppTab, listener: () => void) {
  useEffect(() => subscribeToTabReselect(tab, listener), [listener, tab]);
}
