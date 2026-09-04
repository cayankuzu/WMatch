import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';
import AppButton from '../ui/AppButton';
import AppModal from '../ui/AppModal';

export const CHAT_REPORT_REASON_OPTIONS = [
  'fake_profile',
  'harassment',
  'spam',
  'nudity',
  'underage',
  'hate_speech',
  'other',
] as const;

export type ChatReportReason = (typeof CHAT_REPORT_REASON_OPTIONS)[number];

export const MIN_CHAT_REPORT_DETAILS_LENGTH = 20;
export const MAX_CHAT_REPORT_DETAILS_LENGTH = 1500;

interface ChatReportFormProps {
  visible: boolean;
  reason: ChatReportReason;
  details: string;
  submitting: boolean;
  onReasonChange: (reason: ChatReportReason) => void;
  onDetailsChange: (details: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function ChatReportForm({
  visible,
  reason,
  details,
  submitting,
  onReasonChange,
  onDetailsChange,
  onSubmit,
  onClose,
}: ChatReportFormProps) {
  const { t } = useLocalization();

  return (
    <AppModal
      visible={visible}
      title={t('profile.report.sheet.title')}
      presentation="sheet"
      keyboardAware
      scrollable
      onClose={onClose}
    >
      <Text style={styles.subtitle}>{t('profile.report.sheet.description')}</Text>

      <View accessibilityRole="radiogroup" style={styles.reasonGrid}>
        {CHAT_REPORT_REASON_OPTIONS.map((option) => {
          const selected = reason === option;

          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={t(`profile.report.reason.${option}`)}
              accessibilityState={{ checked: selected }}
              disabled={submitting}
              onPress={() => onReasonChange(option)}
              style={[styles.reasonChip, selected && styles.reasonChipActive]}
            >
              <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>
                {t(`profile.report.reason.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.detailsSection}>
        <Text style={styles.detailsLabel}>{t('profile.report.detailsLabel')}</Text>
        <TextInput
          multiline
          maxLength={MAX_CHAT_REPORT_DETAILS_LENGTH}
          editable={!submitting}
          accessibilityLabel={t('profile.report.detailsLabel')}
          accessibilityHint={t('profile.report.detailsPlaceholder')}
          placeholder={t('profile.report.detailsPlaceholder')}
          placeholderTextColor={theme.colors.textSoft}
          style={styles.detailsInput}
          textAlignVertical="top"
          value={details}
          onChangeText={onDetailsChange}
        />
        <Text style={styles.detailsCounter}>
          {details.trim().length}/{MAX_CHAT_REPORT_DETAILS_LENGTH}
        </Text>
      </View>

      <View style={styles.actions}>
        <AppButton
          title={t('profile.report.submit')}
          onPress={onSubmit}
          loading={submitting}
        />
        <AppButton
          title={t('common.cancel')}
          onPress={onClose}
          variant="secondary"
        />
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reasonChip: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
  },
  reasonChipActive: {
    borderColor: theme.colors.dangerText,
    backgroundColor: theme.colors.dangerSurface,
  },
  reasonChipText: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  reasonChipTextActive: {
    color: theme.colors.dangerText,
  },
  detailsSection: {
    gap: 6,
  },
  detailsLabel: {
    color: theme.colors.text,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.bold,
  },
  detailsInput: {
    minHeight: 124,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: theme.typography.body,
    lineHeight: 21,
  },
  detailsCounter: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'right',
  },
  actions: {
    gap: 8,
  },
});
