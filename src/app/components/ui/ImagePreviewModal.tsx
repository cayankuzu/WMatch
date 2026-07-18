import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useMemo, useRef, useState } from 'react';

import { theme } from '../../../shared/theme';
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
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
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
            renderItem={({ item }) => (
              <Pressable accessible={false} onPress={onClose} style={[styles.imageWrap, { width }]}>
                <Image
                  accessible={false}
                  cachePolicy="memory-disk"
                  contentFit="contain"
                  recyclingKey={item}
                  source={{ uri: item }}
                  style={styles.image}
                  transition={120}
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
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  counter: {
    color: theme.colors.white,
    fontSize: theme.typography.caption,
    fontWeight: '900',
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
