const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDirectories = ['src', 'public'].map((directory) => path.join(root, directory));
const extensions = new Set(['.css', '.scss', '.js', '.jsx', '.ts', '.tsx', '.svg', '.html']);
const tokenFiles = new Set([
  path.join(root, 'src', 'theme.css'),
  path.join(root, 'public', 'index.html'),
]);
const colorPattern = /(?<!&)#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\([^)]*\)|(?:(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*['"]?\s*(?:white|black)\b)|(?:fill|stroke|color|background|backgroundColor|borderColor)\s*=\s*['"](?:white|black)['"]|\b(?:bg-white|text-black|text-white|bg-black)\b/gi;
const findings = new Map();

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(filePath);
      continue;
    }

    if (!extensions.has(path.extname(entry.name).toLowerCase()) || tokenFiles.has(filePath)) continue;
    const source = fs.readFileSync(filePath, 'utf8');
    const matches = source.match(colorPattern);
    if (matches?.length) findings.set(path.relative(root, filePath), matches.length);
  }
}

sourceDirectories.forEach(scan);

if (findings.size) {
  const total = [...findings.values()].reduce((sum, count) => sum + count, 0);
  console.error(`Found ${total} hardcoded color literal(s) outside theme token files:`);
  for (const [file, count] of [...findings.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    console.error(`  ${file}: ${count}`);
  }
  process.exitCode = 1;
} else {
  console.log('No hardcoded color literals found outside theme token files.');
}
