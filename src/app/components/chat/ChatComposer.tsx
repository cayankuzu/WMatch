import { forwardRef, memo, useCallback, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { MAX_MESSAGE_LENGTH } from '../../../shared/constants';
import { theme } from '../../../shared/theme';
import { clampMessageText, countMessageCharacters } from '../../../shared/utils/validation';

interface ChatComposerProps {
  bottomPadding: number;
  onFocusChange: (focused: boolean) => void;
  onSend: (text: string) => boolean;
  onTextActivity: (text: string) => void;
}

const COUNTER_VISIBILITY_THRESHOLD = Math.floor(MAX_MESSAGE_LENGTH * 0.8);

const ChatComposer = memo(forwardRef<TextInput, ChatComposerProps>(function ChatComposer({
  bottomPadding,
  onFocusChange,
  onSend,
  onTextActivity,
}, ref) {
  const { t } = useLocalization();
  const [text, setText] = useState('');
  const normalizedText = text.trim();
  const characterCount = countMessageCharacters(text);

  const handleTextChange = useCallback((value: string) => {
    const nextText = clampMessageText(value);
    setText(nextText);
    onTextActivity(nextText);
  }, [onTextActivity]);

  const handleSend = useCallback(() => {
    if (!normalizedText || !onSend(normalizedText)) {
      return;
    }

    setText('');
    onTextActivity('');
  }, [normalizedText, onSend, onTextActivity]);

  return (
    <View style={[styles.safeArea, { paddingBottom: bottomPadding }]}>
      <View style={styles.row}>
        <TextInput
          ref={ref}
          value={text}
          onChangeText={handleTextChange}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          placeholder={t('chat.modal.input.placeholder')}
          accessibilityLabel={t('chat.modal.input.placeholder')}
          placeholderTextColor={theme.colors.textSoft}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.sendMessage')}
          accessibilityState={{ disabled: !normalizedText }}
          hitSlop={6}
          onPress={handleSend}
          disabled={!normalizedText}
          style={[styles.sendButton, !normalizedText && styles.sendButtonDisabled]}
        >
          <MaterialCommunityIcons name="send" size={16} color={theme.colors.white} />
        </Pressable>
      </View>
      {characterCount >= COUNTER_VISIBILITY_THRESHOLD ? (
        <Text style={styles.counter}>{characterCount}/{MAX_MESSAGE_LENGTH}</Text>
      ) : null}
    </View>
  );
}));

ChatComposer.displayName = 'ChatComposer';

export default ChatComposer;

const styles = StyleSheet.create({
  safeArea: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 8,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  sendButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.disabledSurface,
  },
  counter: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'right',
    paddingHorizontal: 12,
    paddingBottom: 5,
    marginTop: -6,
  },
});
