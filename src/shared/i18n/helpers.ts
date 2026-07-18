import type { DiscoveryGenderFilter, UserGender } from '../utils/discovery';
import type { Translate } from './messages';

export function getLocalizedUserGenderLabel(t: Translate, value: UserGender) {
  if (value === 'female') {
    return t('gender.female');
  }

  if (value === 'male') {
    return t('gender.male');
  }

  if (value === 'nonbinary') {
    return t('gender.nonbinary');
  }

  return t('gender.other');
}

export function getLocalizedDiscoveryGenderFilterLabel(
  t: Translate,
  value: DiscoveryGenderFilter,
) {
  if (value === 'random') {
    return t('gender.random');
  }

  return getLocalizedUserGenderLabel(t, value);
}

export function getLocalizedMediaFilterLabel(
  t: Translate,
  value: 'all' | 'movie' | 'tv',
) {
  if (value === 'movie') {
    return t('common.movie');
  }

  if (value === 'tv') {
    return t('common.series');
  }

  return t('common.all');
}
