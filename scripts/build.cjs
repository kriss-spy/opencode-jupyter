const { build, context } = require('esbuild');
const fs = require('node:fs');
fs.mkdirSync('artifacts', { recursive: true });
const watching = process.argv.includes('--watch');
const options = { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true,
  external: ['vscode'], platform: 'node', format: 'cjs', target: 'node20', sourcemap: watching,
  legalComments: 'eof', metafile: true, plugins: watching ? [{ name: 'watch-status', setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd(() => console.log('[watch] build finished'));
  } }] : [] };
const building = watching ? context(options).then(async active => { await active.watch(); }) : build(options);
building.then(result => {
  if (!result) { return; }
  fs.writeFileSync('artifacts/bundle-meta.json', JSON.stringify(result.metafile, null, 2));
  const path = require('node:path');
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs).filter(value => value.startsWith('node_modules/'))) {
    let directory = path.dirname(path.resolve(input));
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (pkg.name) { packages.set(pkg.name, { ...pkg, directory }); break; }
      }
      directory = path.dirname(directory);
    }
  }
  const notices = [...packages.values()].sort((a,b) => a.name.localeCompare(b.name)).map(pkg => {
    const licenses = fs.readdirSync(pkg.directory).filter(name => /^(license|copying|notice)(\.|$)/i.test(name));
    return `${pkg.name}@${pkg.version} (${pkg.license ?? 'see upstream license'})\n` + licenses.map(name =>
      fs.readFileSync(path.join(pkg.directory, name), 'utf8')).join('\n');
  });
  fs.writeFileSync('THIRD_PARTY_NOTICES.txt', 'Bundled runtime dependency licenses\n\n' + notices.join('\n\n--------------------\n\n'));
}).catch(error => { console.error(error); process.exitCode = 1; });
