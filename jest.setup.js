jest.mock('react-native-reanimated', () => {
  const { Image, ScrollView, Text, View } = require('react-native');
  const immediateTransition = {
    duration() {
      return immediateTransition;
    },
  };

  return {
    __esModule: true,
    default: { Image, ScrollView, Text, View },
    FadeInDown: immediateTransition,
    FadeOutDown: immediateTransition,
    runOnJS: (callback) => callback,
    useAnimatedStyle: (factory) => factory(),
    useSharedValue: (value) => ({ value }),
    withTiming: (value) => value,
  };
});
