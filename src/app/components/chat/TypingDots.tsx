import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';
import useReducedMotion from '../../hooks/useReducedMotion';

interface TypingDotsProps {
  label: string;
}

export default function TypingDots({ label }: TypingDotsProps) {
  const reduceMotionEnabled = useReducedMotion();
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (reduceMotionEnabled) {
      setDotCount(3);
      return;
    }

    const intervalId = setInterval(() => {
      setDotCount((current) => (current >= 3 ? 1 : current + 1));
    }, 360);

    return () => clearInterval(intervalId);
  }, [reduceMotionEnabled]);

  return (
    <View accessible accessibilityLabel={label} style={styles.container}>
      <Text style={styles.label}>
        {label}
      </Text>
      <Text accessible={false} style={styles.dots}>{'.'.repeat(dotCount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  label: {
    color: theme.colors.successText,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  dots: {
    minWidth: 14,
    color: theme.colors.successText,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.extraBold,
  },
});
