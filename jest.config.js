module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/components/**/*.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/tmp/'],
  clearMocks: true,
};
