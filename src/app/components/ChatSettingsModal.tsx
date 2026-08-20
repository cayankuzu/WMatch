import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import type { TranslationKey } from '../../shared/i18n/messages';
import type { ChatSettingKey, ChatSettings } from '../../shared/types';
import { theme } from '../../shared/theme';
import AccessibleModal from './ui/AccessibleModal';

interface ChatSettingsModalProps {
  value: ChatSettings;
  saving?: boolean;
  onClose: () => void;
  onChange: (settings: ChatSettings) => void;
}

const settings: Array<{
  key: ChatSettingKey;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  iconColor: string;
  iconBackground: string;
}> = [
  {
    key: 'readReceipts',
    icon: 'eye-outline',
    titleKey: 'chat.modal.settings.readReceipts.title',
    descriptionKey: 'chat.modal.settings.readReceipts.description',
    iconColor: theme.colors.accentText,
    iconBackground: theme.colors.primarySurface,
  },
  {
    key: 'onlineStatus',
    icon: 'wifi',
    titleKey: 'chat.modal.settings.onlineStatus.title',
    descriptionKey: 'chat.modal.settings.onlineStatus.description',
    iconColor: theme.colors.successText,
    iconBackground: theme.colors.successSurface,
  },
  {
    key: 'typingIndicator',
    icon: 'message-processing-outline',
    titleKey: 'chat.modal.settings.typingIndicator.title',
    descriptionKey: 'chat.modal.settings.typingIndicator.description',
    iconColor: theme.colors.infoText,
    iconBackground: theme.colors.infoSurface,
  },
  {
    key: 'notifications',
    icon: 'bell-outline',
    titleKey: 'chat.modal.settings.notifications.title',
    descriptionKey: 'chat.modal.settings.notifications.description',
    iconColor: theme.colors.warningText,
    iconBackground: theme.colors.warningSurface,
  },
];

export default function ChatSettingsModal({
  value,
  saving = false,
  onClose,
  onChange,
}: ChatSettingsModalProps) {
  const { t } = useLocalization();

  return (
    <AccessibleModal transparent visible animationType="fade" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />

        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('chat.modal.settings.title')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
              {saving ? (
                <ActivityIndicator size="small" color={theme.colors.primarySoft} />
              ) : (
                <MaterialCommunityIcons name="close" size={20} color={theme.colors.text} />
              )}
            </Pressable>
          </View>

          <View style={styles.list}>
            {settings.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="switch"
                accessibilityLabel={`${t(item.titleKey)}. ${t(item.descriptionKey)}`}
                accessibilityState={{ checked: value[item.key], disabled: saving }}
                disabled={saving}
                onPress={() => onChange({ ...value, [item.key]: !value[item.key] })}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                  <View style={[styles.iconWrap, { backgroundColor: item.iconBackground }]}>
                    <MaterialCommunityIcons name={item.icon} size={20} color={item.iconColor} />
                  </View>

                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t(item.titleKey)}</Text>
                    <Text style={styles.rowDescription}>{t(item.descriptionKey)}</Text>
                  </View>

                  <Switch
                    accessible={false}
                    disabled={saving}
                    pointerEvents="none"
                    value={value[item.key]}
                    trackColor={{
                      false: theme.colors.borderDefault,
                      true: theme.colors.primary,
                    }}
                    thumbColor={theme.colors.white}
                  />
                </Pressable>
            ))}
          </View>
        </View>

      </View>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.scrim,
    paddingHorizontal: 14,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: theme.radius.modal,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.extraBold,
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: theme.layout.controlMinUnified,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  rowDescription: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
  },
});
