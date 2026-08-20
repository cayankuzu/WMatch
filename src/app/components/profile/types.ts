import type { UserGender } from '../../../shared/utils/discovery';

export interface ProfileCardUser {
  id?: string;
  name: string;
  age?: number;
  showAgeOnProfile?: boolean;
  gender?: UserGender;
  showGenderOnProfile?: boolean;
  username: string;
  photos: string[];
  bio?: string;
  letterboxd?: string;
  favoriteMovies?: number[];
  watchedMovies?: number[];
}
