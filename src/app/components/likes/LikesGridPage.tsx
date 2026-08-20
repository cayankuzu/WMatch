import { memo, type Ref } from 'react';
import { FlatList, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import type { ApiUser } from '../../../services/api';
import { SCREEN_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../../shared/constants';
import { theme } from '../../../shared/theme';
import EmptyState from '../EmptyState';
import UserMiniCard from '../UserMiniCard';
import AppRefreshControl from '../ui/AppRefreshControl';

export interface ScoredUser {
  user: ApiUser;
  score: number;
}

interface LikesGridPageProps {
  columns: number;
  concealed: boolean;
  initialOffset: number;
  itemStyle: StyleProp<ViewStyle>;
  listRef: Ref<FlatList<ScoredUser>>;
  pageKey: 'liked' | 'likedme';
  pageWidth: number;
  refreshing: boolean;
  users: ScoredUser[];
  onItemPress: (page: 'liked' | 'likedme', index: number) => void;
  onRefresh: () => void;
  onScrollOffset: (page: 'liked' | 'likedme', offset: number) => void;
}

function LikesGridPage({
  columns,
  concealed,
  initialOffset,
  itemStyle,
  listRef,
  pageKey,
  pageWidth,
  refreshing,
  users,
  onItemPress,
  onRefresh,
  onScrollOffset,
}: LikesGridPageProps) {
  const { t } = useLocalization();

  return (
    <View style={[styles.page, { width: pageWidth }]}>
      <FlatList
        ref={listRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        data={users}
        contentOffset={{ x: 0, y: initialOffset }}
        key={`${pageKey}-grid-${columns}`}
        keyExtractor={(entry) => entry.user.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
        initialNumToRender={9}
        maxToRenderPerBatch={9}
        windowSize={7}
        onScroll={(event) => {
          onScrollOffset(pageKey, Math.max(0, event.nativeEvent.contentOffset.y));
        }}
        scrollEventThrottle={160}
        ListEmptyComponent={(
          <EmptyState
            icon="heart-outline"
            title={pageKey === 'liked' ? t('likes.empty.liked.title') : t('likes.empty.likedBy.title')}
            description={t('likes.empty.description')}
          />
        )}
        renderItem={({ item, index }) => (
          <UserMiniCard
            user={item.user}
            score={item.score}
            concealed={concealed}
            concealLabel={t('common.premium')}
            disabled={false}
            layout="portrait"
            style={itemStyle}
            onPress={() => onItemPress(pageKey, index)}
          />
        )}
      />
    </View>
  );
}

export default memo(LikesGridPage);

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 10,
    paddingBottom: SCREEN_BOTTOM_SPACING + 82,
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: theme.layout.cardGap,
    marginBottom: 8,
  },
});
