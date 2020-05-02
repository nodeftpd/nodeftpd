module.exports = {
    env: {
      browser: true,
      commonjs: true,
      es6: true,
    },
    extends: [
      'airbnb-base',
    ],
    globals: {
      Atomics: 'readonly',
      SharedArrayBuffer: 'readonly',
    },
    parserOptions: {
      ecmaVersion: 2018,
    },
    rules: {
        'array-callback-return': 1,
        'consistent-return': 1,
        'max-len': 1,
        'no-bitwise': 1,
        'no-empty': 1,
        'no-inner-declarations': 1,
        'no-lonely-if': 1,
        'no-param-reassign': 1,
        'no-plusplus': 1,
        'no-restricted-globals': 1,
        'no-shadow': 1,
        'no-undef': 1,
        'no-underscore-dangle': 0,
        'no-unused-expressions': 1,
        'no-use-before-define': 1,
        'prefer-destructuring': 1,
        'prefer-rest-params': 1,
        'prefer-spread': 1,
    },
  };