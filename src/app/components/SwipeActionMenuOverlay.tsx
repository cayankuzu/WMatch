import { useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { blockUser, submitUserReport, type ApiUser } from '../../services/api';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';

const REPORT_REASON_OPTIONS = [
  'fake_profile',
  'harassment',
  'spam',
  'nudity',
  'underage',
  'hate_speech',
  'other',
] as const;

type ReportReasonCode = (typeof REPORT_REASON_OPTIONS)[number];

const MIN_REPORT_DETAILS_LENGTH = 20;
const MAX_REPORT_DETAILS_LENGTH = 1500;

interface SwipeActionMenuOverlayProps {
  visible: boolean;
  user: ApiUser | null;
  reportSource: string;
  onClose: () => void;
  onBlockSuccess?: (user: ApiUser) => Promise<void> | void;
  showFeedback?: (message: string, durationMs?: number) => void;
}

export default function SwipeActionMenuOverlay({
  visible,
  user,
  reportSource,
  onClose,
  onBlockSuccess,
  showFeedback,
}: SwipeActionMenuOverlayProps) {
  const { user: currentUser } = useAuth();
  const { t } = useLocalization();
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReasonCode>('fake_profile');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    setShowReportForm(false);
    setReportReason('fake_profile');
    setReportDetails('');
  }, [user?.id]);

  const closeReportForm = (force = false) => {
    if (reportSubmitting && !force) {
      return;
    }

    setShowReportForm(false);
    setReportReason('fake_profile');
    setReportDetails('');
  };

  const handleBlockUser = () => {
    if (!user || blockBusy) {
      return;
    }

    Alert.alert(
      t('chat.modal.alert.block.addTitle'),
      t('chat.modal.alert.block.addDescription', { name: user.name }),
      [
        { text: t('chat.modal.alert.cancel'), style: 'cancel' },
        {
          text: t('chat.modal.alert.block.addConfirm'),
          style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            onClose();

            try {
              await blockUser(user.id);
              showFeedback?.(t('swipe.feedback.blocked', { name: user.name }));
              try {
                await onBlockSuccess?.(user);
              } catch (error) {
                console.error('Swipe action block follow-up error:', error);
              }
            } catch (error) {
              Alert.alert(
                t('chat.modal.alert.block.addFailed'),
                error instanceof Error ? error.message : t('profile.report.errorDescription'),
              );
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleReportSubmit = async () => {
    if (!currentUser?.id || !user) {
      Alert.alert(t('profile.report.errorTitle'), t('profile.report.errorDescription'));
      return;
    }

    const normalizedDetails = reportDetails.trim();

    if (normalizedDetails.length < MIN_REPORT_DETAILS_LENGTH) {
      Alert.alert(t('profile.report.validation.title'), t('profile.report.validation.detailsMin'));
      return;
    }

    setReportSubmitting(true);

    try {
      await submitUserReport({
        targetUserId: user.id,
        reasonCode: reportReason,
        details: normalizedDetails,
        clientContext: {
          platform: Platform.OS,
          appVersion: Application.nativeApplicationVersion ?? null,
          buildVersion: Application.nativeBuildVersion ?? null,
          reportedFrom: reportSource,
          reportedAt: new Date().toISOString(),
        },
      });

      closeReportForm(true);
      onClose();
      showFeedback?.(t('profile.report.successDescription'), 2200);
    } catch (error) {
      Alert.alert(
        t('profile.report.errorTitle'),
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('profile.report.errorDescription'),
      );
    } finally {
      setReportSubmitting(false);
    }
  };

  if (!user || (!visible && !showReportForm)) {
    return null;
  }

  return (
    <>
      {visible ? (
        <View style={styles.menu}>
          <Pressable
            onPress={() => {
              onClose();
              setShowReportForm(true);
            }}
            style={styles.menuItem}
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.colors.warning} />
            <Text style={styles.menuText}>{t('profile.menu.report.label')}</Text>
          </Pressable>

          <Pressable onPress={handleBlockUser} style={styles.menuItem}>
            <MaterialCommunityIcons name="block-helper" size={16} color={theme.colors.warning} />
            <Text style={styles.menuText}>{t('chat.modal.menu.block')}</Text>
          </Pressable>
        </View>
      ) : null}

      {showReportForm ? (
        <View style={styles.reportOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.reportCard}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.reportContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.reportHeader}>
                <Text style={styles.reportTitle}>{t('profile.report.sheet.title')}</Text>
                <Text style={styles.reportSubtitle}>{t('profile.report.sheet.description')}</Text>
              </View>

              <View style={styles.reasonGrid}>
                {REPORT_REASON_OPTIONS.map((reason) => {
                  const selected = reportReason === reason;

                  return (
                    <Pressable
                      key={reason}
                      accessibilityRole="radio"
                      accessibilityLabel={t(`profile.report.reason.${reason}`)}
                      accessibilityState={{ checked: selected }}
                      onPress={() => setReportReason(reason)}
                      style={[styles.reasonChip, selected && styles.reasonChipActive]}
                    >
                      <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>
                        {t(`profile.report.reason.${reason}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.detailsSection}>
                <Text style={styles.detailsLabel}>{t('profile.report.detailsLabel')}</Text>
                <TextInput
                  multiline
                  maxLength={MAX_REPORT_DETAILS_LENGTH}
                  editable={!reportSubmitting}
                  placeholder={t('profile.report.detailsPlaceholder')}
                  placeholderTextColor={theme.colors.textSoft}
                  style={styles.detailsInput}
                  textAlignVertical="top"
                  value={reportDetails}
                  onChangeText={setReportDetails}
                />
                <Text style={styles.detailsCounter}>
                  {reportDetails.trim().length}/{MAX_REPORT_DETAILS_LENGTH}
                </Text>
              </View>

              <View style={styles.reportActions}>
                <AppButton title={t('profile.report.submit')} onPress={() => void handleReportSubmit()} loading={reportSubmitting} />
                <AppButton title={t('common.cancel')} onPress={closeReportForm} variant="secondary" />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    top: 76,
    right: 16,
    zIndex: 24,
    minWidth: 164,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  menuText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  reportOverlay: {
    zIndex: 26,
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.scrim,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  reportCard: {
    maxHeight: '82%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  reportContent: {
    padding: 16,
    gap: 16,
  },
  reportHeader: {
    gap: 6,
  },
  reportTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  reportSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonChip: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
  },
  reasonChipActive: {
    borderColor: theme.colors.warningText,
    backgroundColor: theme.colors.warningSurface,
  },
  reasonChipText: {
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  reasonChipTextActive: {
    color: theme.colors.warningText,
  },
  detailsSection: {
    gap: 8,
  },
  detailsLabel: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  detailsInput: {
    minHeight: 148,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 20,
  },
  detailsCounter: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
    textAlign: 'right',
  },
  reportActions: {
    gap: 10,
  },
});
