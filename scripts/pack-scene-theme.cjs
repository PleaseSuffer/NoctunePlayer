const fs = require('node:fs/promises');
const path = require('node:path');
const { packDirectory } = require('../src/main/scene-themes');
(async () => {
    const [directory, output] = process.argv.slice(2);
    if (!directory || !output) throw new Error('Usage: node scripts/pack-scene-theme.cjs <directory> <output.noctheme>');
    const value = await packDirectory(path.resolve(directory));
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, JSON.stringify(value));
    console.log(`${value.manifest.name} → ${output}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
