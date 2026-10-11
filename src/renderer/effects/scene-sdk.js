// API v1. Runs only inside the scene's opaque-origin, script-only sandbox.
(() => {
    'use strict';
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const ease = (old, next, dt, speed) => old + (next - old) * (1 - Math.exp(-dt * speed));
    const rainTailLength = () => 24 + Math.random() ** 1.6 * 280;
    const createCanvas = () => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    class SceneAPI {
        constructor(canvas, manifest, images) {
            this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
            this.manifest = manifest; this.images = images; this.width = manifest.width; this.height = manifest.height;
            this.palette = manifest.palette; this.time = 0; this.dt = 0; this.motion = true;
            this.audio = { spectrum: new Uint8Array(0), sampleRate: 44100, playing: false, enabled: true, intensity: 1 };
            this.bands = new Map(); this.bandFrames = new Map(); this.frameId = 0;
            this.pulse = 0; this.energy = 0; this.glows = new Map(); this.characters = new Map(); this.pulses = []; this.pulseCooldown = 0;
            this.drops = Array.from({ length: 120 }, () => ({ x: Math.random() * this.width, y: Math.random() * this.height, speed: 15 + Math.random() * 65, radius: .8 + Math.random() ** 1.7 * 4.8, phase: Math.random()*20, pause: Math.random()*2, age: 0, heading: 0, headingTarget: (Math.random()-.5)*.4, nextTurn: .6+Math.random()*2, flow: .7+Math.random()*.6, length: 35 + Math.random() * 180, trail: [], seeded: false }));
            this.drops.forEach(d => { d.length = rainTailLength(); });
            this.rainJunctions = []; this.rainScanIn = 0;
            this.stars = []; this.nextStar = 3;
        }
        begin(frame) {
            this.frameId++;
            this.dt = clamp(frame.dt, 0, .08); this.time = frame.time; this.motion = frame.motion;
            this.audio = frame.audio;
            this.glowIntensity = clamp(frame.lighting?.intensity ?? 1, 0, 3);
            const ratio = Math.min(frame.dpr || 1, 1.5), w = Math.round(frame.width * ratio), h = Math.round(frame.height * ratio);
            if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
            const s = Math.max(w / this.width, h / this.height);
            this.ctx.setTransform(s, 0, 0, s, (w - this.width * s) / 2, (h - this.height * s) / 2);
            this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over'; this.ctx.shadowBlur = 0;
            this.ctx.fillStyle = this.palette.background; this.ctx.fillRect(0, 0, this.width, this.height);
            const response = bands => Math.sqrt(bands.reduce((a,b)=>a+b*b,0)/bands.length)*.7+Math.max(...bands)*.3;
            const mix = clamp(this.audio.frequencyMix ?? this.manifest.parameters?.frequencyMix ?? .6);
            const bass = response(this.spectrum(24, 35, 280, 'response-low', 'linear'))*(1-mix) + response(this.spectrum(48, 280, 14000, 'response-high', 'hybrid'))*mix;
            const attack = Math.max(0, bass - this.energy) * 2.6;
            this.energy = ease(this.energy, bass, this.dt, 5);
            this.pulse = Math.max(attack, ease(this.pulse, 0, this.dt, 4));
            this.pulseCooldown = Math.max(0, this.pulseCooldown - this.dt);
            this.pulses = this.pulses.filter(p => (p.age += this.dt) < 1.1);
            if (attack > .13 && this.pulseCooldown === 0 && this.audio.playing && this.audio.enabled) {
                if (this.pulses.length < 4) this.pulses.push({ age: 0, strength: clamp(attack) });
                this.pulseCooldown = .18;
            }
        }
        layer(id, opacity = 1) {
            const c = this.ctx; c.save(); c.globalAlpha = opacity;
            c.drawImage(this.images[id], 0, 0, this.width, this.height); c.restore();
        }
        clip(polygons, draw) {
            const c = this.ctx; c.save(); c.beginPath();
            for (const points of polygons) { c.moveTo(...points[0]); points.slice(1).forEach(p => c.lineTo(...p)); c.closePath(); }
            c.clip(); draw(); c.restore();
        }
        gradient(x0, y0, x1, y1) {
            const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
            this.palette.gradient.forEach((v, i) => g.addColorStop(i / 2, v)); return g;
        }
        // Two independent basis vectors allow rotation, shear and foreshortening.
        // Relative coordinates are fractions of the original art, not the viewport.
        plane({ origin=[0,0], xAxis=[1,0], yAxis=[0,1], relative=false, width=this.width, height=this.height }, draw) {
            const c=this.ctx, sx=relative?this.width:1, sy=relative?this.height:1;
            const bx=relative?width:1,by=relative?height:1;
            c.save();c.transform(xAxis[0]*sx/bx,xAxis[1]*sy/bx,yAxis[0]*sx/by,yAxis[1]*sy/by,origin[0]*sx,origin[1]*sy);
            try { draw(); } finally { c.restore(); }
        }
        spectrum(count = 96, minHz = 35, maxHz = 18000, key = 'main', spacing = 'hybrid') {
            key = `${key}:${count}:${minHz}:${maxHz}:${spacing}`;
            let values = this.bands.get(key);
            if (values && this.bandFrames.get(key) === this.frameId) return values;
            if (!values || values.length !== count) { values = new Float32Array(count); this.bands.set(key, values); }
            const data = this.audio.spectrum || [], nyquist = this.audio.sampleRate / 2;
            for (let i = 0; i < count; i++) {
                const frequency = t => spacing==='log' ? minHz*(maxHz/minHz)**t : minHz+(maxHz-minHz)*(spacing==='linear'?t:t**1.65);
                const lo = frequency(i/count)/nyquist*data.length;
                const hi = Math.min(data.length,frequency((i+1)/count)/nyquist*data.length);
                let level = 0, n = 0;
                if (this.audio.enabled && this.audio.playing) {
                    if(hi-lo<1 && hi>lo){const pos=(lo+hi)/2,b=Math.floor(pos),f=pos-b;level=((data[b]||0)*(1-f)+(data[b+1]||0)*f)/255;level*=level;n=1;}
                    else for(let b=Math.floor(lo);b<Math.ceil(hi);b++){const weight=Math.max(0,Math.min(hi,b+1)-Math.max(lo,b));level+=((data[b]||0)/255)**2*weight;n+=weight;}
                }
                const target = clamp(n ? Math.sqrt(level/n) * (this.audio.intensity ?? 1) : 0);
                values[i] = ease(values[i], target, this.dt, target > values[i] ? 18 : 7);
            }
            this.bandFrames.set(key, this.frameId); return values;
        }
        smoothSpectrum(values, amount=0) {
            const strength=clamp(amount);
            if(!strength)return values;
            // A small symmetric kernel rounds isolated spikes without grouping frequency bands.
            const weights=[1,4,6,4,1],last=values.length-1;
            return Float32Array.from(values,(value,i)=>{
                let neighborhood=0;
                for(let j=-2;j<=2;j++)neighborhood+=values[clamp(i+j,0,last)]*weights[j+2];
                return value*(1-strength)+neighborhood/16*strength;
            });
        }
        bars({ x, y, width, height, count = 96, opacity = .8, smoothing=0, minHz=35, maxHz=18000, spacing='hybrid' }) {
            const c = this.ctx, bands = this.smoothSpectrum(this.spectrum(count,minHz,maxHz,'bars',spacing),smoothing);
            c.save(); c.globalAlpha = opacity; c.fillStyle = this.gradient(x, y - height, x + width, y);
            c.shadowColor = this.palette.accent; c.shadowBlur = 8*this.glowIntensity;
            bands.forEach((v, i) => { if (v > .003) c.fillRect(x + i * width / count, y - v * height, width / count * .68, v * height); }); c.restore();
        }
        line({ x, y, width, height, opacity = .3, reflection = false, count=128, fill=.3, adaptiveFill=false, hideWhenSilent=false, smoothing=0, minHz=35, maxHz=18000, spacing='hybrid' }) {
            const c = this.ctx, bands = this.smoothSpectrum(this.spectrum(count,minHz,maxHz,'line',spacing),smoothing);
            const peak=Math.max(...bands);
            if(hideWhenSilent && peak<.003)return;
            c.save(); c.globalAlpha = opacity; c.lineWidth = reflection ? 3 : 2;
            c.strokeStyle = this.gradient(x, y, x + width, y); c.shadowColor = this.palette.accent; c.shadowBlur = (reflection ? 15 : 6)*this.glowIntensity;
            c.beginPath();
            bands.forEach((v, i) => {
                const px = x + i / (bands.length - 1) * width, py = y - v * height;
                if (!i) c.moveTo(px, py); else c.lineTo(px, py);
            }); c.stroke();
            if(fill>0){c.lineTo(x+width,y);c.lineTo(x,y);c.closePath();const gradient=c.createLinearGradient(x,y-height*(adaptiveFill?Math.max(.08,peak):1),x,y);gradient.addColorStop(0,this.palette.gradient[1]+'a0');gradient.addColorStop(.55,this.palette.gradient[0]+'50');gradient.addColorStop(1,this.palette.gradient[2]+'00');c.fillStyle=gradient;c.globalAlpha=opacity*clamp(fill);c.shadowBlur=0;c.fill();}
            c.restore();
        }
        character(id, options = {}) {
            const c = this.ctx, image = this.images[id], W = this.width, H = this.height;
            const breath = this.motion ? Math.sin(this.time * 1.45) * .0035 : 0;
            const anchor = options.anchor ?? H, hairY = options.hairY || [0, 380];
            let animated = this.characters.get(id);
            if (!animated) { animated = createCanvas(); animated.width = W; animated.height = H; this.characters.set(id, animated); }
            const texture = animated.getContext('2d');
            texture.clearRect(0, 0, W, H); texture.drawImage(image, 0, 0, W, H);
            // Deform in a 1:1 intermediate texture; scale the complete sprite once to avoid alpha seams.
            const hairTop=clamp(Math.round(hairY[0]),0,H),hairBottom=clamp(Math.round(hairY[1]),hairTop,H);
            // Clear and replace whole texture rows; fractional edges erase only part of a pixel's alpha.
            if (this.motion) for (let y = hairTop; y < hairBottom; y += 4) {
                const sh = Math.min(4, hairBottom - y), weight = Math.sin(Math.PI * (y - hairTop) / (hairBottom - hairTop));
                const dx = Math.sin(this.time * 1.1 + y * .011) * weight * 1.5;
                texture.clearRect(0, y, W, sh);
                texture.drawImage(image, 0, y / H * image.height, image.width, sh / H * image.height, dx, y, W, sh);
            }
            const paint = source => { c.save(); c.translate(0, -anchor * breath); c.scale(1, 1 + breath); c.drawImage(source, 0, 0, W, H); c.restore(); };
            if (options.contour) {
                let glow = this.glows.get(id);
                if (!glow) {
                    glow = createCanvas(); glow.width = W; glow.height = H;
                    const g = glow.getContext('2d');
                    g.shadowBlur = 28; g.shadowColor = this.palette.accent; g.drawImage(image, 0, 0, W, H);
                    g.shadowBlur = 0; g.globalCompositeOperation = 'destination-out'; g.drawImage(image, 0, 0, W, H);
                    this.glows.set(id, glow);
                }
                c.save(); c.globalAlpha = clamp((this.energy * .8 + this.pulse * 1.4)*this.glowIntensity); paint(glow); c.restore();
                if (this.motion) for (const p of this.pulses) {
                    const progress = p.age / 1.1, expansion = 1 + progress * .024;
                    c.save(); c.globalAlpha = clamp(Math.sin(progress * Math.PI) * p.strength * .75*this.glowIntensity);
                    c.translate(W * .62, H * .55); c.scale(expansion, expansion); c.translate(-W * .62, -H * .55);
                    paint(glow); c.restore();
                }
            }
            paint(animated);
            if (options.blink && this.motion && this.time % 5.9 > 5.73) {
                c.save(); c.translate(0, -anchor * breath); c.scale(1, 1 + breath);
                // Crop only the eyelids from the generated closed-eye plate, preserving the rest of the face.
                for (const [x, y, w, h] of options.eyes) {
                    c.save(); c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); c.clip();
                    c.drawImage(this.images[options.blink], 0, 0, W, H); c.restore();
                } c.restore();
            }
            if (options.eyeGlow) {
                c.save(); c.translate(0, -anchor * breath); c.scale(1, 1 + breath);
                options.eyeGlow.forEach(([x, y, r]) => this.light(x, y, r, clamp(this.energy * .65 + this.pulse * .9), this.palette.accent)); c.restore();
            }
        }
        light(x, y, radius, opacity, color = this.palette.accent) {
            const c = this.ctx; c.save(); c.globalAlpha = clamp(opacity*(this.glowIntensity ?? 1)); c.globalCompositeOperation = 'screen';
            const g = c.createRadialGradient(x, y, 0, x, y, radius); g.addColorStop(0, color); g.addColorStop(1, color + '00');
            c.fillStyle = g; c.fillRect(x - radius, y - radius, radius * 2, radius * 2); c.restore();
        }
        flicker(points) {
            points.forEach(([x, y, r, color, strength=.14], i) => this.light(x, y, r,
                strength*(.4+.6*(this.motion ? (.5 + .5 * Math.sin(this.time * (1.1 + i * .19) + i * 9)) ** 7 : .3)), color || (i % 2 ? '#86d8ec' : '#edbba9')));
        }
        rainDropShape(radius,speed,phase,age=0) {
            const r=Math.max(.45,radius),kind=Math.floor(phase)%4;
            const profiles=[[1.12,.82,.92],[.86,1.9,1.35],[.58,2.7,1.6],[1.1,1.15,1.55]];
            const [width,upper,lower]=profiles[kind],stretch=clamp(speed/110,0,1.8);
            const wobble=Math.sin(age*2.1+phase)*.045;
            const halfWidth=r*width/Math.sqrt(1+stretch*.3);
            return {left:halfWidth*(.85+wobble),right:halfWidth*(1.1-wobble),
                top:r*(upper+stretch*.85),bottom:r*(lower+stretch*.3),
                lean:r*(Math.sin(phase)*(1-clamp(speed/60)*.85)+Math.sin(age*2+phase)*clamp(speed/60)*.12)*(.12+(kind===3?.3:0)),bulge:kind===3?1.45:1.05};
        }
        paintRainDrop(x,y,radius,speed,phase,age=0,angle=0) {
            const c=this.ctx,outside=this.images.outside,s=this.rainDropShape(radius,speed,phase,age);
            const cosine=Math.cos(angle),sine=Math.sin(angle);
            const turn=(px,py)=>[x+(px-x)*cosine-(py-y)*sine,y+(px-x)*sine+(py-y)*cosine];
            const curve=(ax,ay,bx,by,px,py)=>c.bezierCurveTo(...turn(ax,ay),...turn(bx,by),...turn(px,py));
            const corners=[[x-s.left*1.25,y-s.top],[x+s.right*s.bulge*1.15,y-s.top],[x-s.left*1.25,y+s.bottom],[x+s.right*s.bulge*1.15,y+s.bottom]].map(p=>turn(...p));
            const left=Math.min(...corners.map(p=>p[0])),right=Math.max(...corners.map(p=>p[0])),top=Math.min(...corners.map(p=>p[1])),bottom=Math.max(...corners.map(p=>p[1]));
            const width=right-left,height=bottom-top;
            // Rotate the water outline, keeping the refracted city aligned with the glass.
            const tip=y-s.top,base=y+s.bottom;
            c.save();c.beginPath();c.moveTo(...turn(x+s.lean,tip));
            curve(x+s.lean+s.right*.4,tip,x+s.right*s.bulge,y-s.top*.25,x+s.right,y+s.bottom*.12);
            curve(x+s.right*1.1,y+s.bottom*.75,x+s.lean+s.right*.5,base,x+s.lean*.4,base);
            curve(x-s.left*.65,base,x-s.left*1.2,y+s.bottom*.65,x-s.left,y-s.top*.08);
            curve(x-s.left,y-s.top*.6,x+s.lean-s.left*.4,tip,x+s.lean,tip);c.closePath();c.clip();
            if(outside){
                const sx=outside.width/this.width,sy=outside.height/this.height,sw=width*.65,sh=height*.72;
                c.globalAlpha=.7;c.drawImage(outside,clamp(x-sw*.5+s.lean,0,this.width-sw)*sx,clamp(y-sh*.6,0,this.height-sh)*sy,sw*sx,sh*sy,left,top,width,height);
            }
            // Broad transparent faces and a narrow uneven rim, rather than a spherical specular spot.
            const shade=c.createLinearGradient(left,top,right,bottom);
            shade.addColorStop(0,'#e6f1ff48');shade.addColorStop(.22,'#dceaff08');shade.addColorStop(.65,'#02091908');shade.addColorStop(1,'#01061745');
            c.globalAlpha=1;c.fillStyle=shade;c.fillRect(left,top,width,height);
            const rim=c.createLinearGradient(0,top,0,bottom);
            rim.addColorStop(0,'#eff7ff00');rim.addColorStop(.2,'#e5f2ff80');rim.addColorStop(.55,'#d6e7ff28');rim.addColorStop(1,'#eff7ff00');
            c.strokeStyle=rim;c.lineWidth=Math.max(.35,radius*.13);c.globalAlpha=.55;
            const localHeight=s.top+s.bottom;
            c.beginPath();c.moveTo(...turn(x+s.lean-s.left*.2,tip+localHeight*.1));
            curve(x-s.left*.78,tip+localHeight*.18,x-s.left*.88,y-s.top*.05,x-s.left*.7,y+s.bottom*.4);c.stroke();c.restore();
        }
        rainBead(x,y,radius) {
            this.paintRainDrop(x,y,radius,0,(Math.abs(x*.37+y*.13)%20));
        }
        rainTrail(d) {
            const c=this.ctx,outside=this.images.outside;
            const point=(y,x=d.x)=>({x,y,born:d.age,width:d.radius*(.26+.12*Math.sin(y*.067+d.phase))});
            if(!d.seeded){
                // Seed wet tracks on the first frame, including when motion is disabled.
                for(let y=d.y-d.length;y<d.y;y+=6){const distance=d.y-y;const p=point(y,d.x-distance*d.headingTarget+Math.sin(distance*.025+d.phase)*Math.min(3,distance*.03));p.born=-distance/Math.max(25,d.speed);d.trail.push(p);}
                d.seeded=true;
            }
            const lifetime=9+d.radius*2;
            d.trail=d.trail.filter(p=>d.age-p.born<lifetime);
            const previous=d.trail.at(-1);
            if(this.motion&&d.speed>1&&(!previous||Math.hypot(d.x-previous.x,d.y-previous.y)>=4))d.trail.push(point(d.y));
            // Limit physical length, not just point count: slow drops also keep short tails.
            let distance=0,first=d.trail.length-1;
            for(let i=d.trail.length-2;i>=0;i--){
                distance+=Math.hypot(d.trail[i+1].x-d.trail[i].x,d.trail[i+1].y-d.trail[i].y);
                if(distance>d.length)break;
                first=i;
            }
            if(first>0)d.trail.splice(0,first);
            if(d.trail.length>64)d.trail.splice(0,d.trail.length-64);
            if(d.trail.length<2)return;
            const points=d.trail,top=points[0].y,bottom=points.at(-1).y;
            const left=Math.min(...points.map(p=>p.x-p.width))-1,right=Math.max(...points.map(p=>p.x+p.width))+1;
            const width=right-left,height=bottom-top;
            if(height<1||bottom<0||top>this.height)return;
            const edge=(p,side)=>p.x+side*p.width*clamp((lifetime-d.age+p.born)/3)*clamp((p.y-top)/12);
            // Tracks stay anchored to the glass after the head pauses; old water slowly evaporates.
            c.save();c.beginPath();points.forEach((p,i)=>i?c.lineTo(edge(p,-1),p.y):c.moveTo(edge(p,-1),p.y));
            for(let i=points.length-1;i>=0;i--)c.lineTo(edge(points[i],1),points[i].y);c.closePath();c.clip();
            if(outside){
                const sx=outside.width/this.width,sy=outside.height/this.height;
                const sourceHeight=Math.min(height*.98,this.height),sourceWidth=Math.min(width*.7,this.width);
                c.globalAlpha=.55;c.drawImage(outside,clamp(left+width*.2,0,this.width-sourceWidth)*sx,clamp(top+1,0,this.height-sourceHeight)*sy,sourceWidth*sx,sourceHeight*sy,left,top,width,height);
            }
            const rim=c.createLinearGradient(left,top,right,top);
            rim.addColorStop(0,'#02071950');rim.addColorStop(.25,'#07122618');rim.addColorStop(.6,'#d8e8ff06');rim.addColorStop(1,'#ecf5ff48');
            c.globalAlpha=.75;c.fillStyle=rim;c.fillRect(left,top,width,height);
            const fade=c.createLinearGradient(0,top,0,bottom);
            fade.addColorStop(0,'#cfe3ff00');fade.addColorStop(.2,'#d8e8ff0b');fade.addColorStop(.75,'#e8f2ff18');fade.addColorStop(1,'#e8f2ff00');
            c.fillStyle=fade;c.fillRect(left,top,width,height);c.restore();
            for(const side of [-1,1]){
                c.save();c.lineWidth=.4;c.globalAlpha=.16;
                const edgeLight=c.createLinearGradient(0,top,0,bottom);edgeLight.addColorStop(0,'#dbeaff00');edgeLight.addColorStop(.25,side<0?'#070d2680':'#dbeaff80');edgeLight.addColorStop(1,'#dbeaff00');c.strokeStyle=edgeLight;
                c.beginPath();points.forEach((p,i)=>i?c.lineTo(edge(p,side),p.y):c.moveTo(edge(p,side),p.y));c.stroke();c.restore();
            }
            // Small pinned beads and occasional side runnels break the uniform vertical shape.
            for(let i=9;i<points.length-3;i+=24){const p=points[i];this.rainBead(p.x+.4,p.y,p.width*.85);}
            if(d.phase%4<1&&points.length>12){
                const p=points[Math.floor(points.length*.45)],side=Math.sin(d.phase)>0?1:-1;
                const bx=p.x+side*(3+d.radius),by=p.y-12-d.radius*2;
                c.save();c.strokeStyle='#bbd2ee';c.globalAlpha=.10;c.lineWidth=.45;c.beginPath();c.moveTo(bx,by);c.bezierCurveTo(bx,by+7,p.x+side*2,p.y-7,p.x,p.y);c.stroke();c.restore();
                this.rainBead(bx,by,d.radius*.3);
            }
        }
        scanRainJunctions() {
            // Nearby segments only; avoid comparing every point against every other trail.
            const grid=new Map(),hits=[],cell=24;
            for(let drop=0;drop<this.drops.length;drop++){
                const d=this.drops[drop];
                for(let i=1;i<d.trail.length;i++){
                    const a=d.trail[i-1],b=d.trail[i];
                    if(Math.max(a.y,b.y)<0||Math.min(a.y,b.y)>this.height)continue;
                    const segment={a,b,drop},seen=new Set();
                    for(let gx=Math.floor(Math.min(a.x,b.x)/cell);gx<=Math.floor(Math.max(a.x,b.x)/cell);gx++){
                        for(let gy=Math.floor(Math.min(a.y,b.y)/cell);gy<=Math.floor(Math.max(a.y,b.y)/cell);gy++){
                            const key=`${gx}:${gy}`,bucket=grid.get(key)||[];
                            for(const other of bucket){
                                if(other.drop===drop||seen.has(other))continue;
                                seen.add(other);
                                const dx=b.x-a.x,dy=b.y-a.y,ex=other.b.x-other.a.x,ey=other.b.y-other.a.y;
                                const cross=dx*ey-dy*ex;if(Math.abs(cross)<1e-6)continue;
                                const ox=other.a.x-a.x,oy=other.a.y-a.y;
                                const t=(ox*ey-oy*ex)/cross,u=(ox*dy-oy*dx)/cross;
                                if(t<0||t>1||u<0||u>1)continue;
                                const x=a.x+t*dx,y=a.y+t*dy;
                                if(x<0||x>this.width||hits.some(h=>Math.hypot(h.x-x,h.y-y)<8))continue;
                                const w=a.width+(b.width-a.width)*t,v=other.a.width+(other.b.width-other.a.width)*u;
                                hits.push({x,y,radius:clamp(Math.sqrt(w*w+v*v)*1.65,1,6)});
                                if(hits.length>=96)return hits;
                            }
                            bucket.push(segment);grid.set(key,bucket);
                        }
                    }
                }
            }
            return hits;
        }
        rainJunctionsFrame() {
            if(this.rainScanIn<=0){
                for(const node of this.rainJunctions)node.target=0;
                for(const hit of this.scanRainJunctions()){
                    const node=this.rainJunctions.find(n=>Math.hypot(n.x-hit.x,n.y-hit.y)<8);
                    if(node)node.target=hit.radius;
                    else if(this.rainJunctions.length<96)this.rainJunctions.push({...hit,target:hit.radius,radius:hit.radius*.65});
                }
                this.rainScanIn=.16;
            }
            if(this.motion){
                this.rainScanIn-=this.dt;
                for(const node of this.rainJunctions)node.radius=ease(node.radius,node.target,this.dt,node.target?4:.7);
                this.rainJunctions=this.rainJunctions.filter(n=>n.radius>.2);
            }
            for(const node of this.rainJunctions)this.rainBead(node.x,node.y,node.radius);
        }
        advanceRainDrop(d,dt) {
            d.age+=dt;d.pause-=dt;
            if(d.age>=d.nextTurn&&d.pause<=0){
                d.headingTarget=(Math.random()-.5)*.9;
                d.pause=.12+Math.random()*.32;
                if(Math.random()<.12)d.pause+=.25+Math.random()*.4;
                d.nextTurn=d.age+d.pause+.7+Math.random()*2.5;
                d.flow=.65+Math.random()*.7;
            }
            // Surface tension briefly holds a drop at a bend; it then eases into its new course.
            d.heading=ease(d.heading,d.headingTarget,dt,5);
            const target=d.pause>0?0:(18+d.radius*25)*d.flow;
            d.speed=ease(d.speed,target,dt,target>d.speed?2.2:12);
            // heading is vx/vy; a downward silhouette rotates clockwise for a leftward course.
            const angle=-Math.atan(d.heading)*clamp(d.speed/25);
            d.angle=ease(d.angle??0,angle,dt,7);
            d.x+=d.heading*d.speed*dt;d.y+=d.speed*dt;
            if(d.y>this.height+d.length){
                d.length=rainTailLength();d.y=-d.length;d.x=Math.random()*this.width;d.speed=0;d.pause=Math.random()*2;d.age=0;
                d.heading=0;d.angle=0;d.headingTarget=(Math.random()-.5)*.4;d.nextTurn=.6+Math.random()*2;
                d.trail=[];d.seeded=true;
            }
        }
        rain() {
            const c = this.ctx; c.save();
            for (const d of this.drops) {
                if (this.motion) this.advanceRainDrop(d,this.dt);
                this.rainTrail(d);
            }
            this.rainJunctionsFrame();
            for(const d of this.drops)this.paintRainDrop(d.x,d.y,d.radius,d.speed,d.phase,d.age,d.angle??0);
            c.restore();
        }
        shootingStars({ minInterval=6, maxInterval=14 } = {}) {
            if (!this.motion) return;
            if (this.time >= this.nextStar) {
                this.stars.push({ birth: this.time, x: 80 + Math.random() * this.width * .65, y: 40 + Math.random() * 180 });
                const minimum=clamp(minInterval,.5,120),maximum=clamp(maxInterval,minimum,120);
                this.nextStar = this.time + minimum + Math.random() * (maximum-minimum);
            }
            const c = this.ctx;
            this.stars = this.stars.filter(s => this.time - s.birth < 1.9);
            for (const s of this.stars) {
                const t = (this.time - s.birth) / 1.9, point = p => [s.x + 330 * p, s.y + 55 * p + 90 * p * p];
                c.save(); c.shadowBlur = 8; c.shadowColor = '#e5e0ff'; c.lineWidth = 1.6;
                for (let i = 0; i < 18; i++) {
                    const tail = Math.max(0, t - i * .008); c.globalAlpha = Math.sin(t * Math.PI) * (1 - i / 18) * .8;
                    c.strokeStyle = '#e5e0ff'; c.beginPath(); c.moveTo(...point(tail)); c.lineTo(...point(Math.max(0, tail - .009))); c.stroke();
                } c.restore();
            }
        }
    }
    window.NoctuneScene = {
        define(scene) { if (!scene || typeof scene.render !== 'function') throw new Error('Тема должна объявить render(api, frame)'); window.__noctuneScene = scene; },
        create: (canvas, manifest, images) => new SceneAPI(canvas, manifest, images),
        clamp, ease,
    };
})();
