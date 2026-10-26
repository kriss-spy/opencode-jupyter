const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } = require('@vscode/test-electron');
async function main() {
  const root = path.resolve(__dirname,'..');
  const version = process.env.VSCODE_TEST_VERSION || 'installed';
  const executable = version === 'installed' ? '/usr/share/code/code' : await downloadAndUnzipVSCode(version);
  const isolated = path.join(root,'.vscode-test',`host-${version}`);
  await fs.mkdir(isolated,{recursive:true});
  const extensions = path.join(isolated,'extensions');
  const user = path.join(isolated,'user');
  const [cli,...args] = resolveCliArgsFromVSCodeExecutablePath(executable);
  execFileSync(cli,[...args,'--extensions-dir',extensions,'--user-data-dir',user,'--install-extension',process.env.JUPYTER_TEST_VERSION ? `ms-toolsai.jupyter@${process.env.JUPYTER_TEST_VERSION}` : 'ms-toolsai.jupyter','--force'],{stdio:'inherit',timeout:120000});
  await runTests({vscodeExecutablePath:executable,extensionDevelopmentPath:root,
    extensionTestsPath:path.join(__dirname,'host.cjs'),
    launchArgs:['--user-data-dir',user,'--extensions-dir',extensions,'--disable-workspace-trust','--no-sandbox','--disable-gpu','--disable-gpu-sandbox','--disable-dev-shm-usage','--disable-software-rasterizer','--skip-welcome','--skip-release-notes'],
    extensionTestsEnv:{...process.env,OPENCODE_JUPYTER_HOST_RESULTS:path.join(root,'artifacts',`host-${version}.json`)}});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
