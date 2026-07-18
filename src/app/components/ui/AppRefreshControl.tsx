import { RefreshControl, type RefreshControlProps } from 'react-native';

import { theme } from '../../../shared/theme';

type AppRefreshControlProps = Omit<
  RefreshControlProps,
  'colors' | 'progressBackgroundColor' | 'tintColor'
>;

export default function AppRefreshControl(props: AppRefreshControlProps) {
  return (
    <RefreshControl
      {...props}
      tintColor={theme.colors.primarySoft}
      colors={[theme.colors.primarySoft]}
      progressBackgroundColor={theme.colors.backgroundElevated}
    />
  );
}
