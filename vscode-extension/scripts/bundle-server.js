const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const serverRoot = path.join(extensionRoot, "server");

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      fs.copyFileSync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

childProcess.execFileSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"], {
  cwd: repoRoot,
  stdio: "inherit"
});

remove(serverRoot);
fs.mkdirSync(serverRoot, { recursive: true });
copyDir(path.join(repoRoot, "dist", "src"), path.join(serverRoot, "dist", "src"));
copyDir(path.join(repoRoot, "node_modules"), path.join(serverRoot, "node_modules"));
copyFile(path.join(repoRoot, "package.json"), path.join(serverRoot, "package.json"));

const bundledPackage = JSON.parse(fs.readFileSync(path.join(serverRoot, "package.json"), "utf8"));
delete bundledPackage.scripts;
delete bundledPackage.devDependencies;
bundledPackage.private = true;
fs.writeFileSync(path.join(serverRoot, "package.json"), `${JSON.stringify(bundledPackage, null, 2)}\n`, "utf8");

console.log(`Bundled ConstantX MCP server into ${serverRoot}`);
