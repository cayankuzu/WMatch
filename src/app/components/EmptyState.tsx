import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../shared/theme';

interface EmptyStateProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description?: string;
}

export default function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
      <MaterialCommunityIcons name={icon} size={22} color={theme.colors.primarySoft} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 6,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha.primary12,
    borderWidth: 1,
    borderColor: theme.alpha.primary18,
    marginBottom: 4,
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
    textAlign: 'center',
  },
  description: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
    textAlign: 'center',
  },
});
