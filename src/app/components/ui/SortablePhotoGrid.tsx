import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';
import useReducedMotion from '../../hooks/useReducedMotion';
import AppImage from './AppImage';

const isNewArchitectureEnabled = Boolean(
  (globalThis as { nativeFabricUIManager?: unknown; __turboModuleProxy?: unknown }).nativeFabricUIManager ??
  (globalThis as { nativeFabricUIManager?: unknown; __turboModuleProxy?: unknown }).__turboModuleProxy,
);

const GRID_COLUMNS = 3;
const GRID_GAP = 10;

interface SortablePhotoGridProps {
  photos: string[];
  maxPhotos: number;
  onChange: (photos: string[]) => void;
  onAdd?: () => void;
  addLabel?: string;
}

export default function SortablePhotoGrid({
  photos,
  maxPhotos,
  onChange,
  onAdd,
  addLabel,
}: SortablePhotoGridProps) {
  const { t } = useLocalization();
  const reduceMotionEnabled = useReducedMotion();
  const [gridWidth, setGridWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const tileWidth = gridWidth > 0 ? (gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : 0;
  const tileHeight = tileWidth / 0.75;
  const resolvedAddLabel = addLabel ?? t('photoGrid.add');

  const animateGrid = () => {
    if (isNewArchitectureEnabled || reduceMotionEnabled) {
      return;
    }

    LayoutAnimation.configureNext({
      duration: 160,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setGridWidth(event.nativeEvent.layout.width);
  };

  const swapPhotos = (firstIndex: number, secondIndex: number) => {
    if (firstIndex === secondIndex || firstIndex < 0 || secondIndex < 0) {
      return;
    }

    const next = [...photos];
    [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
    animateGrid();
    onChange(next);
  };

  const handlePhotoPress = (index: number) => {
    if (selectedIndex === null) {
      setSelectedIndex(index);
      return;
    }

    if (selectedIndex === index) {
      setSelectedIndex(null);
      return;
    }

    swapPhotos(selectedIndex, index);
    setSelectedIndex(null);
  };

  const handlePhotoRemove = (index: number) => {
    Alert.alert(t('photoGrid.remove.title'), t('photoGrid.remove.description'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          animateGrid();
          onChange(photos.filter((_, currentIndex) => currentIndex !== index));
          setSelectedIndex((current) => {
            if (current === null) {
              return null;
            }

            if (current === index) {
              return null;
            }

            return current > index ? current - 1 : current;
          });
        },
      },
    ]);
  };

  const movePhotoToCover = (index: number) => {
    if (index <= 0) {
      return;
    }

    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.unshift(photo);
    animateGrid();
    onChange(next);
    setSelectedIndex(0);
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.instructionCard, selectedIndex !== null && styles.instructionCardActive]}>
        <MaterialCommunityIcons
          name={selectedIndex === null ? 'gesture-tap-button' : 'swap-horizontal'}
          size={15}
          color={selectedIndex === null ? theme.colors.primary : theme.colors.primarySoft}
        />
        <Text style={[styles.instructionText, selectedIndex !== null && styles.instructionTextActive]}>
          {selectedIndex === null ? t('photoGrid.instruction.idle') : t('photoGrid.instruction.active')}
        </Text>
      </View>

      <View onLayout={handleLayout} style={styles.grid}>
        {tileWidth > 0
          ? photos.map((photo, index) => {
              const isSelected = selectedIndex === index;

              return (
                <Pressable
                  key={`${photo}-${index}`}
                  onPress={() => handlePhotoPress(index)}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.profilePhoto', { index: index + 1 })}
                  accessibilityHint={t('photoGrid.instruction.idle')}
                  accessibilityActions={[
                    ...(index > 0 ? [{ name: 'movePrevious', label: t('photoGrid.action.previous') }] : []),
                    ...(index < photos.length - 1 ? [{ name: 'moveNext', label: t('photoGrid.action.next') }] : []),
                    ...(index > 0 ? [{ name: 'makeCover', label: t('photoGrid.action.cover') }] : []),
                    { name: 'remove', label: t('photoGrid.action.remove') },
                  ]}
                  onAccessibilityAction={(event) => {
                    switch (event.nativeEvent.actionName) {
                      case 'movePrevious':
                        swapPhotos(index, index - 1);
                        break;
                      case 'moveNext':
                        swapPhotos(index, index + 1);
                        break;
                      case 'makeCover':
                        movePhotoToCover(index);
                        break;
                      case 'remove':
                        handlePhotoRemove(index);
                        break;
                      default:
                        break;
                    }
                  }}
                  accessibilityState={{ selected: isSelected }}
                  style={[
                    styles.photoFrame,
                    isSelected && styles.photoFrameSelected,
                    isSelected && reduceMotionEnabled && styles.photoFrameSelectedStatic,
                    { width: tileWidth, height: tileHeight },
                  ]}
                >
                  <AppImage
                    contentFit="cover"
                    fallbackIcon="account-outline"
                    recyclingKey={photo}
                    uri={photo}
                    style={styles.photo}
                  />

                  <View style={[styles.tapHint, isSelected && styles.tapHintSelected]}>
                    <MaterialCommunityIcons
                      name={isSelected ? 'check-circle' : 'cursor-default-click-outline'}
                      size={12}
                      color={theme.colors.white}
                    />
                    <Text style={styles.tapHintText}>
                      {isSelected ? t('photoGrid.tag.selected') : t('photoGrid.tag.select')}
                    </Text>
                  </View>

                  {index === 0 ? <Text style={styles.coverLabel}>{t('photoGrid.tag.cover')}</Text> : null}

                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      handlePhotoRemove(index);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.removeProfilePhoto', { index: index + 1 })}
                    style={styles.removeButton}
                  >
                    <MaterialCommunityIcons name="close" size={13} color={theme.colors.white} />
                  </Pressable>
                </Pressable>
              );
            })
          : null}

        {tileWidth > 0 && photos.length < maxPhotos && onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={resolvedAddLabel}
            onPress={onAdd}
            style={[styles.addCard, { width: tileWidth, height: tileHeight }]}
          >
            <MaterialCommunityIcons name="image-plus" size={22} color={theme.colors.primarySoft} />
            <Text style={styles.addText}>{resolvedAddLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  instructionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.alpha.brand24,
    backgroundColor: theme.colors.primarySurface,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  instructionCardActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySurface,
  },
  instructionText: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.semibold,
    lineHeight: 15,
  },
  instructionTextActive: {
    color: theme.colors.text,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  photoFrame: {
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  photoFrameSelected: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    shadowColor: theme.colors.primaryStrong,
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    transform: [{ scale: 0.985 }],
  },
  photoFrameSelectedStatic: {
    transform: [{ scale: 1 }],
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  tapHint: {
    position: 'absolute',
    left: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.scrim,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tapHintSelected: {
    backgroundColor: theme.colors.primaryStrong,
  },
  tapHintText: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  coverLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primaryStrong,
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.extraBold,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.scrim,
  },
  addCard: {
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.bold,
    textAlign: 'center',
  },
});
