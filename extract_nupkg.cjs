const fs = require('fs');
const zlib = require('zlib');

const buf = fs.readFileSync('.origin/extracted.nupkg');
let offset = 0;
const entries = [];

while (offset < buf.length - 30) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x04034b50) {
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const compSize = buf.readUInt32LE(offset + 18);
        const compMethod = buf.readUInt16LE(offset + 8);
        const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('ascii');
        entries.push({ offset, name, compSize, compMethod, nameLen, extraLen });
        offset = offset + 30 + nameLen + extraLen + compSize;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
        break;
    } else { offset++; }
}

let extracted = 0, skipped = 0, dirs = 0;

for (const e of entries) {
    if (e.name.endsWith('/') || e.name.endsWith('\\')) { dirs++; continue; }
    if (e.compSize === 0 && !e.name.includes('.')) { dirs++; continue; }

    const outPath = '.origin/extracted/' + e.name;
    const dir = outPath.substring(0, outPath.lastIndexOf('/'));
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { }

    const dataStart = e.offset + 30 + e.nameLen + e.extraLen;
    const data = buf.slice(dataStart, dataStart + e.compSize);

    try {
        if (e.compMethod === 0) {
            fs.writeFileSync(outPath, data);
            extracted++;
        } else if (e.compMethod === 8) {
            const uncompressed = zlib.inflateRawSync(data);
            fs.writeFileSync(outPath, uncompressed);
            extracted++;
        } else {
            fs.writeFileSync(outPath, data);
            console.log('  Unknown method', e.compMethod, 'for:', e.name);
            extracted++;
        }
    } catch (err) {
        if (err.code === 'EISDIR') { dirs++; continue; }
        console.log('  FAILED:', e.name, err.message);
        skipped++;
    }
}

console.log('Extracted:', extracted, 'Dirs:', dirs, 'Skipped:', skipped);
