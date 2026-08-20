import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ScrollView as ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { PROFILE_CARD_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { theme } from '../../shared/theme';
import type { Movie } from '../../services/tmdb';
import ImagePreviewModal from './ui/ImagePreviewModal';
import AppImage from './ui/AppImage';
import AppRefreshControl from './ui/AppRefreshControl';
import useTabReselect from '../hooks/useTabReselect';
import SwipeActionRail from './SwipeActionRail';
import ProfileTopBar from './ProfileTopBar';
import ProfileIdentitySection from './profile/ProfileIdentitySection';
import ProfileCompatibilityCard from './profile/ProfileCompatibilityCard';
import ProfileMediaLibrary from './profile/ProfileMediaLibrary';
import type { ProfileCardUser } from './profile/types';
import { useProfileCardGesture } from './profile/useProfileCardGesture';
export type { ProfileCardUser } from './profile/types';

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
  const [showImagePreview, setShowImagePreview] = useState(false);
  const photoListRef = useRef<FlatList<string> | null>(null);
  const contentScrollRef = useRef<ScrollViewInstance | null>(null);

  const photos = user.photos.filter((photo) => photo.trim().length > 0);
  const resolvedPhotoNavigationMode = photoNavigationMode ?? (swipeable ? 'buttons' : 'swipe');
  const usableViewportWidth = Math.max(1, viewportWidth - insets.left - insets.right);
  const photoPageWidth = Math.min(520, Math.max(1, usableViewportWidth - 32));
  const heroHeight = Math.min(photoPageWidth / 0.86, viewportHeight * 0.54, 500);
  const profileContentWidth = Math.max(
    1,
    Math.min(usableViewportWidth, theme.layout.contentMaxReading) - SCREEN_SIDE_SPACING * 2,
  );
  const activePhoto = photos[currentPhotoIndex] ?? photos[0] ?? null;
  const resolvedHeaderRightPress = onHeaderRightPress ?? (swipeable ? onRefresh : undefined);
  const resolvedHeaderRightIcon = headerRightIcon ?? (swipeable && onRefresh ? 'reload' : undefined);
  const showHeaderBar = Boolean(headerTitle || onHeaderBack || resolvedHeaderRightPress || onSecondaryHeaderRightPress);
  const canSwipeDown = Boolean(onSwipeDown);
  const {
    cardStyle: cardAnimatedStyle,
    downCueStyle,
    gesture: panGesture,
    handleScroll,
    leftCueStyle,
    reset: resetGesture,
    rightCueStyle,
  } = useProfileCardGesture({
    enabled: swipeable,
    allowLeft: allowSwipeLeft,
    allowRight: allowSwipeRight,
    allowDown: canSwipeDown,
    onLeft: onSwipeLeft,
    onRight: onSwipeRight,
    onDown: onSwipeDown,
  });
  const scrollToTop = useCallback(() => {
    if (isOwnProfile) {
      contentScrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [isOwnProfile]);

  useTabReselect('profile', scrollToTop);

  useEffect(() => {
    setCurrentPhotoIndex(0);
    resetGesture();
    setShowImagePreview(false);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [resetGesture, user.id, user.name]);

  useEffect(() => {
    if (photos.length === 0 || currentPhotoIndex <= photos.length - 1) {
      return;
    }

    setCurrentPhotoIndex(0);
    requestAnimationFrame(() => {
      photoListRef.current?.scrollToIndex({ index: 0, animated: false });
    });
  }, [currentPhotoIndex, photos.length]);

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
          <ProfileIdentitySection
            isOwnProfile={isOwnProfile}
            user={user}
            onEditProfile={onEditProfile}
          />

          {beforeCompatibilitySection}

          {showCompatibility && compatibilityScore != null ? (
            <ProfileCompatibilityCard score={compatibilityScore} onPress={onCompatibilityClick} />
          ) : null}

          <ProfileMediaLibrary
            fallbackWidth={profileContentWidth}
            favorites={favorites}
            isOwnProfile={isOwnProfile}
            loading={libraryLoading}
            watched={watched}
            onMovieClick={onMovieClick}
          />
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
});
