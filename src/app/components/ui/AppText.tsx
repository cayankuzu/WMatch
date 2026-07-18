import { Text, type StyleProp, type TextStyle, type TextProps } from 'react-native';

import { theme } from '../../../shared/theme';

type TextVariant = keyof typeof theme.typography.roles;
type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'inverse';

interface AppTextProps extends Omit<TextProps, 'style'> {
  children: TextProps['children'];
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
  maxLines?: number;
  style?: StyleProp<TextStyle>;
}

const toneStyles: Record<TextTone, TextStyle> = {
  primary: { color: theme.colors.textPrimary },
  secondary: { color: theme.colors.textSecondary },
  tertiary: { color: theme.colors.textTertiary },
  accent: { color: theme.colors.accentText },
  success: { color: theme.colors.successText },
  warning: { color: theme.colors.warningText },
  danger: { color: theme.colors.dangerText },
  inverse: { color: theme.colors.white },
};

export default function AppText({
  children,
  variant = 'body',
  tone = 'primary',
  weight,
  align,
  maxLines,
  accessibilityRole,
  style,
  ...props
}: AppTextProps) {
  return (
    <Text
      accessibilityRole={accessibilityRole}
      numberOfLines={maxLines}
      style={[
        theme.typography.roles[variant],
        toneStyles[tone],
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}
