import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useId, useState, type ReactNode } from 'react';

import { theme } from '../../../shared/theme';

interface AppTextFieldProps {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string;
  errorText?: string;
  editable?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: TextInputProps['autoComplete'];
  autoCorrect?: boolean;
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  accessibilityLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  rightIconAccessibilityLabel?: string;
  onRightIconPress?: () => void;
}

export default function AppTextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  errorText,
  editable = true,
  secureTextEntry = false,
  keyboardType = 'default',
  multiline = false,
  maxLength,
  autoCapitalize = 'none',
  autoComplete,
  autoCorrect,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  accessibilityLabel,
  leftIcon,
  rightIcon,
  rightIconAccessibilityLabel,
  onRightIconPress,
}: AppTextFieldProps) {
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const labelId = `${generatedId}-label`;
  const supportTextId = `${generatedId}-support`;
  const [focused, setFocused] = useState(false);
  const supportText = errorText ?? hint;
  const labelRaised = focused || value.length > 0;
  const resolvedPlaceholder = label && !labelRaised ? undefined : placeholder;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.field,
          label && styles.fieldWithLabel,
          multiline && styles.multilineField,
          focused && styles.fieldFocused,
          Boolean(value) && styles.fieldFilled,
          !editable && styles.fieldDisabled,
          errorText && styles.fieldError,
        ]}
      >
        {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
        {label ? (
          <Text
            nativeID={labelId}
            pointerEvents="none"
            numberOfLines={1}
            style={[
              styles.floatingLabel,
              Boolean(leftIcon) && styles.floatingLabelWithLeftIcon,
              labelRaised ? styles.floatingLabelRaised : styles.floatingLabelResting,
              focused && styles.floatingLabelFocused,
              errorText && styles.floatingLabelError,
              !editable && styles.floatingLabelDisabled,
            ]}
          >
            {label}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityLabelledBy={Platform.OS === 'android' && label ? labelId : undefined}
          accessibilityHint={supportText}
          accessibilityState={{ disabled: !editable }}
          value={value}
          onChangeText={onChangeText}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={theme.colors.textSoft}
          editable={editable}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          importantForAutofill={autoComplete || textContentType ? 'yes' : 'auto'}
          selectionColor={theme.colors.accentText}
          style={[
            styles.input,
            label && styles.inputWithLabel,
            multiline && styles.multilineInput,
            !editable && styles.inputDisabled,
          ]}
        />
        {rightIcon && onRightIconPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rightIconAccessibilityLabel ?? label}
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
            hitSlop={4}
            onPress={onRightIconPress}
            style={styles.rightIcon}
          >
            {rightIcon}
          </Pressable>
        ) : rightIcon ? (
          <View accessible={false} style={styles.rightIcon}>
            {rightIcon}
          </View>
        ) : null}
      </View>
      {errorText ? (
        <Text nativeID={supportTextId} accessibilityLiveRegion="polite" style={styles.errorText}>{errorText}</Text>
      ) : hint ? (
        <Text nativeID={supportTextId} style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 4,
  },
  field: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  fieldWithLabel: {
    position: 'relative',
  },
  fieldFocused: {
    borderColor: theme.colors.borderFocus,
    borderWidth: 2,
  },
  fieldFilled: {
    borderColor: theme.colors.borderDefault,
  },
  fieldError: {
    borderColor: theme.colors.dangerText,
  },
  multilineField: {
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  fieldDisabled: {
    backgroundColor: theme.colors.disabledSurface,
    borderColor: theme.colors.borderDefault,
  },
  leftIcon: {
    marginTop: 1,
  },
  floatingLabel: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 1,
    color: theme.colors.textSoft,
    fontFamily: theme.fonts.semibold,
  },
  floatingLabelWithLeftIcon: {
    left: 42,
  },
  floatingLabelRaised: {
    top: 5,
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
  },
  floatingLabelResting: {
    top: 11,
    fontSize: theme.typography.roles.body.fontSize,
    lineHeight: theme.typography.roles.body.lineHeight,
  },
  floatingLabelFocused: {
    color: theme.colors.primarySoft,
  },
  floatingLabelError: {
    color: theme.colors.dangerText,
  },
  floatingLabelDisabled: {
    color: theme.colors.textMuted,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    ...theme.typography.roles.body,
    paddingVertical: 7,
  },
  inputWithLabel: {
    paddingTop: 15,
    paddingBottom: 3,
  },
  multilineInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    color: theme.colors.textMuted,
  },
  hint: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
  },
  errorText: {
    color: theme.colors.dangerText,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  rightIcon: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
