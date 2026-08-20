module.exports = function configureBabel(api) {
  api.cache(true);

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';

  return {
    presets: ['babel-preset-expo'],
    plugins: isProduction ? ['transform-remove-console'] : [],
  };
};
