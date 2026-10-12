// Versioned SDK. Runs only inside the scene's opaque-origin, script-only sandbox.
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
            const ratio = Math.min(frame.dpr || 1, this.quality?.dpr ?? 1.5), w = Math.round(frame.width * ratio), h = Math.round(frame.height * ratio);
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
            c.clip(); try { draw(); } finally { c.restore(); }
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
            const breath = this.motion ? Math.sin(this.time * 1.45) * (this.apiVersion === 2 ? options.breathAmplitude ?? .0035 : .0035) : 0;
            const anchor = options.anchor ?? H, hairY = options.hairY || [0, 380];
            let animated = this.characters.get(id);
            if (!animated) { animated = this.createSurface ? this.createSurface(W,H) : createCanvas(); animated.width = W; animated.height = H; this.characters.set(id, animated); }
            const texture = animated.getContext('2d');
            texture.clearRect(0, 0, W, H); texture.drawImage(image, 0, 0, W, H);
            // Deform in a 1:1 intermediate texture; scale the complete sprite once to avoid alpha seams.
            const hairTop=clamp(Math.round(hairY[0]),0,H),hairBottom=clamp(Math.round(hairY[1]),hairTop,H);
            // Clear and replace whole texture rows; fractional edges erase only part of a pixel's alpha.
            if (this.motion) for (let y = hairTop; y < hairBottom; y += 4) {
                const sh = Math.min(4, hairBottom - y), weight = Math.sin(Math.PI * (y - hairTop) / (hairBottom - hairTop));
                const dx = Math.sin(this.time * 1.1 + y * .011) * weight * (this.apiVersion === 2 ? options.hairStrength ?? 1.5 : 1.5);
                texture.clearRect(0, y, W, sh);
                texture.drawImage(image, 0, y / H * image.height, image.width, sh / H * image.height, dx, y, W, sh);
            }
            const paint = source => { c.save(); c.translate(0, -anchor * breath); c.scale(1, 1 + breath); c.drawImage(source, 0, 0, W, H); c.restore(); };
            if (options.contour) {
                let glow = this.glows.get(id);
                if (!glow) {
                    glow = this.createSurface ? this.createSurface(W,H) : createCanvas(); glow.width = W; glow.height = H;
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
            const blinkInterval = this.apiVersion === 2 ? Math.max(.2, options.blinkInterval ?? 5.9) : 5.9;
            if (options.blink && this.motion && this.time % blinkInterval > blinkInterval - .17) {
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
    const profiles = {
        low: { dpr: 1, particles: 40, surfaces: 8, pixels: 16 * 1024 * 1024, caches: 16 },
        balanced: { dpr: 1.5, particles: 80, surfaces: 12, pixels: 32 * 1024 * 1024, caches: 32 },
        high: { dpr: 2, particles: 120, surfaces: 16, pixels: 48 * 1024 * 1024, caches: 64 },
    };
    class SceneAPIv2 extends SceneAPI {
        constructor(canvas, manifest, images, runtime) {
            super(canvas, manifest, images);
            this.apiVersion = 2;
            this.runtime = runtime || (typeof document === 'undefined' ? 'worker' : 'iframe');
            this.quality = Object.freeze({ ...profiles[manifest.quality || 'balanced'] });
            this.parameters = Object.fromEntries(Object.entries(manifest.parameterSchema || {}).map(([key, p]) => [key, p.default]));
            this.surfaces = new Set(); this.sources = new Map(); this.geometry = new Map(); this.maskCache = new Map();
            this.events = new Map(); this.disposed = false; this.motionTime = 0; this.viewport = null;
            this.drops.length = this.quality.particles;
        }
        assertAlive() { if (this.disposed) throw new Error('Scene API disposed'); }
        boundedCache(map, key, value, release) {
            if (map.has(key)) { const old = map.get(key); map.delete(key); if (old !== value) release?.(old); }
            map.set(key, value);
            while (map.size > this.quality.caches) { const first = map.keys().next().value; release?.(map.get(first)); map.delete(first); }
            return value;
        }
        begin(frame) {
            this.assertAlive();
            const previous = this.viewport, oldParameters = JSON.stringify(this.parameters), oldAudio = this.audio;
            const audio = { spectrum: new Uint8Array(0), sampleRate: 44100, enabled: true, playing: false, intensity: 1, ...frame.audio };
            const dt = Number.isFinite(frame.dt) ? clamp(frame.dt, 0, .08) : 0;
            if (frame.motion) this.motionTime += dt;
            // v1 keeps its historic DPR cap and pulse range; v2 exposes a normalized pulse separately.
            super.begin({ ...frame, dt, time: this.motionTime, audio, dpr: Math.min(frame.dpr || 1, this.quality.dpr) });
            this.normalizedPulse = clamp(this.pulse);
            this.viewport = { width: frame.width, height: frame.height, dpr: frame.dpr || 1 };
            if(frame.safeArea){const start=this.screenToScene(frame.safeArea.x,frame.safeArea.y),end=this.screenToScene(frame.safeArea.x+frame.safeArea.width,frame.safeArea.y+frame.safeArea.height);this.safeArea={x:start.x,y:start.y,width:end.x-start.x,height:end.y-start.y};}else this.safeArea=null;
            this.parameters = { ...this.parameters, ...frame.parameters };
            for (const map of [this.bands, this.bandFrames, this.glows, this.characters]) {
                while (map.size > this.quality.caches) { const key = map.keys().next().value; const item = map.get(key); if (item?.getContext) this.releaseSurface(item); map.delete(key); }
            }
            if (!previous || previous.width !== frame.width || previous.height !== frame.height || previous.dpr !== this.viewport.dpr) this.emit('resize', this.viewport);
            if (oldParameters !== JSON.stringify(this.parameters)) this.emit('parameters', this.parameters);
            if (oldAudio.playing !== audio.playing || oldAudio.enabled !== audio.enabled || oldAudio.sampleRate !== audio.sampleRate || oldAudio.spectrum.length !== audio.spectrum.length) this.emit('audio', { playing: audio.playing, enabled: audio.enabled, sampleRate: audio.sampleRate, bins: audio.spectrum.length });
        }
        on(event, callback) {
            this.assertAlive();
            if (!['resize', 'parameters', 'audio', 'reset', 'dispose', 'resources'].includes(event) || typeof callback !== 'function') throw new Error('Unknown scene event');
            if (!this.events.has(event)) this.events.set(event, new Set());
            const handlers = this.events.get(event);
            if (handlers.size >= 32) throw new Error('Scene listener limit');
            handlers.add(callback); return () => handlers.delete(callback);
        }
        emit(event, value) { for (const callback of this.events.get(event) || []) callback(value); }
        createSurface(width = this.width, height = this.height) {
            this.assertAlive();
            if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 4096)) throw new Error('Surface dimensions must be integers in 1..4096');
            const pixels = [...this.surfaces].reduce((sum, s) => sum + s.width * s.height, 0);
            if (this.surfaces.size >= this.quality.surfaces || pixels + width * height > this.quality.pixels) throw new Error('Scene surface budget exceeded');
            const surface = createCanvas(); surface.width = width; surface.height = height;
            this.surfaces.add(surface); return surface;
        }
        releaseSurface(surface) { if (this.surfaces.delete(surface)) surface.width = surface.height = 1; }
        invalidate() {
            for (const map of [this.glows, this.characters]) { for (const surface of map.values()) this.releaseSurface(surface); map.clear(); }
            for (const mask of this.maskCache.values()) this.releaseSurface(mask);
            this.maskCache.clear();
        }
        replaceImage(id, image) {
            this.assertAlive(); if (!Object.hasOwn(this.images, id) || !image || ![image.width,image.height].every(v=>Number.isInteger(v)&&v>0&&v<=4096)) throw new Error('Invalid scene image');
            const pixels=Object.entries(this.images).reduce((sum,[key,value])=>sum+(key===id?0:value.width*value.height),image.width*image.height);
            if(pixels>48*1024*1024)throw new Error('Scene image budget exceeded');
            if (this.images[id] !== image) this.images[id]?.close?.();
            this.images[id] = image; this.invalidate(); this.emit('resources', { image: id });
        }
        setPalette(palette) {
            const color = c => /^#[\da-f]{6}$/i.test(c);
            if (!palette || !color(palette.accent) || !color(palette.background) || !Array.isArray(palette.gradient) || palette.gradient.length !== 3 || !palette.gradient.every(color)) throw new Error('Invalid palette');
            this.assertAlive(); this.palette = { ...palette, gradient: [...palette.gradient] }; this.invalidate(); this.emit('resources', { palette: this.palette });
        }
        reset() {
            this.assertAlive(); this.invalidate(); this.sources.clear(); this.geometry.clear(); this.bands.clear(); this.bandFrames.clear();
            this.energy = this.pulse = this.normalizedPulse = this.motionTime = this.time = 0; this.pulses = []; this.stars = []; this.nextStar = 3; this.pulseCooldown = 0;
            this.rainJunctions = []; this.rainScanIn = 0;
            this.drops.forEach(d => { d.y = -d.length; d.trail = []; d.age = 0; d.speed = 0; d.heading = d.angle = 0; d.seeded = false; });
            this.emit('reset');
        }
        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            try { this.emit('dispose'); } finally {
                this.invalidate(); for (const surface of [...this.surfaces]) this.releaseSurface(surface);
                for (const image of Object.values(this.images)) image.close?.();
                this.sources.clear(); this.geometry.clear(); this.bands.clear(); this.bandFrames.clear(); this.events.clear(); this.disposed = true;
                this.contourColors?.clear();
            }
        }
        sceneToScreen(x, y) {
            const v = this.viewport || { width: this.width, height: this.height }, scale = Math.max(v.width / this.width, v.height / this.height);
            return { x: x * scale + (v.width - this.width * scale) / 2, y: y * scale + (v.height - this.height * scale) / 2 };
        }
        screenToScene(x, y) {
            const zero = this.sceneToScreen(0, 0), v = this.viewport || { width: this.width, height: this.height }, scale = Math.max(v.width / this.width, v.height / this.height);
            return { x: (x - zero.x) / scale, y: (y - zero.y) / scale };
        }
        get visibleRect() {
            const start = this.screenToScene(0, 0), end = this.screenToScene(this.viewport?.width || this.width, this.viewport?.height || this.height);
            return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
        }
        anchor(horizontal = .5, vertical = .5, inset = 0) {
            const r = this.visibleRect; return { x: r.x + inset + (r.width - inset * 2) * horizontal, y: r.y + inset + (r.height - inset * 2) * vertical };
        }
        compose(groups) {
            for (const name of ['background', 'effects', 'foreground']) {
                if (!groups[name]) continue;
                this.ctx.save(); try { groups[name](this); } finally { this.ctx.restore(); }
            }
        }
        clipMask(asset, draw, { invert = false, feather = 0 } = {}) {
            this.assertAlive(); if (!Object.hasOwn(this.images, asset) || typeof draw !== 'function') throw new Error('Invalid mask');
            if(!Number.isFinite(feather))throw new Error('Invalid mask feather');
            feather = clamp(feather, 0, 32);
            const key = `${asset}:${feather}`;
            let mask = this.maskCache.get(key);
            if (!mask) {
                // Reserve room for the temporary draw surface, evicting old mask surfaces first.
                while (this.maskCache.size && (this.surfaces.size + 2 > this.quality.surfaces || [...this.surfaces].reduce((n,s)=>n+s.width*s.height,0)+2*this.width*this.height > this.quality.pixels)) {
                    const first = this.maskCache.keys().next().value; this.releaseSurface(this.maskCache.get(first)); this.maskCache.delete(first);
                }
                mask = this.createSurface(); const ctx = mask.getContext('2d'); ctx.filter = feather ? `blur(${feather}px)` : 'none'; ctx.drawImage(this.images[asset], 0, 0, this.width, this.height);
                this.boundedCache(this.maskCache, key, mask, s => this.releaseSurface(s));
            }
            const surface = this.createSurface(), original = this.ctx, ctx = surface.getContext('2d');
            this.ctx = ctx;
            try {
                ctx.save(); try { draw(this); } finally { ctx.restore(); }
                ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = invert ? 'destination-out' : 'destination-in'; ctx.drawImage(mask,0,0);
                original.drawImage(surface, 0, 0, this.width, this.height);
            } finally { this.ctx = original; this.releaseSurface(surface); }
        }
        bandsSource({ count = 96, minHz = 35, maxHz = 18000, spacing = 'hybrid', attack = 18, release = 7, smoothing = 0 } = {}) {
            if (!Number.isInteger(count) || count < 2 || count > 512 || ![minHz,maxHz,attack,release,smoothing].every(Number.isFinite) || minHz <= 0 || maxHz <= minHz || maxHz > 96000 || attack <= 0 || release <= 0 || smoothing < 0 || smoothing > 1 || !['linear','log','hybrid'].includes(spacing)) throw new Error('Invalid bands source');
            const key = [count,minHz,maxHz,spacing,attack,release,smoothing].join(':');
            let state = this.sources.get(key);
            if (!state) state = this.boundedCache(this.sources, key, { raw: new Float32Array(count), values: new Float32Array(count), frame: -1 });
            if (state.frame === this.frameId) return state.values;
            const data = this.audio.spectrum, nyquist = this.audio.sampleRate / 2;
            const geometryKey = [count,minHz,maxHz,spacing,nyquist,data.length].join(':');
            let ranges = this.geometry.get(geometryKey);
            if (!ranges) {
                const frequency = t => spacing === 'log' ? minHz * (maxHz/minHz)**t : minHz + (maxHz-minHz) * (spacing === 'linear' ? t : t**1.65);
                ranges = this.boundedCache(this.geometry, geometryKey, Array.from({length:count}, (_,i)=>[Math.min(data.length,frequency(i/count)/nyquist*data.length),Math.min(data.length,frequency((i+1)/count)/nyquist*data.length)]));
            }
            for (let i=0;i<count;i++) {
                const [lo,hi] = ranges[i]; let level=0, weight=0;
                if (this.audio.playing && this.audio.enabled && hi > lo) {
                    if (hi-lo<1) { const pos=(lo+hi)/2,b=Math.floor(pos),f=pos-b; level=(((data[b]||0)*(1-f)+(data[b+1]||0)*f)/255)**2; weight=1; }
                    else for (let b=Math.floor(lo);b<Math.ceil(hi);b++) { const w=Math.max(0,Math.min(hi,b+1)-Math.max(lo,b)); level+=((data[b]||0)/255)**2*w; weight+=w; }
                }
                const target=clamp(weight ? Math.sqrt(level/weight)*(this.audio.intensity??1) : 0);
                state.raw[i]=ease(state.raw[i],target,this.dt,target>state.raw[i]?attack:release);
            }
            const kernel=[1,4,6,4,1];
            for(let i=0;i<count;i++) { let sum=0; for(let j=-2;j<=2;j++)sum+=state.raw[clamp(i+j,0,count-1)]*kernel[j+2]; state.values[i]=state.raw[i]*(1-smoothing)+sum/16*smoothing; }
            state.frame=this.frameId; return state.values;
        }
        spectrum(count=96,minHz=35,maxHz=18000,key='main',spacing='hybrid') {
            // Legacy call shape remains available; v2 bounds untrusted dynamic keys.
            if (!Number.isInteger(count) || count<2 || count>512 || !Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz<=0 || maxHz<=minHz || !['linear','log','hybrid'].includes(spacing)) throw new Error('Invalid spectrum');
            const values=super.spectrum(count,minHz,maxHz,key,spacing),cacheKey=`${key}:${count}:${minHz}:${maxHz}:${spacing}`;
            this.boundedCache(this.bands,cacheKey,values);this.boundedCache(this.bandFrames,cacheKey,this.frameId);
            return values;
        }
        withSource(options, draw) {
            if (!options.source) return draw(options);
            const values = typeof options.source === 'function' ? options.source() : options.source;
            if (!values || values.length < 2 || values.length > 512 || !Array.from(values).every(Number.isFinite)) throw new Error('Invalid spectrum values');
            const spectrum = this.spectrum;
            this.spectrum = () => values;
            try { return draw({ ...options, count: values.length, smoothing: 0 }); } finally { this.spectrum = spectrum; }
        }
        bars(options) { return this.withSource(options, o => super.bars(o)); }
        line(options) { return this.withSource(options, o => super.line(o)); }
        radialSpectrum({ x=this.width/2, y=this.height/2, radius=100, height=80, source, opacity=.8, color=this.palette.accent, glow=8, startAngle=-Math.PI/2, endAngle=Math.PI*1.5 } = {}) {
            const bands = typeof source === 'function' ? source() : source || this.bandsSource();
            if(![x,y,radius,height,opacity,glow,startAngle,endAngle].every(Number.isFinite)||radius<0||height<0||!bands||bands.length<2||bands.length>512||!Array.from(bands).every(Number.isFinite))throw new Error('Invalid radial spectrum');
            const c=this.ctx; c.save();
            try { c.strokeStyle=color; c.lineWidth=2; c.shadowColor=color; c.shadowBlur=glow*this.glowIntensity; c.globalAlpha=clamp(opacity);
                bands.forEach((v,i)=>{ if(v<.003)return; const a=startAngle+(endAngle-startAngle)*i/bands.length; c.beginPath(); c.moveTo(x+Math.cos(a)*radius,y+Math.sin(a)*radius);c.lineTo(x+Math.cos(a)*(radius+v*height),y+Math.sin(a)*(radius+v*height));c.stroke(); });
            } finally { c.restore(); }
        }
        reflection({ baseline, height, opacity=.35, distortion=2, strips=48, mask, invert=false }, draw) {
            if (![baseline,height,opacity,distortion].every(Number.isFinite) || height<=0 || height>this.height || !Number.isInteger(strips) || strips<1 || strips>128 || typeof draw!=='function') throw new Error('Invalid reflection');
            const surface=this.createSurface(), original=this.ctx, ctx=surface.getContext('2d'); this.ctx=ctx;
            try {
                ctx.save();try{draw(this);}finally{ctx.restore();}
                this.ctx=original;
                const paint=()=>{const c=this.ctx;c.save();try{const step=height/strips;for(let i=0;i<strips;i++){const y=i*step;c.globalAlpha=clamp(opacity)*(1-y/height);const dx=Math.sin(this.motionTime*1.5+y*.08)*distortion;c.save();c.translate(dx,baseline*2);c.scale(1,-1);c.drawImage(surface,0,baseline-y-step,this.width,step,0,baseline-y-step,this.width,step+.5);c.restore();}}finally{c.restore();}};
                if(mask)this.clipMask(mask,paint,{invert});else paint();
            } finally { this.ctx=original;this.releaseSurface(surface); }
        }
        waterRipple({ x, y, radius=80, strength=1, opacity=.3, color=this.palette.accent, rings=3, speed=1 } = {}) {
            if(![x,y,radius,strength,opacity,speed].every(Number.isFinite)||radius<=0||!Number.isInteger(rings)||rings<1||rings>12)throw new Error('Invalid water ripple');
            const c=this.ctx;c.save();try{c.strokeStyle=color;c.shadowColor=color;c.shadowBlur=6*this.glowIntensity;
                for(let i=0;i<clamp(rings,1,12);i++){const p=(this.motionTime*speed*.2+i/rings)%1;c.globalAlpha=clamp(opacity*strength)*(1-p);c.beginPath();c.ellipse(x,y,Math.max(.01,radius*p),Math.max(.01,radius*p*.24),0,0,Math.PI*2);c.stroke();}
            }finally{c.restore();}
        }
        character(id, options={}) {
            if (!this.motion && options.stop === 'hide') return;
            if(!Object.hasOwn(this.images,id))throw new Error('Unknown character image');
            const palette=this.palette,color=options.contourColor || palette.accent;
            this.contourColors ||= new Map();
            if(this.contourColors.get(id)!==color){this.releaseSurface(this.glows.get(id));this.glows.delete(id);this.contourColors.set(id,color);}
            this.palette={...palette,accent:color};
            // Frozen local time preserves breath, hair and eyelids; audio lighting still decays.
            const motion=this.motion;this.motion=true;
            try { return super.character(id,options); } finally { this.motion=motion;this.palette=palette; }
        }
        shootingStars({ minInterval=6,maxInterval=14,color='#e5e0ff',opacity=.8,glow=8,stop='freeze' }={}) {
            if (!this.motion && stop==='hide') return;
            if(this.motion && this.time>=this.nextStar){this.stars.push({birth:this.time,x:80+Math.random()*this.width*.65,y:40+Math.random()*180});const min=clamp(minInterval,.5,120);this.nextStar=this.time+min+Math.random()*(clamp(maxInterval,min,120)-min);}
            this.stars=this.stars.filter(s=>this.time-s.birth<1.9).slice(-this.quality.particles);
            const c=this.ctx;for(const s of this.stars){const t=(this.time-s.birth)/1.9,point=p=>[s.x+330*p,s.y+55*p+90*p*p];c.save();try{c.shadowBlur=glow*this.glowIntensity;c.shadowColor=color;c.strokeStyle=color;c.lineWidth=1.6;
                for(let i=0;i<18;i++){const tail=Math.max(0,t-i*.008);c.globalAlpha=Math.sin(t*Math.PI)*(1-i/18)*clamp(opacity);c.beginPath();c.moveTo(...point(tail));c.lineTo(...point(Math.max(0,tail-.009)));c.stroke();}
            }finally{c.restore();}}
        }
    }
    window.NoctuneScene = {
        define(scene) { if (!scene || typeof scene.render !== 'function') throw new Error('Тема должна объявить render(api, frame)'); window.__noctuneScene = scene; },
        create(canvas, manifest, images, apiVersion = manifest.apiVersion || 1, runtime) {
            if (![1,2].includes(apiVersion)) throw new Error('Unsupported Scene API version: ' + apiVersion);
            return apiVersion === 2 ? new SceneAPIv2(canvas, manifest, images, runtime) : new SceneAPI(canvas, manifest, images);
        },
        clamp, ease,
    };
})();
