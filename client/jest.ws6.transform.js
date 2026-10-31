// The app uses TypeScript 7, which ts-jest cannot run; esbuild strips the types instead.
const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    const { code, map } = transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
      sourcemap: 'inline',
      sourcefile: filename
    });
    return { code, map };
  }
};