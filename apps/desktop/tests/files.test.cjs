const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileStore } = require('../dist/main/FileStore');

test('integrated project storage rejects paths outside the authorized project', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'latexllm-files-'));
    try {
        const store = new FileStore(folder);
        store.initProjectDirectory('owned');
        store.saveFile('owned', 'chapters/intro.tex', 'safe content');
        assert.equal(store.readFile('owned', 'chapters/intro.tex'), 'safe content');
        assert.throws(() => store.readFile('owned', '../outside.tex'), /outside/);
        assert.throws(() => store.saveFile('../escape', 'main.tex', 'bad'), /identifier/);
        assert.throws(() => store.saveFile('owned', '../escape.tex', 'bad'), /outside/);
        assert.throws(() => store.saveFile('owned', 'script.exe', 'bad'), /Unsupported/);
    } finally {
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
        assert.match(path.basename(folder), /^latexllm-files-/);
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
