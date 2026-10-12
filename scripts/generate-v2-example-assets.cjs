// Reproducible small PNG fixtures, no image tooling or external dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const directory = path.resolve(__dirname, '../themes/examples/api-v2/assets');
fs.mkdirSync(directory, { recursive: true });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc]); }
function png(name, width, height, pixel) {
    const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
    const bytes=Buffer.alloc(height*(width*4+1));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=pixel(x,y);for(let c=0;c<4;c++)bytes[y*(width*4+1)+1+x*4+c]=color[c];}
    fs.writeFileSync(path.join(directory,name),Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))]));
}
const tower=(x,y)=>y>=242&&y<260 || x>85&&x<150&&y>150&&y<260 || x>475&&x<555&&y>115&&y<260 || x>220&&x<250&&y>205&&y<260;
png('towers.png',640,360,(x,y)=>tower(x,y)?[19,23,39,255]:[0,0,0,0]);
png('water.png',640,360,(_x,y)=>y>=260?[255,255,255,255]:[0,0,0,0]);
png('preview.png',320,180,(x,y)=>tower(x*2,y*2)?[19,23,39,255]:[16+Math.round(y*.12),20+Math.round(y*.09),37+Math.round(y*.18),255]);
