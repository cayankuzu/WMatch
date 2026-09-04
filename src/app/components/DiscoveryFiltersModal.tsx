import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AccessibleModal from './ui/AccessibleModal';

import {
  MAX_AGE,
  MAX_COMPATIBILITY_FILTER,
  MAX_DISTANCE_FILTER_KM,
  MIN_AGE,
  MIN_COMPATIBILITY_FILTER,
  MIN_DISTANCE_FILTER_KM,
} from '../../shared/constants';
import { useLocalization } from '../../context/LocalizationContext';
import { getLocalizedDiscoveryGenderFilterLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  DISCOVERY_GENDER_FILTERS,
  normalizeDiscoveryPreferences,
  type DiscoveryGenderFilter,
  type DiscoveryPreferences,
} from '../../shared/utils/discovery';
import AppButton from './ui/AppButton';
import OptionChips from './ui/OptionChips';
import TransientPopup from './ui/TransientPopup';
import useTransientPopup from '../hooks/useTransientPopup';

interface DiscoveryFiltersModalProps {
  value: DiscoveryPreferences;
  locationReady?: boolean;
  saving?: boolean;
  locked?: boolean;
  lockedMessage?: string;
  onLockedAction?: () => void;
  onClose: () => void;
  onSave: (value: DiscoveryPreferences) => Promise<void>;
}

const THUMB_SIZE = 22;
const THUMB_TOUCH_SIZE = 48;
const THUMB_SIDE_OFFSET = (THUMB_TOUCH_SIZE - THUMB_SIZE) / 2;

export default function DiscoveryFiltersModal({
  value,
  locationReady = false,
  saving = false,
  locked = false,
  lockedMessage,
  onLockedAction,
  onClose,
  onSave,
}: DiscoveryFiltersModalProps) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState<DiscoveryPreferences>(normalizeDiscoveryPreferences(value));
  const premiumPopup = useTransientPopup();
  const genderOptions = useMemo(
    () =>
      DISCOVERY_GENDER_FILTERS.map((genderValue) => ({
        value: genderValue,
        label: getLocalizedDiscoveryGenderFilterLabel(t, genderValue),
      })),
    [t],
  );
  const genderChanged = draft.genderPreference !== DEFAULT_DISCOVERY_PREFERENCES.genderPreference;
  const ageChanged = draft.ageMin !== DEFAULT_DISCOVERY_PREFERENCES.ageMin || draft.ageMax !== DEFAULT_DISCOVERY_PREFERENCES.ageMax;
  const distanceChanged = draft.distanceMinKm !== DEFAULT_DISCOVERY_PREFERENCES.distanceMinKm || draft.distanceMaxKm !== DEFAULT_DISCOVERY_PREFERENCES.distanceMaxKm;
  const compatibilityChanged = draft.compatibilityMin !== DEFAULT_DISCOVERY_PREFERENCES.compatibilityMin || draft.compatibilityMax !== DEFAULT_DISCOVERY_PREFERENCES.compatibilityMax;

  useEffect(() => {
    setDraft(normalizeDiscoveryPreferences(value));
  }, [value]);

  const updateDraft = (nextValue: Partial<DiscoveryPreferences>) => {
    setDraft((current) => normalizeDiscoveryPreferences({ ...current, ...nextValue }));
  };

  const handleLockedPress = () => {
    premiumPopup.showPopup(lockedMessage ?? t('premium.popup.message'));
    onLockedAction?.();
  };

  return (
    <AccessibleModal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        accessibilityViewIsModal
        importantForAccessibility="yes"
        edges={['top', 'right', 'bottom', 'left']}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.headerButton}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.title}>{t('filters.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {locked ? (
            <Pressable accessibilityRole="button" onPress={handleLockedPress} style={styles.premiumNotice}>
              <View style={styles.premiumNoticeIcon}>
                <MaterialCommunityIcons name="crown-outline" size={20} color={theme.colors.primarySoft} />
              </View>
              <View style={styles.premiumNoticeCopy}>
                <Text style={styles.premiumNoticeTitle}>{t('filters.premium.title')}</Text>
                <Text style={styles.premiumNoticeDescription}>{lockedMessage ?? t('filters.premium.description')}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.textSoft} />
            </Pressable>
          ) : null}

          <FilterSection
            icon="account-heart-outline"
            title={t('filters.gender.title')}
            description={t('filters.gender.description')}
            locked={locked}
            onLockedAction={handleLockedPress}
            onReset={!locked && genderChanged ? () => updateDraft({ genderPreference: DEFAULT_DISCOVERY_PREFERENCES.genderPreference }) : undefined}
          >
            <OptionChips<DiscoveryGenderFilter>
              options={genderOptions}
              value={draft.genderPreference}
              onChange={(genderPreference) => {
                if (locked) {
                  handleLockedPress();
                  return;
                }

                updateDraft({ genderPreference });
              }}
            />
          </FilterSection>

          <RangeSection
            title={t('filters.age.title')}
            description={t('filters.age.description')}
            minValue={draft.ageMin}
            maxValue={draft.ageMax}
            minLimit={MIN_AGE}
            maxLimit={MAX_AGE}
            step={1}
            unit=""
            locked={locked}
            onLockedAction={handleLockedPress}
            onReset={!locked && ageChanged ? () => updateDraft({
              ageMin: DEFAULT_DISCOVERY_PREFERENCES.ageMin,
              ageMax: DEFAULT_DISCOVERY_PREFERENCES.ageMax,
            }) : undefined}
            onMinChange={(ageMin) => updateDraft({ ageMin })}
            onMaxChange={(ageMax) => updateDraft({ ageMax })}
          />

          <RangeSection
            title={t('filters.distance.title')}
            description={t('filters.distance.description')}
            minValue={draft.distanceMinKm}
            maxValue={draft.distanceMaxKm}
            minLimit={MIN_DISTANCE_FILTER_KM}
            maxLimit={MAX_DISTANCE_FILTER_KM}
            step={5}
            unit=" km"
            statusLabel={locked ? undefined : locationReady ? t('filters.status.locationReady') : t('filters.status.locationPending')}
            statusTone={locationReady ? 'success' : 'warning'}
            locked={locked}
            onLockedAction={handleLockedPress}
            onReset={!locked && distanceChanged ? () => updateDraft({
              distanceMinKm: DEFAULT_DISCOVERY_PREFERENCES.distanceMinKm,
              distanceMaxKm: DEFAULT_DISCOVERY_PREFERENCES.distanceMaxKm,
            }) : undefined}
            onMinChange={(distanceMinKm) => updateDraft({ distanceMinKm })}
            onMaxChange={(distanceMaxKm) => updateDraft({ distanceMaxKm })}
          />

          <RangeSection
            title={t('filters.compatibility.title')}
            description={t('filters.compatibility.description')}
            minValue={draft.compatibilityMin}
            maxValue={draft.compatibilityMax}
            minLimit={MIN_COMPATIBILITY_FILTER}
            maxLimit={MAX_COMPATIBILITY_FILTER}
            step={1}
            unit="%"
            locked={locked}
            onLockedAction={handleLockedPress}
            onReset={!locked && compatibilityChanged ? () => updateDraft({
              compatibilityMin: DEFAULT_DISCOVERY_PREFERENCES.compatibilityMin,
              compatibilityMax: DEFAULT_DISCOVERY_PREFERENCES.compatibilityMax,
            }) : undefined}
            onMinChange={(compatibilityMin) => updateDraft({ compatibilityMin })}
            onMaxChange={(compatibilityMax) => updateDraft({ compatibilityMax })}
          />
        </ScrollView>

        <View style={styles.footer}>
          <AppButton
            title={locked ? t('filters.premium.unlock') : t('filters.save')}
            onPress={locked ? handleLockedPress : () => void onSave(draft)}
            loading={!locked && saving}
          />
        </View>

        <TransientPopup message={premiumPopup.message} bottomOffset={18} icon="crown-outline" />
      </SafeAreaView>
    </AccessibleModal>
  );
}

function FilterSection({
  children,
  description,
  icon,
  onReset,
  locked = false,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onReset?: () => void;
  locked?: boolean;
  onLockedAction?: () => void;
  title: string;
}) {
  const { t } = useLocalization();
  return (
    <View style={[styles.section, locked && styles.sectionLocked]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderMain}>
          <View style={styles.sectionIcon}>
            <MaterialCommunityIcons name={icon} size={18} color={theme.colors.primarySoft} />
          </View>
          <View style={styles.sectionText}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionDescription}>{description}</Text>
          </View>
        </View>

        {onReset ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('common.reset')} ${title}`}
            onPress={onReset}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>{t('common.reset')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.controlArea, locked && styles.controlAreaLocked]}>
        <View pointerEvents={locked ? 'none' : 'auto'} style={[styles.controlContent, locked && styles.controlContentLocked]}>
          {children}
        </View>
      </View>
    </View>
  );
}

function RangeSection({
  description,
  maxLimit,
  maxValue,
  minLimit,
  minValue,
  onMaxChange,
  onMinChange,
  onReset,
  statusLabel,
  statusTone,
  step,
  title,
  unit,
  locked = false,
}: {
  title: string;
  description: string;
  minValue: number;
  maxValue: number;
  minLimit: number;
  maxLimit: number;
  unit: string;
  step: number;
  statusLabel?: string;
  statusTone?: 'success' | 'warning';
  onReset?: () => void;
  locked?: boolean;
  onLockedAction?: () => void;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  const { t } = useLocalization();
  return (
    <View style={[styles.section, locked && styles.sectionLocked]}>
      <View style={styles.rangeHeader}>
        <View style={styles.rangeHeaderCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDescription}>{description}</Text>
        </View>

        <View style={styles.rangeHeaderActions}>
          {statusLabel ? (
            <View style={[styles.statusPill, statusTone === 'success' ? styles.statusPillSuccess : styles.statusPillWarning]}>
              <Text style={[styles.statusPillText, statusTone === 'success' ? styles.statusPillTextSuccess : styles.statusPillTextWarning]}>
                {statusLabel}
              </Text>
            </View>
          ) : null}

          {onReset ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('common.reset')} ${title}`}
              onPress={onReset}
              style={styles.resetButton}
            >
              <Text style={styles.resetButtonText}>{t('common.reset')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.controlArea, locked && styles.controlAreaLocked]}>
        <View pointerEvents={locked ? 'none' : 'auto'} style={[styles.controlContent, locked && styles.controlContentLocked]}>
          <View style={styles.rangeValues}>
            <ValuePill label={t('common.min')} value={`${minValue}${unit}`} />
            <ValuePill label={t('common.max')} value={`${maxValue}${unit}`} />
          </View>

          <DualRangeSlider
            label={title}
            minValue={minValue}
            maxValue={maxValue}
            minLimit={minLimit}
            maxLimit={maxLimit}
            step={step}
            onMinChange={onMinChange}
            onMaxChange={onMaxChange}
          />

          <View style={styles.rangeFooter}>
            <Text style={styles.rangeFooterText}>
              {t('filters.lowerBound', { value: `${minLimit}${unit}` })}
            </Text>
            <Text style={styles.rangeFooterText}>
              {t('filters.upperBound', { value: `${maxLimit}${unit}` })}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function DualRangeSlider({
  label,
  maxLimit,
  maxValue,
  minLimit,
  minValue,
  onMaxChange,
  onMinChange,
  step,
}: {
  label: string;
  minValue: number;
  maxValue: number;
  minLimit: number;
  maxLimit: number;
  step: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  const { t } = useLocalization();
  const [trackWidth, setTrackWidth] = useState(0);
  const innerTrackWidth = Math.max(0, trackWidth - THUMB_SIZE);
  const range = Math.max(1, maxLimit - minLimit);
  const dragStartRef = useRef(0);

  const valueToPosition = (value: number) => {
    if (innerTrackWidth <= 0) {
      return THUMB_SIZE / 2;
    }

    return ((value - minLimit) / range) * innerTrackWidth + THUMB_SIZE / 2;
  };
  const positionToValue = (position: number) => {
    if (innerTrackWidth <= 0) {
      return minLimit;
    }

    const normalizedPosition = Math.min(Math.max(position - THUMB_SIZE / 2, 0), innerTrackWidth);
    const ratio = normalizedPosition / innerTrackWidth;
    const rawValue = minLimit + ratio * range;
    const steppedValue = Math.round((rawValue - minLimit) / step) * step + minLimit;
    return Math.min(maxLimit, Math.max(minLimit, steppedValue));
  };

  const minPosition = valueToPosition(minValue);
  const maxPosition = valueToPosition(maxValue);

  const applyThumbPosition = (thumb: 'min' | 'max', position: number) => {
    const nextValue = positionToValue(position);

    if (thumb === 'min') {
      const clamped = Math.min(nextValue, maxValue);

      if (clamped !== minValue) {
        onMinChange(clamped);
      }

      return;
    }

    const clamped = Math.max(nextValue, minValue);

    if (clamped !== maxValue) {
      onMaxChange(clamped);
    }
  };
  const adjustThumbValue = (thumb: 'min' | 'max', direction: 'increment' | 'decrement') => {
    const delta = direction === 'increment' ? step : -step;

    if (thumb === 'min') {
      onMinChange(Math.min(maxValue, Math.max(minLimit, minValue + delta)));
      return;
    }

    onMaxChange(Math.max(minValue, Math.min(maxLimit, maxValue + delta)));
  };

  const minResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStartRef.current = minPosition;
        },
        onPanResponderMove: (_, gestureState) => {
          applyThumbPosition('min', dragStartRef.current + gestureState.dx);
        },
      }),
    [innerTrackWidth, maxLimit, maxValue, minLimit, minPosition, minValue, onMinChange, step],
  );

  const maxResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStartRef.current = maxPosition;
        },
        onPanResponderMove: (_, gestureState) => {
          applyThumbPosition('max', dragStartRef.current + gestureState.dx);
        },
      }),
    [innerTrackWidth, maxLimit, maxPosition, maxValue, minLimit, minValue, onMaxChange, step],
  );

  return (
    <View style={styles.sliderShell}>
      <View style={styles.sliderTouchArea}>
        <View
          onLayout={(event) => {
            const nextWidth = event.nativeEvent.layout.width;

            if (nextWidth > 0 && Math.abs(nextWidth - trackWidth) > 1) {
              setTrackWidth(nextWidth);
            }
          }}
          style={styles.sliderTrack}
        >
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={(event) => {
              const position = event.nativeEvent.locationX;
              const nearestThumb = Math.abs(position - minPosition) <= Math.abs(position - maxPosition) ? 'min' : 'max';
              applyThumbPosition(nearestThumb, position);
            }}
            style={styles.sliderTrackPressable}
          />

          <View style={styles.sliderTrackBase} />
          <View
            style={[
              styles.sliderTrackActive,
              {
                left: minPosition,
                width: Math.max(0, maxPosition - minPosition),
              },
            ]}
          />

          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${label} ${t('common.min')}`}
            accessibilityValue={{ min: minLimit, max: maxLimit, now: minValue, text: `${minValue}` }}
            accessibilityActions={[
              { name: 'increment', label: t('common.max') },
              { name: 'decrement', label: t('common.min') },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') {
                adjustThumbValue('min', 'increment');
              } else if (event.nativeEvent.actionName === 'decrement') {
                adjustThumbValue('min', 'decrement');
              }
            }}
            style={[
              styles.sliderThumbWrap,
              { left: Math.min(Math.max(0, trackWidth - THUMB_TOUCH_SIZE), Math.max(0, minPosition - THUMB_SIZE / 2 - THUMB_SIDE_OFFSET)) },
            ]}
            {...minResponder.panHandlers}
          >
            <View style={styles.sliderThumb} />
          </View>

          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${label} ${t('common.max')}`}
            accessibilityValue={{ min: minLimit, max: maxLimit, now: maxValue, text: `${maxValue}` }}
            accessibilityActions={[
              { name: 'increment', label: t('common.max') },
              { name: 'decrement', label: t('common.min') },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') {
                adjustThumbValue('max', 'increment');
              } else if (event.nativeEvent.actionName === 'decrement') {
                adjustThumbValue('max', 'decrement');
              }
            }}
            style={[
              styles.sliderThumbWrap,
              { left: Math.min(Math.max(0, trackWidth - THUMB_TOUCH_SIZE), Math.max(0, maxPosition - THUMB_SIZE / 2 - THUMB_SIDE_OFFSET)) },
            ]}
            {...maxResponder.panHandlers}
          >
            <View style={styles.sliderThumb} />
          </View>
        </View>
      </View>
    </View>
  );
}

function ValuePill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.valuePill}>
      <Text style={styles.valuePillLabel}>{label}</Text>
      <Text style={styles.valuePillValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  headerButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  headerSpacer: {
    width: 38,
    height: 38,
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.sectionTitle,
  },
  content: {
    padding: 14,
    gap: 10,
  },
  premiumNotice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.alpha.brand22,
    backgroundColor: theme.colors.primarySurface,
    padding: 14,
  },
  premiumNoticeIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundElevated,
  },
  premiumNoticeCopy: {
    flex: 1,
    gap: 3,
  },
  premiumNoticeTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  premiumNoticeDescription: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  section: {
    position: 'relative',
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    gap: 10,
  },
  sectionLocked: {
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.alpha.white05,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionHeaderMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  sectionText: {
    flex: 1,
    gap: 4,
  },
  controlArea: {
    position: 'relative',
  },
  controlAreaLocked: {
    borderRadius: theme.radius.card,
  },
  controlContent: {
    gap: 10,
  },
  controlContentLocked: {
    opacity: 0.72,
  },
  sectionTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  sectionDescription: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  rangeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  rangeHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  rangeHeaderActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  resetButton: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  resetButtonLocked: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  resetButtonText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  resetButtonTextLocked: {
    color: theme.colors.textSoft,
  },
  statusPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statusPillSuccess: {
    backgroundColor: theme.colors.successSurface,
  },
  statusPillWarning: {
    backgroundColor: theme.colors.warningSurface,
  },
  statusPillText: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  statusPillTextSuccess: {
    color: theme.colors.successText,
  },
  statusPillTextWarning: {
    color: theme.colors.warningText,
  },
  rangeValues: {
    flexDirection: 'row',
    gap: 6,
  },
  valuePill: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  valuePillLabel: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  valuePillValue: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
    fontVariant: ['tabular-nums'],
  },
  sliderShell: {
    gap: 8,
  },
  sliderTouchArea: {
    paddingVertical: 8,
    paddingHorizontal: THUMB_SIDE_OFFSET,
  },
  sliderTrack: {
    height: THUMB_TOUCH_SIZE,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrackPressable: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
  },
  sliderTrackBase: {
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
  },
  sliderTrackActive: {
    position: 'absolute',
    top: (THUMB_TOUCH_SIZE - 6) / 2,
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primarySoft,
  },
  sliderThumbWrap: {
    position: 'absolute',
    top: 0,
    width: THUMB_TOUCH_SIZE,
    height: THUMB_TOUCH_SIZE,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  sliderThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.pill,
    borderWidth: 3,
    borderColor: theme.colors.background,
    backgroundColor: theme.colors.white,
  },
  rangeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  rangeFooterText: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.radius.card,
    backgroundColor: theme.alpha.background06,
  },
});
