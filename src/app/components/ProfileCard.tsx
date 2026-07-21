import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { ScrollView as ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { PROFILE_CARD_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { getLetterboxdDisplayText, getLetterboxdProfileUrl } from '../../shared/config/externalLinks';
import { getLocalizedMediaFilterLabel, getLocalizedUserGenderLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';
import { type UserGender } from '../../shared/utils/discovery';
import { getFixedGridItemWidth } from '../../shared/utils/grid';
import type { Movie } from '../../services/tmdb';
import MovieCard from './MovieCard';
import ImagePreviewModal from './ui/ImagePreviewModal';
import AppImage from './ui/AppImage';
import SegmentedControl from './ui/SegmentedControl';
import OptionChips from './ui/OptionChips';
import DataState from './ui/DataState';
import AppRefreshControl from './ui/AppRefreshControl';
import useTabReselect from '../hooks/useTabReselect';
import SwipeActionRail from './SwipeActionRail';
import ProfileTopBar from './ProfileTopBar';

export interface ProfileCardUser {
  id?: string;
  name: string;
  age?: number;
  showAgeOnProfile?: boolean;
  gender?: UserGender;
  showGenderOnProfile?: boolean;
  username: string;
  photos: string[];
  bio?: string;
  letterboxd?: string;
  favoriteMovies?: number[];
  watchedMovies?: number[];
}

interface ProfileCardProps {
  user: ProfileCardUser;
  favorites: Movie[];
  watched: Movie[];
  libraryLoading?: boolean;
  beforeCompatibilitySection?: ReactNode;
  onMovieClick?: (movie: Movie) => void;
  showCompatibility?: boolean;
  compatibilityScore?: number;
  onCompatibilityClick?: () => void;
  isOwnProfile?: boolean;
  swipeable?: boolean;
  photoNavigationMode?: 'buttons' | 'swipe';
  allowSwipeLeft?: boolean;
  allowSwipeRight?: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onHeaderBack?: () => void;
  onHeaderRightPress?: () => void;
  headerRightIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onSecondaryHeaderRightPress?: () => void;
  secondaryHeaderRightIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomInset?: number;
  headerTitle?: string;
  headerSubtitle?: string;
  onEditProfile?: () => void;
}

const SWIPE_THRESHOLD = 110;
const DOWN_SWIPE_THRESHOLD = 88;

export default function ProfileCard({
  user,
  favorites,
  watched,
  libraryLoading = false,
  beforeCompatibilitySection,
  onMovieClick,
  showCompatibility = false,
  compatibilityScore,
  onCompatibilityClick,
  isOwnProfile = false,
  swipeable = false,
  photoNavigationMode,
  allowSwipeLeft = true,
  allowSwipeRight = true,
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
  onHeaderBack,
  onHeaderRightPress,
  headerRightIcon,
  onSecondaryHeaderRightPress,
  secondaryHeaderRightIcon,
  refreshing = false,
  onRefresh,
  bottomInset = 0,
  headerTitle,
  headerSubtitle,
  onEditProfile,
}: ProfileCardProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [selectedTab, setSelectedTab] = useState<'favorites' | 'watched'>('favorites');
  const [contentFilter, setContentFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [showImagePreview, setShowImagePreview] = useState(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const photoListRef = useRef<FlatList<string> | null>(null);
  const contentScrollRef = useRef<ScrollViewInstance | null>(null);
  const [profileGridWidth, setProfileGridWidth] = useState(0);

  const photos = user.photos.filter((photo) => photo.trim().length > 0);
  const resolvedPhotoNavigationMode = photoNavigationMode ?? (swipeable ? 'buttons' : 'swipe');
  const usableViewportWidth = Math.max(1, viewportWidth - insets.left - insets.right);
  const photoPageWidth = Math.min(520, Math.max(1, usableViewportWidth - 32));
  const heroHeight = Math.min(photoPageWidth / 0.86, viewportHeight * 0.54, 500);
  const profileContentWidth = Math.max(
    1,
    Math.min(usableViewportWidth, theme.layout.contentMaxReading) - SCREEN_SIDE_SPACING * 2,
  );
  const profileGridColumns = 3;
  const profileMovieWidth = getFixedGridItemWidth(
    profileGridWidth || profileContentWidth,
    profileGridColumns,
    theme.layout.cardGap,
  );
  const activePhoto = photos[currentPhotoIndex] ?? photos[0] ?? null;
  const showAge = user.showAgeOnProfile !== false && Boolean(user.age);
  const showGender = user.showGenderOnProfile !== false && Boolean(user.gender) && user.gender !== 'other';
  const normalizedLetterboxd = user.letterboxd?.trim() ?? '';
  const letterboxdProfileUrl = getLetterboxdProfileUrl(normalizedLetterboxd);
  const hasLetterboxd = letterboxdProfileUrl != null;
  const letterboxdDisplayText = getLetterboxdDisplayText(letterboxdProfileUrl, t('profile.card.letterboxdMissing'));
  const compatibilityStyle = getCompatibilityStyle(compatibilityScore ?? 0);
  const genderLabel = showGender && user.gender ? getLocalizedUserGenderLabel(t, user.gender) : null;
  const resolvedHeaderRightPress = onHeaderRightPress ?? (swipeable ? onRefresh : undefined);
  const resolvedHeaderRightIcon = headerRightIcon ?? (swipeable && onRefresh ? 'reload' : undefined);
  const showHeaderBar = Boolean(headerTitle || onHeaderBack || resolvedHeaderRightPress || onSecondaryHeaderRightPress);
  const canSwipeDown = Boolean(onSwipeDown);
  const scrollToTop = useCallback(() => {
    if (isOwnProfile) {
      contentScrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [isOwnProfile]);
  const handleProfileGridLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;

    setProfileGridWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth,
    );
  }, []);

  useTabReselect('profile', scrollToTop);

  useEffect(() => {
    setCurrentPhotoIndex(0);
    translateX.value = 0;
    translateY.value = 0;
    scrollOffset.value = 0;
    setShowImagePreview(false);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [scrollOffset, translateX, translateY, user.id, user.name]);

  useEffect(() => {
    if (photos.length === 0 || currentPhotoIndex <= photos.length - 1) {
      return;
    }

    setCurrentPhotoIndex(0);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [currentPhotoIndex, photos.length]);

  const commitSwipeLeft = useCallback(() => onSwipeLeft?.(), [onSwipeLeft]);
  const commitSwipeRight = useCallback(() => onSwipeRight?.(), [onSwipeRight]);
  const commitSwipeDown = useCallback(() => onSwipeDown?.(), [onSwipeDown]);

  const panGesture = useMemo(
    () => Gesture.Pan()
      .enabled(swipeable)
      .manualActivation(true)
      .onTouchesDown((event) => {
        const touch = event.allTouches[0];
        if (touch) {
          gestureStartX.value = touch.absoluteX;
          gestureStartY.value = touch.absoluteY;
        }
      })
      .onTouchesMove((event, stateManager) => {
        const touch = event.allTouches[0];
        if (!touch) {
          return;
        }

        const deltaX = touch.absoluteX - gestureStartX.value;
        const deltaY = touch.absoluteY - gestureStartY.value;
        const horizontalIntent = Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY);
        const downwardIntent = deltaY > 14 && deltaY > Math.abs(deltaX);

        if (horizontalIntent) {
          const directionAllowed = deltaX > 0 ? allowSwipeRight : allowSwipeLeft;
          directionAllowed ? stateManager.activate() : stateManager.fail();
          return;
        }

        if (downwardIntent) {
          canSwipeDown && scrollOffset.value <= 0 ? stateManager.activate() : stateManager.fail();
          return;
        }

        if (Math.abs(deltaY) > 14) {
          stateManager.fail();
        }
      })
      .onUpdate((event) => {
        if (event.translationY > 0 && event.translationY > Math.abs(event.translationX) && canSwipeDown && scrollOffset.value <= 0) {
          translateX.value = 0;
          translateY.value = event.translationY;
          return;
        }

        translateY.value = 0;
        translateX.value = event.translationX;
      })
      .onEnd((event) => {
        if (translateY.value > DOWN_SWIPE_THRESHOLD && canSwipeDown) {
          translateY.value = withTiming(180, { duration: 120 }, (finished) => {
            if (finished) {
              translateY.value = 0;
              runOnJS(commitSwipeDown)();
            }
          });
          return;
        }

        if (translateX.value > SWIPE_THRESHOLD && allowSwipeRight) {
          translateX.value = withTiming(420, { duration: 110 }, (finished) => {
            if (finished) {
              translateX.value = 0;
              runOnJS(commitSwipeRight)();
            }
          });
          return;
        }

        if (translateX.value < -SWIPE_THRESHOLD && allowSwipeLeft) {
          translateX.value = withTiming(-420, { duration: 110 }, (finished) => {
            if (finished) {
              translateX.value = 0;
              runOnJS(commitSwipeLeft)();
            }
          });
          return;
        }

        translateX.value = withSpring(0, { damping: 18, stiffness: 220, velocity: event.velocityX });
        translateY.value = withSpring(0, { damping: 18, stiffness: 220, velocity: event.velocityY });
      })
      .onFinalize((_event, success) => {
        if (!success) {
          translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
          translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
        }
      }),
    [
      allowSwipeLeft,
      allowSwipeRight,
      canSwipeDown,
      commitSwipeDown,
      commitSwipeLeft,
      commitSwipeRight,
      gestureStartX,
      gestureStartY,
      scrollOffset,
      swipeable,
      translateX,
      translateY,
    ],
  );

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: swipeable ? translateX.value : 0 },
      { translateY: swipeable ? translateY.value : 0 },
      { rotate: swipeable ? `${Math.max(-8, Math.min(8, translateX.value / 27.5))}deg` : '0deg' },
    ],
  }));
  const leftCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, -translateX.value / 90)),
  }));
  const rightCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, translateX.value / 90)),
  }));
  const downCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, translateY.value / 80)),
  }));
  const handleScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
  });

  const currentList = selectedTab === 'favorites' ? favorites : watched;
  const filteredList = currentList.filter((item) => {
    if (contentFilter === 'movie') return item.media_type === 'movie' || Boolean(item.title);
    if (contentFilter === 'tv') return item.media_type === 'tv' || Boolean(item.name);
    return true;
  });

  const openLetterboxd = () => {
    if (!letterboxdProfileUrl) {
      return;
    }

    void Linking.openURL(letterboxdProfileUrl);
  };

  const scrollToPhoto = (nextIndex: number, animated = true) => {
    if (photos.length === 0) {
      return;
    }

    const boundedIndex = ((nextIndex % photos.length) + photos.length) % photos.length;
    setCurrentPhotoIndex(boundedIndex);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: boundedIndex, animated });
    });
  };

  const nextPhoto = () => {
    if (photos.length < 2) {
      return;
    }

    scrollToPhoto(currentPhotoIndex + 1);
  };

  const previousPhoto = () => {
    if (photos.length < 2) {
      return;
    }

    scrollToPhoto(currentPhotoIndex - 1);
  };

  const emptyText =
    selectedTab === 'favorites'
      ? isOwnProfile
        ? t('profile.card.empty.favorites.own')
        : t('profile.card.empty.favorites.other')
      : isOwnProfile
        ? t('profile.card.empty.watched.own')
        : t('profile.card.empty.watched.other');

  return (
    <GestureDetector gesture={panGesture}>
    <Animated.View style={[styles.animatedShell, cardAnimatedStyle]}>
      {showHeaderBar ? (
        <ProfileTopBar
          title={headerTitle}
          subtitle={headerSubtitle}
          onBack={onHeaderBack}
          primaryIcon={resolvedHeaderRightIcon}
          onPrimaryPress={resolvedHeaderRightPress}
          secondaryIcon={secondaryHeaderRightIcon}
          onSecondaryPress={onSecondaryHeaderRightPress}
        />
      ) : null}

      <Animated.ScrollView
        ref={contentScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: PROFILE_CARD_BOTTOM_SPACING + bottomInset }}
        bounces={!swipeable || Boolean(onSwipeDown)}
        alwaysBounceVertical={!swipeable && Boolean(onRefresh)}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        refreshControl={
          !swipeable && onRefresh ? (
            <AppRefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          ) : undefined
        }
      >
        <View style={[styles.heroWrap, showHeaderBar && styles.heroWrapWithToolbar]}>
          {activePhoto ? (
            <View style={[styles.heroCarousel, { width: photoPageWidth, height: heroHeight }]}>
              <FlatList
                ref={photoListRef}
                horizontal
                pagingEnabled
                directionalLockEnabled
                disableIntervalMomentum
                bounces={false}
                overScrollMode="never"
                nestedScrollEnabled
                scrollEnabled={resolvedPhotoNavigationMode === 'swipe' && photos.length > 1}
                data={photos}
                keyExtractor={(photo, index) => `${photo}-${index}`}
                showsHorizontalScrollIndicator={false}
                getItemLayout={(_, index) => ({ length: photoPageWidth, offset: photoPageWidth * index, index })}
                onScrollToIndexFailed={({ index }) => {
                  setTimeout(() => {
                    photoListRef.current?.scrollToIndex({ index, animated: false });
                  }, 50);
                }}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / photoPageWidth);
                  setCurrentPhotoIndex(Math.min(Math.max(nextIndex, 0), photos.length - 1));
                }}
                renderItem={({ item, index }) => (
                  <View style={[styles.hero, { width: photoPageWidth, height: heroHeight }]}>
                    <AppImage
                      contentFit="cover"
                      enforceEarlyResizing
                      fallbackIcon="account-outline"
                      priority={index === currentPhotoIndex ? 'high' : 'normal'}
                      recyclingKey={`profile-hero:${user.id ?? user.username}:${index}`}
                      uri={item}
                      style={styles.heroImage}
                      transition={90}
                    />
                    <View style={styles.heroScrim} />
                    <Pressable onPress={() => setShowImagePreview(true)} style={StyleSheet.absoluteFill} />
                  </View>
                )}
              />

              {swipeable ? (
                <>
                  <Animated.View pointerEvents="none" style={[styles.swipeCue, styles.swipeCueLeft, leftCueStyle]}>
                    <MaterialCommunityIcons name="close" size={30} color={theme.colors.white} />
                  </Animated.View>
                  <Animated.View pointerEvents="none" style={[styles.swipeCue, styles.swipeCueRight, rightCueStyle]}>
                    <MaterialCommunityIcons name="heart" size={30} color={theme.colors.white} />
                  </Animated.View>
                  {onSwipeDown ? (
                    <Animated.View pointerEvents="none" style={[styles.swipeCue, styles.swipeCueDown, downCueStyle]}>
                      <MaterialCommunityIcons name="undo-variant" size={28} color={theme.colors.white} />
                      <Text style={styles.swipeCueText}>{t('common.back')}</Text>
                    </Animated.View>
                  ) : null}
                </>
              ) : null}

              {photos.length > 1 ? (
                <>
                  <View style={styles.photoProgress}>
                    {photos.map((photo, index) => (
                      <View
                        key={`${photo}-${index}`}
                        style={[
                          styles.photoProgressItem,
                          index === currentPhotoIndex && styles.photoProgressItemActive,
                        ]}
                      />
                    ))}
                  </View>

                  {resolvedPhotoNavigationMode === 'buttons' ? (
                    <>
                      <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.previousPhoto')} onPress={previousPhoto} style={[styles.photoButton, styles.photoButtonLeft]}>
                        <MaterialCommunityIcons name="chevron-left" size={22} color={theme.colors.white} />
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.nextPhoto')} onPress={nextPhoto} style={[styles.photoButton, styles.photoButtonRight]}>
                        <MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.white} />
                      </Pressable>
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : (
            <View style={[styles.hero, styles.heroPlaceholder, { width: photoPageWidth, height: heroHeight }]}>
              <View style={styles.placeholderIconWrap}>
                <MaterialCommunityIcons name="account-outline" size={36} color={theme.colors.primarySoft} />
              </View>
              <Text style={styles.placeholderTitle}>
                {isOwnProfile ? t('profile.card.empty.own.title') : t('profile.card.empty.other.title')}
              </Text>
              <Text style={styles.placeholderText}>
                {isOwnProfile
                  ? t('profile.card.empty.own.description')
                  : t('profile.card.empty.other.description')}
              </Text>
            </View>
          )}
        </View>

        {swipeable ? (
          <SwipeActionRail
            allowReject={allowSwipeLeft}
            allowLike={allowSwipeRight}
            canUndo={Boolean(onSwipeDown)}
            onReject={onSwipeLeft}
            onLike={onSwipeRight}
            onUndo={onSwipeDown}
          />
        ) : null}

        <View style={styles.body}>
          <View style={styles.identityCard}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{user.name}</Text>
              {showAge && user.age ? (
                <View style={styles.ageChip}>
                  <Text style={styles.ageText}>{user.age}</Text>
                </View>
              ) : null}
              {genderLabel ? (
                <View style={styles.genderChip}>
                  <Text style={styles.genderText}>{genderLabel}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.username}>{user.username}</Text>

            {hasLetterboxd || isOwnProfile ? <View style={styles.linkRow}>
              <MaterialCommunityIcons
                name="link-variant"
                size={14}
                color={hasLetterboxd ? theme.colors.primarySoft : theme.colors.textSoft}
              />
              <Text style={styles.linkLabel}>Letterboxd:</Text>
              {hasLetterboxd ? (
                <Pressable onPress={openLetterboxd} style={styles.linkValueWrap}>
                  <Text numberOfLines={1} style={styles.letterboxd}>
                    {letterboxdDisplayText}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={!onEditProfile}
                  onPress={onEditProfile}
                  style={styles.linkValueWrap}
                >
                  <Text numberOfLines={1} style={styles.linkPlaceholder}>
                    {t('profile.card.letterboxdAdd')}
                  </Text>
                </Pressable>
              )}
            </View> : null}

            {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
          </View>

          {beforeCompatibilitySection}

          {showCompatibility && compatibilityScore != null ? (
            <Pressable onPress={onCompatibilityClick} style={styles.compatibilityCard}>
              <View style={styles.compatibilityHeader}>
                <Text style={styles.compatibilityLabel}>{t('profile.card.compatibility.label')}</Text>
                <Text style={styles.compatibilityHint}>{t('profile.card.compatibility.hint')}</Text>
              </View>
              <View style={styles.compatibilityBarWrap}>
                <View style={[styles.compatibilityBarTrack, { backgroundColor: compatibilityStyle.track }]}>
                  <View
                    style={[
                      styles.compatibilityBarFill,
                      {
                        width: `${Math.min(compatibilityScore, 100)}%`,
                        backgroundColor: compatibilityStyle.color,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.compatibilityScore, { color: compatibilityStyle.color }]}>%{compatibilityScore}</Text>
              </View>
            </Pressable>
          ) : null}

          {libraryLoading ? (
            <DataState state="initial-loading" title={t('profile.loading')} />
          ) : (
            <>
              <SegmentedControl
                size="compact"
                value={selectedTab}
                onChange={setSelectedTab}
                options={[
                  { label: t('profile.card.segment.favorites', { count: favorites.length }), value: 'favorites' },
                  { label: t('profile.card.segment.watched', { count: watched.length }), value: 'watched' },
                ]}
              />

              <OptionChips
                value={contentFilter}
                onChange={setContentFilter}
                options={[
                  { label: getLocalizedMediaFilterLabel(t, 'all'), value: 'all' },
                  { label: getLocalizedMediaFilterLabel(t, 'movie'), value: 'movie' },
                  { label: getLocalizedMediaFilterLabel(t, 'tv'), value: 'tv' },
                ]}
              />

              {filteredList.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>{emptyText}</Text>
                </View>
              ) : (
                <View onLayout={handleProfileGridLayout} style={styles.movieGrid}>
                  {filteredList.map((movie) => (
                    <MovieCard
                      key={`${movie.id}-${movie.media_type ?? 'media'}`}
                      movie={movie}
                      size="small"
                      width={profileMovieWidth}
                      onClick={() => onMovieClick?.(movie)}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>

      <ImagePreviewModal
        visible={showImagePreview}
        imageUri={activePhoto}
        images={photos}
        initialIndex={currentPhotoIndex}
        onClose={() => setShowImagePreview(false)}
      />
    </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  animatedShell: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  heroWrap: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 10,
    alignItems: 'center',
  },
  heroWrapWithToolbar: {
    paddingTop: 6,
  },
  heroCarousel: {
    borderRadius: theme.radius.personCard,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  hero: {
    justifyContent: 'flex-end',
    borderRadius: theme.radius.personCard,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.alpha.black14,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  placeholderIconWrap: {
    width: 84,
    height: 84,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  placeholderTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.sectionTitle,
    textAlign: 'center',
  },
  placeholderText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
    textAlign: 'center',
  },
  photoProgress: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 6,
  },
  photoProgressItem: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.alpha.white28,
  },
  photoProgressItemActive: {
    backgroundColor: theme.colors.white,
  },
  photoButton: {
    position: 'absolute',
    top: '46%',
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha.black52,
  },
  photoButtonLeft: {
    left: 14,
  },
  photoButtonRight: {
    right: 14,
  },
  swipeCue: {
    position: 'absolute',
    top: 124,
    width: 62,
    height: 62,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.white,
  },
  swipeCueLeft: {
    left: 28,
    backgroundColor: theme.colors.danger,
  },
  swipeCueRight: {
    right: 28,
    backgroundColor: theme.colors.primary,
  },
  swipeCueDown: {
    top: 114,
    width: 72,
    height: 72,
    gap: 4,
    alignSelf: 'center',
    backgroundColor: theme.alpha.info84,
  },
  swipeCueText: {
    color: theme.colors.white,
    ...theme.typography.roles.micro,
  },
  body: {
    width: '100%',
    maxWidth: theme.layout.contentMaxReading,
    alignSelf: 'center',
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 12,
    gap: 10,
  },
  identityCard: {
    borderRadius: theme.radius.personCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 12,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    color: theme.colors.text,
    ...theme.typography.roles.screenTitle,
    letterSpacing: 0,
  },
  ageChip: {
    minWidth: 28,
    minHeight: 24,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    borderWidth: 1,
    borderColor: theme.alpha.brand26,
  },
  ageText: {
    color: theme.colors.primarySoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  genderChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  genderText: {
    color: theme.colors.text,
    ...theme.typography.roles.meta,
  },
  username: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  linkLabel: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
    flexShrink: 0,
  },
  linkValueWrap: {
    flex: 1,
    minWidth: 0,
  },
  letterboxd: {
    color: theme.colors.primarySoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
    textDecorationLine: 'underline',
    flexShrink: 1,
  },
  linkPlaceholder: {
    flex: 1,
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
    flexShrink: 1,
  },
  bio: {
    color: theme.colors.text,
    ...theme.typography.roles.body,
    marginTop: 3,
  },
  compatibilityCard: {
    minHeight: 56,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  compatibilityHeader: {
    gap: 2,
  },
  compatibilityLabel: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  compatibilityHint: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
    marginTop: 1,
  },
  compatibilityBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compatibilityBarTrack: {
    flex: 1,
    height: 7,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  compatibilityBarFill: {
    height: '100%',
    borderRadius: theme.radius.pill,
  },
  compatibilityScore: {
    minWidth: 40,
    ...theme.typography.roles.sectionTitle,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  movieGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.layout.cardGap,
  },
  empty: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 12,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    textAlign: 'center',
  },
});
