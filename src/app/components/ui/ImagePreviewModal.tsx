import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useMemo, useRef, useState } from 'react';

import { theme } from '../../../shared/theme';
import AppImage from './AppImage';
import { useLocalization } from '../../../context/LocalizationContext';
import AccessibleModal from './AccessibleModal';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string | null;
  images?: string[];
  initialIndex?: number;
  onClose: () => void;
}

export default function ImagePreviewModal({
  visible,
  imageUri,
  images,
  initialIndex = 0,
  onClose,
}: ImagePreviewModalProps) {
  const { t } = useLocalization();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<string> | null>(null);
  const resolvedImages = useMemo(
    () => (images && images.length > 0 ? images.filter((item) => item.trim().length > 0) : imageUri ? [imageUri] : []),
    [imageUri, images],
  );
  const boundedInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(resolvedImages.length - 1, 0));
  const [currentIndex, setCurrentIndex] = useState(boundedInitialIndex);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setCurrentIndex(boundedInitialIndex);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: boundedInitialIndex, animated: false });
    });
  }, [boundedInitialIndex, visible]);

  return (
    <AccessibleModal visible={visible && resolvedImages.length > 0} transparent animationType="fade" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
          <View style={styles.header}>
            {resolvedImages.length > 1 ? (
              <Text style={styles.counter}>{currentIndex + 1} / {resolvedImages.length}</Text>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.closeButton}
            >
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.white} />
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            horizontal
            pagingEnabled
            data={resolvedImages}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            removeClippedSubviews
            keyExtractor={(item, index) => `${item}-${index}`}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onScrollToIndexFailed={({ index }) => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index, animated: false });
              }, 50);
            }}
            onMomentumScrollEnd={(event) => {
              setCurrentIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1)));
            }}
            renderItem={({ item, index }) => (
              <Pressable accessible={false} onPress={onClose} style={[styles.imageWrap, { width }]}>
                <AppImage
                  contentFit="contain"
                  priority={index === currentIndex ? 'high' : 'normal'}
                  recyclingKey={item}
                  uri={item}
                  style={styles.image}
                  transition={theme.motion.fast}
                />
              </Pressable>
            )}
          />
        </SafeAreaView>
      </View>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  counter: {
    color: theme.colors.white,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.extraBold,
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingBottom: 14,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
