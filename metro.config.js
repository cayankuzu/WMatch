const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
const getTransformOptions = config.transformer.getTransformOptions;

config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);

  return {
    ...options,
    transform: {
      ...options.transform,
      // Defer non-critical module evaluation until first use to reduce JS cold-start work.
      inlineRequires: true,
    },
  };
};

module.exports = config;
