/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Mirrors tsconfig.json's `paths` — Metro resolves "@/*" natively from
  // tsconfig for the running app, but Jest's module resolution needs it
  // spelled out explicitly.
  moduleNameMapper: {
    // Metro/NativeWind understands global.css; Jest's transform pipeline
    // doesn't need to — it never renders real styles, only the RN tree shape.
    '\\.css$': '<rootDir>/jest/style-mock.js',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
