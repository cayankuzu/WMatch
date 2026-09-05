import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import type { ApiChat } from '../../../services/api';
import { theme } from '../../../shared/theme';
import ChatAvatar from './ChatAvatar';
import TypingDots from './TypingDots';

interface ChatHeaderProps {
  chat: ApiChat;
  menuVisible: boolean;
  peerOnline: boolean;
  peerTyping: boolean;
  onBack: () => void;
  onDelete: () => void;
  onEnd: () => void;
  onOpenProfile: () => void;
  onOpenReport: () => void;
  onOpenSettings: () => void;
  onToggleBlock: () => void;
  onToggleMenu: () => void;
}

function ChatHeader({
  chat,
  menuVisible,
  peerOnline,
  peerTyping,
  onBack,
  onDelete,
  onEnd,
  onOpenProfile,
  onOpenReport,
  onOpenSettings,
  onToggleBlock,
  onToggleMenu,
}: ChatHeaderProps) {
  const { t } = useLocalization();
  const photo = chat.user.photos.find((item) => item.trim().length > 0) ?? null;
  const showPresence = !chat.ended && chat.peerSettings.onlineStatus;

  return (
    <>
      <View accessibilityViewIsModal style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={6}
            onPress={onBack}
            style={styles.iconButton}
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.text} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('a11y.openProfile', { name: chat.user.name })}
            accessibilityState={{ disabled: chat.isBlocked }}
            disabled={chat.isBlocked}
            onPress={onOpenProfile}
            style={styles.profileButton}
          >
            <ChatAvatar uri={photo} size={34} />
            <View style={styles.profileText}>
              <Text numberOfLines={2} style={styles.name}>{chat.user.name}</Text>
              <Text numberOfLines={2} style={styles.username}>{chat.user.username}</Text>
              {showPresence && peerTyping ? (
                <TypingDots label={t('chat.modal.header.typing')} />
              ) : showPresence ? (
                <Text style={[styles.status, peerOnline ? styles.online : styles.offline]}>
                  {peerOnline ? t('chat.modal.header.online') : t('chat.modal.header.offline')}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.chatMenu')}
          accessibilityState={{ expanded: menuVisible }}
          hitSlop={6}
          onPress={onToggleMenu}
          style={styles.iconButton}
        >
          <MaterialCommunityIcons name="dots-vertical" size={18} color={theme.colors.text} />
        </Pressable>
      </View>

      {menuVisible ? (
        <View accessibilityRole="menu" style={styles.menu}>
          <MenuItem icon="tune-variant" label={t('chat.modal.menu.settings')} onPress={onOpenSettings} />
          {!chat.ended && !chat.isBlocked ? (
            <MenuItem icon="message-lock-outline" label={t('chat.modal.menu.endMatch')} tone="warning" onPress={onEnd} />
          ) : null}
          <MenuItem icon="trash-can-outline" label={t('chat.modal.menu.delete')} tone="danger" onPress={onDelete} />
          <MenuItem icon="alert-circle-outline" label={t('profile.menu.report.label')} tone="danger" onPress={onOpenReport} />
          {chat.blockedByMe ? (
            <MenuItem icon="lock-open-variant-outline" label={t('chat.modal.menu.unblock')} onPress={onToggleBlock} />
          ) : !chat.blockedByOther ? (
            <MenuItem icon="block-helper" label={t('chat.modal.menu.block')} tone="danger" onPress={onToggleBlock} />
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const color = tone === 'danger'
    ? theme.colors.dangerText
    : tone === 'warning'
      ? theme.colors.warning
      : theme.colors.info;

  return (
    <Pressable accessibilityRole="menuitem" onPress={onPress} style={styles.menuItem}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <Text style={[styles.menuText, tone === 'danger' && styles.danger, tone === 'warning' && styles.warning]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: theme.layout.controlMinUnified,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButton: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.layout.controlMinUnified,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: theme.colors.text, fontSize: theme.typography.caption, fontFamily: theme.fonts.bold },
  username: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
  },
  status: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  online: { color: theme.colors.successText },
  offline: { color: theme.colors.textSoft },
  menu: {
    position: 'absolute',
    top: 76,
    right: 12,
    zIndex: 20,
    minWidth: 220,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  menuItem: {
    minHeight: theme.layout.controlMinUnified,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuText: { color: theme.colors.text, ...theme.typography.roles.meta },
  danger: { color: theme.colors.dangerText },
  warning: { color: theme.colors.warningText },
});

export default memo(ChatHeader);
