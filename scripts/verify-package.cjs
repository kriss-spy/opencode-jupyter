const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const version=require('../package.json').version;
const artifact=path.resolve(`artifacts/opencode-jupyter-${version}.vsix`);
const files=execFileSync('unzip',['-Z1',artifact],{encoding:'utf8'}).trim().split('\n');
for(const needed of ['extension/package.json','extension/dist/extension.js','extension/README.md','extension/CHANGELOG.md','extension/LICENSE.txt','extension/THIRD_PARTY_NOTICES.txt']) {
  assert.ok(files.some(file=>file.toLowerCase()===needed.toLowerCase()),`Missing packaged ${needed}`);
}
assert.ok(!files.some(file=>/node_modules|opencode\.json|\.ipynb|\.docx|\/test\/|\/docs\/|\/src\//.test(file)),'Development/config artifacts included');
const source=execFileSync('unzip',['-p',artifact,'extension/dist/extension.js'],{encoding:'utf8',maxBuffer:16*1024*1024});
const packageModule=new Module(path.resolve('artifacts/isolated-extension.js'));
packageModule.filename=path.resolve('artifacts/isolated-extension.js');
const builtins=new Set(Module.builtinModules);
packageModule.require=id=>{
  if(id==='vscode') return {};
  if(id.startsWith('node:') || builtins.has(id)) return require(id);
  throw Error(`Unbundled runtime dependency: ${id}`);
};
packageModule._compile(source,packageModule.filename);
assert.equal(typeof packageModule.exports.activate,'function');
assert.equal(typeof packageModule.exports.deactivate,'function');
const packageJson=JSON.parse(execFileSync('unzip',['-p',artifact,'extension/package.json'],{encoding:'utf8'}));
assert.equal(packageJson.version,version);
const evidence={passed:true,files,bundleBytes:Buffer.byteLength(source),artifactBytes:fs.statSync(artifact).size,runtimeLoadsWithoutNodeModules:true};
fs.writeFileSync('artifacts/package-validation.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
