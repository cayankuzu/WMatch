import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Animated,
  FlatList,
  ImageBackground,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { PROFILE_CARD_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { getLetterboxdDisplayText, getLetterboxdProfileUrl } from '../../shared/config/externalLinks';
import { getLocalizedMediaFilterLabel, getLocalizedUserGenderLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';
import { type UserGender } from '../../shared/utils/discovery';
import type { Movie } from '../../services/tmdb';
import MovieCard from './MovieCard';
import ImagePreviewModal from './ui/ImagePreviewModal';
import SegmentedControl from './ui/SegmentedControl';
import DataState from './ui/DataState';
import AppRefreshControl from './ui/AppRefreshControl';

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
}: ProfileCardProps) {
  const { t } = useLocalization();
  const { width: viewportWidth } = useWindowDimensions();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [selectedTab, setSelectedTab] = useState<'favorites' | 'watched'>('favorites');
  const [contentFilter, setContentFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [swipeCue, setSwipeCue] = useState<'left' | 'right' | 'down' | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;
  const scrollOffsetRef = useRef(0);
  const photoListRef = useRef<FlatList<string> | null>(null);

  const photos = user.photos.filter((photo) => photo.trim().length > 0);
  const resolvedPhotoNavigationMode = photoNavigationMode ?? (swipeable ? 'buttons' : 'swipe');
  const photoPageWidth = Math.max(1, viewportWidth - SCREEN_SIDE_SPACING * 2);
  const activePhoto = photos[currentPhotoIndex] ?? photos[0] ?? null;
  const showAge = user.showAgeOnProfile !== false && Boolean(user.age);
  const showGender = user.showGenderOnProfile !== false && Boolean(user.gender) && user.gender !== 'other';
  const normalizedLetterboxd = user.letterboxd?.trim() ?? '';
  const letterboxdProfileUrl = getLetterboxdProfileUrl(normalizedLetterboxd);
  const hasLetterboxd = letterboxdProfileUrl != null;
  const resolvedHeaderRightLabel = headerRightIcon === 'dots-vertical' ? t('a11y.profileMenu') : t('a11y.profileAction');
  const secondaryHeaderRightLabel = secondaryHeaderRightIcon === 'flag-outline' ? t('a11y.reportProfile') : t('a11y.secondaryProfileAction');
  const letterboxdDisplayText = getLetterboxdDisplayText(letterboxdProfileUrl, t('profile.card.letterboxdMissing'));
  const compatibilityStyle = getCompatibilityStyle(compatibilityScore ?? 0);
  const genderLabel = showGender && user.gender ? getLocalizedUserGenderLabel(t, user.gender) : null;
  const resolvedHeaderRightPress = onHeaderRightPress ?? (swipeable ? onRefresh : undefined);
  const resolvedHeaderRightIcon = headerRightIcon ?? (swipeable && onRefresh ? 'reload' : undefined);
  const showHeaderBar = Boolean(onHeaderBack || resolvedHeaderRightPress || onSecondaryHeaderRightPress);

  useEffect(() => {
    setCurrentPhotoIndex(0);
    pan.setValue({ x: 0, y: 0 });
    scrollOffsetRef.current = 0;
    setSwipeCue(null);
    setShowImagePreview(false);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [pan, user.id, user.name]);

  useEffect(() => {
    if (photos.length === 0 || currentPhotoIndex <= photos.length - 1) {
      return;
    }

    setCurrentPhotoIndex(0);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [currentPhotoIndex, photos.length]);

  const animateOut = (direction: -1 | 1, callback?: () => void) => {
    Animated.timing(pan, {
      toValue: { x: direction * 420, y: 0 },
      duration: 110,
      useNativeDriver: true,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      setSwipeCue(null);
      callback?.();
    });
  };

  const animateDown = (callback?: () => void) => {
    Animated.timing(pan, {
      toValue: { x: 0, y: 180 },
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      setSwipeCue(null);
      callback?.();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          swipeable &&
          (
            (
              Math.abs(gesture.dx) > 12 &&
              Math.abs(gesture.dx) > Math.abs(gesture.dy) &&
              ((gesture.dx > 0 && allowSwipeRight) || (gesture.dx < 0 && allowSwipeLeft))
            ) ||
            (
              Boolean(onSwipeDown) &&
              scrollOffsetRef.current <= 0 &&
              gesture.dy > 14 &&
              gesture.dy > Math.abs(gesture.dx)
            )
          ),
        onPanResponderGrant: () => {
          pan.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          if (onSwipeDown && scrollOffsetRef.current <= 0 && gesture.dy > 0 && gesture.dy > Math.abs(gesture.dx)) {
            pan.setValue({ x: 0, y: Math.max(0, gesture.dy) });
            setSwipeCue(gesture.dy > 26 ? 'down' : null);
            return;
          }

          const wantsRight = gesture.dx > 0;
          const wantsLeft = gesture.dx < 0;

          if ((wantsRight && !allowSwipeRight) || (wantsLeft && !allowSwipeLeft)) {
            pan.setValue({ x: 0, y: 0 });
            setSwipeCue(null);
            return;
          }

          pan.setValue({ x: gesture.dx, y: 0 });
          setSwipeCue(gesture.dx > 28 ? 'right' : gesture.dx < -28 ? 'left' : null);
        },
        onPanResponderRelease: (_, gesture) => {
          if (
            onSwipeDown &&
            scrollOffsetRef.current <= 0 &&
            gesture.dy > DOWN_SWIPE_THRESHOLD &&
            gesture.dy > Math.abs(gesture.dx)
          ) {
            animateDown(onSwipeDown);
            return;
          }

          if (gesture.dx > SWIPE_THRESHOLD && allowSwipeRight) {
            animateOut(1, onSwipeRight);
            return;
          }

          if (gesture.dx < -SWIPE_THRESHOLD && allowSwipeLeft) {
            animateOut(-1, onSwipeLeft);
            return;
          }

          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start(() => setSwipeCue(null));
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start(() => setSwipeCue(null));
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => false,
      }),
    [allowSwipeLeft, allowSwipeRight, onSwipeDown, onSwipeLeft, onSwipeRight, pan, swipeable],
  );

  const currentList = selectedTab === 'favorites' ? favorites : watched;
  const filteredList = currentList.filter((item) => {
    if (contentFilter === 'movie') return item.media_type === 'movie' || Boolean(item.title);
    if (contentFilter === 'tv') return item.media_type === 'tv' || Boolean(item.name);
    return true;
  });

  const rotate = pan.x.interpolate({
    inputRange: [-220, 0, 220],
    outputRange: ['-8deg', '0deg', '8deg'],
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
    <Animated.View
      style={[
        styles.animatedShell,
        swipeable && {
          transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }],
        },
      ]}
      {...(swipeable ? panResponder.panHandlers : {})}
    >
      {showHeaderBar ? (
        <View style={styles.swipeTopBar}>
          {onHeaderBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onHeaderBack} style={styles.swipeTopBarButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={theme.colors.primarySoft} />
            </Pressable>
          ) : (
            <View style={styles.swipeTopBarSpacer} />
          )}

          <View style={styles.swipeTopBarActions}>
            {resolvedHeaderRightPress && resolvedHeaderRightIcon ? (
              <Pressable accessibilityRole="button" accessibilityLabel={resolvedHeaderRightLabel} onPress={resolvedHeaderRightPress} style={styles.swipeTopBarButton}>
                <MaterialCommunityIcons name={resolvedHeaderRightIcon} size={18} color={theme.colors.primarySoft} />
              </Pressable>
            ) : null}

            {onSecondaryHeaderRightPress && secondaryHeaderRightIcon ? (
              <Pressable accessibilityRole="button" accessibilityLabel={secondaryHeaderRightLabel} onPress={onSecondaryHeaderRightPress} style={styles.swipeTopBarButton}>
                <MaterialCommunityIcons name={secondaryHeaderRightIcon} size={18} color={theme.colors.primarySoft} />
              </Pressable>
            ) : null}

            {!resolvedHeaderRightPress && !onSecondaryHeaderRightPress ? (
              <View style={styles.swipeTopBarSpacer} />
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: PROFILE_CARD_BOTTOM_SPACING + bottomInset }}
        bounces={!swipeable || Boolean(onSwipeDown)}
        alwaysBounceVertical={!swipeable && Boolean(onRefresh)}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
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
            <View style={styles.heroCarousel}>
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
                renderItem={({ item }) => (
                  <ImageBackground source={{ uri: item }} style={[styles.hero, { width: photoPageWidth }]} imageStyle={styles.heroImage}>
                    <View style={styles.heroScrim} />
                    <Pressable onPress={() => setShowImagePreview(true)} style={StyleSheet.absoluteFill} />
                  </ImageBackground>
                )}
              />

              {swipeCue ? (
                <View
                  style={[
                    styles.swipeCue,
                    swipeCue === 'right'
                      ? styles.swipeCueRight
                      : swipeCue === 'left'
                        ? styles.swipeCueLeft
                        : styles.swipeCueDown,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={swipeCue === 'right' ? 'heart' : swipeCue === 'left' ? 'close' : 'undo-variant'}
                    size={swipeCue === 'down' ? 34 : 38}
                    color={theme.colors.white}
                  />
                  {swipeCue === 'down' ? <Text style={styles.swipeCueText}>{t('common.back')}</Text> : null}
                </View>
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
            <View style={[styles.hero, styles.heroPlaceholder]}>
              <View style={styles.placeholderIconWrap}>
                <MaterialCommunityIcons name="account-outline" size={44} color={theme.colors.primarySoft} />
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

            <View style={styles.linkRow}>
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
                <Text numberOfLines={1} style={styles.linkPlaceholder}>
                  {letterboxdDisplayText}
                </Text>
              )}
            </View>

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

              <SegmentedControl
                size="compact"
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
                <View style={styles.movieGrid}>
                  {filteredList.map((movie) => (
                    <MovieCard
                      key={`${movie.id}-${movie.media_type ?? 'media'}`}
                      movie={movie}
                      size="small"
                      onClick={() => onMovieClick?.(movie)}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <ImagePreviewModal
        visible={showImagePreview}
        imageUri={activePhoto}
        images={photos}
        initialIndex={currentPhotoIndex}
        onClose={() => setShowImagePreview(false)}
      />
    </Animated.View>
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
  },
  heroWrapWithToolbar: {
    paddingTop: 6,
  },
  heroCarousel: {
    height: 510,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  hero: {
    height: 510,
    justifyContent: 'flex-end',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  heroImage: {
    resizeMode: 'cover',
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
    width: 102,
    height: 102,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  placeholderTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  placeholderText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
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
    borderRadius: 999,
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
    borderRadius: 999,
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
  swipeTopBar: {
    marginHorizontal: SCREEN_SIDE_SPACING,
    marginTop: 12,
    marginBottom: 2,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.alpha.elevated96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  swipeTopBarSpacer: {
    width: theme.layout.controlMinUnified,
    height: theme.layout.controlMinUnified,
  },
  swipeTopBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swipeTopBarButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  swipeCue: {
    position: 'absolute',
    top: 124,
    width: 74,
    height: 74,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.white,
  },
  swipeCueLeft: {
    left: 28,
    backgroundColor: theme.alpha.brand88,
  },
  swipeCueRight: {
    right: 28,
    backgroundColor: theme.alpha.success84,
  },
  swipeCueDown: {
    top: 114,
    width: 88,
    height: 88,
    gap: 4,
    alignSelf: 'center',
    backgroundColor: theme.alpha.info84,
  },
  swipeCueText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  body: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 18,
    gap: 14,
  },
  identityCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 18,
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  name: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
  },
  ageChip: {
    minWidth: theme.layout.controlMinUnified,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    borderWidth: 1,
    borderColor: theme.alpha.brand26,
  },
  ageText: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '900',
  },
  genderChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  genderText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  username: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  linkLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 0,
  },
  linkValueWrap: {
    flex: 1,
    minWidth: 0,
  },
  letterboxd: {
    color: theme.colors.primarySoft,
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
    flexShrink: 1,
  },
  linkPlaceholder: {
    flex: 1,
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  bio: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    lineHeight: 19,
    marginTop: 3,
  },
  compatibilityCard: {
    minHeight: 74,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 9,
  },
  compatibilityHeader: {
    gap: 2,
  },
  compatibilityLabel: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  compatibilityHint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    marginTop: 1,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  compatibilityBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compatibilityBarTrack: {
    flex: 1,
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  compatibilityBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  compatibilityScore: {
    minWidth: 40,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
  },
  movieGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  empty: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 16,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    textAlign: 'center',
  },
});
