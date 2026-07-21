import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

import useDelayedBusy from '../../hooks/useDelayedBusy';

interface DelayedActivityIndicatorProps extends ActivityIndicatorProps {
  active?: boolean;
}

export default function DelayedActivityIndicator({
  active = true,
  ...props
}: DelayedActivityIndicatorProps) {
  const visible = useDelayedBusy(active);
  return visible ? <ActivityIndicator {...props} /> : null;
}
