import { fireEvent, render } from '@testing-library/react-native';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BottomNav from '../../src/app/components/BottomNav';
import AccessibleModal from '../../src/app/components/ui/AccessibleModal';
import AppButton from '../../src/app/components/ui/AppButton';
import AppRefreshControl from '../../src/app/components/ui/AppRefreshControl';
import DataState from '../../src/app/components/ui/DataState';
import { LocalizationProvider } from '../../src/context/LocalizationContext';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('shared UI states', () => {
  it('exposes loading button semantics and blocks duplicate presses', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <AppButton
        title="Gönder"
        loading
        loadingTitle="Gönderiliyor"
        onPress={onPress}
      />,
    );
    const button = screen.getByRole('button', { name: 'Gönder' });

    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
    expect(screen.getByText('Gönderiliyor')).toBeTruthy();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces fatal errors and runs the retry action once', async () => {
    const onRetry = jest.fn();
    const screen = await render(
      <DataState
        state="fatal-error"
        title="Yüklenemedi"
        description="Bağlantını kontrol et."
        actionLabel="Tekrar dene"
        onAction={onRetry}
      />,
    );

    expect(screen.root.props.accessibilityRole).toBe('alert');
    fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('traps accessibility navigation inside the shared native modal primitive', async () => {
    const screen = await render(
      <AccessibleModal visible transparent onRequestClose={jest.fn()}>
        <Text>Modal content</Text>
      </AccessibleModal>,
    );

    let modalRoot = screen.getByText('Modal content').parent;
    while (modalRoot && modalRoot.props.accessibilityViewIsModal !== true) {
      modalRoot = modalRoot.parent;
    }

    expect(modalRoot).not.toBeNull();
    expect(modalRoot?.props.importantForAccessibility).toBe('yes');
    expect(modalRoot?.props.collapsable).toBe(false);
  });

  it('keeps the bottom navigation in a bounded normal-flow container', async () => {
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 44, right: 0, bottom: 34, left: 0 },
        }}
      >
        <LocalizationProvider>
          <BottomNav activeTab="watch" onTabChange={jest.fn()} />
        </LocalizationProvider>
      </SafeAreaProvider>,
    );
    let tabList = screen.getByRole('tab', { name: 'Watch' }).parent;
    while (tabList && tabList.props.accessibilityRole !== 'tablist') {
      tabList = tabList.parent;
    }
    expect(tabList).not.toBeNull();
    const wrapperStyle = StyleSheet.flatten(tabList?.parent?.props.style);

    expect(wrapperStyle.width).toBe('100%');
    expect(wrapperStyle.position).toBeUndefined();
    expect(wrapperStyle.zIndex).toBeUndefined();
    expect(wrapperStyle.elevation).toBeUndefined();
    expect(tabList?.parent?.props.pointerEvents).toBe('box-none');
  });

  it('forwards the Android ScrollView child through the shared refresh control', async () => {
    const screen = await render(
      <ScrollView
        refreshControl={<AppRefreshControl refreshing={false} onRefresh={jest.fn()} />}
      >
        <Text>Scrollable content</Text>
      </ScrollView>,
    );

    expect(screen.getByText('Scrollable content')).toBeTruthy();
  });

});
