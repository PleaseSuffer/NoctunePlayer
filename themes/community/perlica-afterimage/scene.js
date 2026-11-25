// Perlica / Afterimage. Local imagery only; compatible with the Worker scene runtime.
NoctuneScene.define({
    init(api) {
        this.clock = 0;
        this.cooldown = 0;
        this.floor = 0;
        this.envelope = 0;
        this.previous = 0;
        this.bassPeak=0;
        this.bassOpen=false;
        this.bassDb=-90;
        this.bassGateDb=-90;
        this.bassPower=Float32Array.from({length:256},(_,byte)=>byte===0?0:10**((-90+byte/255*80)/10));
        this.serial = 0;
        this.burst = null;
        this.alarmRemaining = 0;
        this.normalRemaining = 0;
        this.alarmCode = 0;
        this.pressure = 0;
        this.lastPacket = -10;
        this.strips = [];
        this.stripSerial = 0;
        this.nextMemory = 0;
        this.textWave=null;
        this.textReady=0;
        this.textWaveSerial=0;
        this.lights=[];
        this.frameLines=[];
        this.frameLineSerial=0;
        this.lineLimit=8;
        this.leftPanel=api.createSurface(900,1080);
        this.faults = [];
        this.faultReady = Array(9).fill(0);
        this.pointer = {x:0,y:0};
        // Normalize the one-pixel source height difference once, not during every slice.
        this.layers = {};
        for (const name of ['calm', 'grief']) {
            const surface = api.createSurface(1037, 1516);
            surface.getContext('2d').drawImage(api.images[name], 0, 0, 1037, 1516);
            this.layers[name] = surface;
        }
        this.cyan = api.createSurface(1037, 1516);
        const c = this.cyan.getContext('2d');
        c.drawImage(this.layers.grief, 0, 0);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = '#69d5ed'; c.fillRect(0, 0, 1037, 1516);
    },
    spawnFault(kind, life) {
        if (this.clock < this.faultReady[kind] || this.faults.some(f => f.kind === kind)) return;
        this.faults.push({kind, life, born:this.clock, seed:this.serial});
        // Expiry and rest are per subsystem. Other impacts cannot prolong this fault.
        this.faultReady[kind] = this.clock + life + .8 + kind * .13;
    },
    spawnStrip(random, strength, duration, memory = false) {
        if(this.strips.length >= 48) return;
        const id=++this.stripSerial;
        const eye=memory || id%4===0;
        const delay=memory?0:random()*.095;
        this.strips.push({
            id, born:this.clock+delay, life:duration*(memory?1.6+random():.6+random()*1.15),
            x:eye ? .14+random()*.13:.06+random()*.35,
            y:eye ? .335+random()*.115:.18+random()*.65,
            w:eye ? .48+random()*.24:.2+random()*.44,
            h:memory ? .025+random()*.055:.008+random()*.045,
            dx:(random()-.5)*(memory?10:42)*strength,
            velocity:(random()-.5)*(memory ? .016:.045),
            drift:(random()-.5)*.07,
            frequency:8+random()*8,
            memory, seed:random()
        });
    },
    trigger(strength, duration, strong = false) {
        // Geometry stays deterministic within a packet; temporal jumps use bounded phases.
        let seed = ++this.serial * 7919;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        for(let i=0;i<10;i++) this.spawnStrip(random,strength,duration);
        // New impacts add elements; they never reset an existing strip's age.
        this.burst = {born:this.clock,duration,strength};
        this.lastPacket = this.clock;
        if(strong && this.clock>=this.textReady) {
            this.textWave={born:this.clock,life:.42,seed:this.serial};
            this.textReady=this.clock+1.0;
            this.textWaveSerial++;
        }
        // Separate travelling light heads. Their position, length and halo radius evolve.
        for(let i=0;i<(strong?3:1) && this.lights.length<18;i++) this.lights.push({
            born:this.clock+i*.045,life:.55+random()*.4,
            path:(this.serial+i)%4,origin:.18+random()*.64,
            direction:random()>.5?1:-1,speed:320+random()*380,
            length:70+random()*100,width:24+random()*38,red:strong||this.faults.some(f=>f.kind===0),seed:random()
        });
        // Repeated beats add runners on the SAME closed frame, not alternating rails.
        // A full pool drops new arrivals and never restarts or removes surviving runners.
        for(let i=0;i<2 && this.frameLines.length<this.lineLimit;i++)this.frameLines.push({
            id:++this.frameLineSerial,born:this.clock+i*.035,life:1.6+random()*.9,
            origin:random(),direction:random()>.5?1:-1,speed:480+random()*350,
            length:100+random()*95,lane:(this.frameLineSerial%3-1)*3,red:strong
        });
        // Staggered independent decorations and long-lived readable message rows.
        this.spawnFault(this.serial%5, [.65,1.25,1.9,.95,3.6][this.serial%5]);
        this.spawnFault(5+this.serial%4, [3.1,4.2,3.6,5.0][this.serial%4]);
        // Text is a latched state, independent of the much faster image packet.
        // Freeze the archive code for the entire warning, including repeated hits.
        if (this.alarmRemaining > 0) this.alarmRemaining = Math.max(this.alarmRemaining, 2.8);
        else if (this.normalRemaining <= 0) {
            this.alarmRemaining = 2.8;
            this.alarmCode = this.serial;
        }
    },
    update(api, frame) {
        const dt = Math.min(.08, Math.max(0, frame.dt || 0));
        this.clock += dt;
        const limit=Math.round(Number(frame.parameters?.frameLineLimit ?? 8));
        this.lineLimit=Math.max(2,Math.min(16,limit));
        this.frameLines=this.frameLines.filter(r=>this.clock-r.born<r.life).slice(0,this.lineLimit);
        this.lights=this.lights.filter(p=>this.clock-p.born<p.life);
        if(this.textWave && this.clock-this.textWave.born>=this.textWave.life)this.textWave=null;
        this.strips=this.strips.filter(s=>this.clock-s.born<s.life);
        this.faults = this.faults.filter(f => this.clock-f.born < f.life);
        const wasAlarm = this.alarmRemaining > 0;
        this.alarmRemaining = Math.max(0, this.alarmRemaining - dt);
        this.normalRemaining = Math.max(0, this.normalRemaining - dt);
        if (wasAlarm && !this.alarmRemaining) this.normalRemaining = 1.2;
        this.cooldown = Math.max(0, this.cooldown - dt);
        const p = frame.parameters || {}, audio = frame.audio || {};
        const enabled = audio.playing && audio.enabled;
        const data = audio.spectrum || [], rate = audio.sampleRate || 48000;
        // RMS of 35–180 Hz only. Treble, SDK pulse and timer never generate an onset.
        const lo = Math.max(0, Math.floor(35 / (rate / 2) * data.length));
        const hi = Math.min(data.length, Math.max(lo + 1, Math.ceil(180 / (rate / 2) * data.length)));
        let sum = 0;
        // sceneAnalyzer maps FFT magnitudes to bytes between -90 and -10 dB.
        // Decode that logarithmic scale before RMS, rather than treating byte/255 as amplitude.
        if(enabled)for(let i=lo;i<hi;i++)sum+=this.bassPower[data[i]]||0;
        const amplitude=enabled&&hi>lo?Math.sqrt(sum/(hi-lo))*(audio.intensity??1):0;
        const sensitivity=Number(p.sensitivity ?? 1);
        this.bassDb=amplitude>0?20*Math.log10(amplitude):-90;
        this.bassPeak=Math.max(amplitude,this.bassPeak*Math.exp(-dt*.08));
        const absolute=10**(Number(p.bassFloor ?? -46)/20)/sensitivity;
        const relative=this.bassPeak*Number(p.bassSelectivity ?? .35)/Math.sqrt(sensitivity);
        const threshold=Math.max(absolute,relative);
        this.bassGateDb=20*Math.log10(Math.max(1e-9,threshold));
        // A 2 dB hysteresis window prevents repeated opening/closing near the floor.
        this.bassOpen=enabled&&amplitude>threshold*(this.bassOpen ? .89 : 1.12);
        const absoluteStrength=Math.max(0,(this.bassDb-20*Math.log10(absolute))/18);
        const bass=this.bassOpen?Math.min(1,amplitude/Math.max(this.bassPeak,absolute*8),absoluteStrength):0;
        const oldEnvelope = this.envelope;
        this.envelope += (bass - this.envelope) * (1 - Math.exp(-dt * (bass > this.envelope ? 45 : 14)));
        const onset = this.envelope - oldEnvelope;
        const rising = bass - this.previous;
        const moving = frame.motion !== false && !frame.reducedMotion;
        const strength = Number(p.glitch ?? .8);
        if (enabled && moving && strength > 0 && !this.cooldown && bass > .17 / sensitivity &&
            bass > this.floor * 1.07 + .022 / sensitivity && (onset > .026 / sensitivity || rising > .11 / sensitivity)) {
            this.trigger(Math.min(1, .45 + bass * .7), Number(p.recovery ?? .28),
                bass*sensitivity>.52 && (rising>.075/sensitivity || onset>.045/sensitivity));
            this.cooldown = .14;
        }
        // Dense low frequencies sustain a fragmented face even without a new onset.
        const target = enabled && moving && strength>0 ? Math.max(0,Math.min(1,(bass*sensitivity-.28)/.48))*Number(p.density ?? 1) : 0;
        this.pressure += (target-this.pressure)*(1-Math.exp(-dt*(target>this.pressure?1.8:4.5)));
        if (enabled && moving && strength>0 && bass*sensitivity>.4 && this.pressure>.3 &&
            this.clock-this.lastPacket > .46 + (this.serial%3)*.11 && !this.cooldown) {
            this.trigger(.4+this.pressure*.5, Number(p.recovery ?? .28));
            this.cooldown=.14;
        }
        if(enabled && moving && strength>0 && this.pressure>.3 && this.clock>=this.nextMemory) {
            let seed=(this.stripSerial+1)*3571;
            const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
            this.spawnStrip(random,Math.min(1,this.pressure)*strength,Number(p.recovery ?? .28),true);
            this.nextMemory=this.clock+.16+(1-Math.min(1,this.pressure))*.15;
        }
        this.floor += (bass - this.floor) * (1 - Math.exp(-dt * 3));
        this.previous = bass;
        // Pause, reduced motion and a disabled effect restore the clean image immediately.
        if (!enabled || !moving || strength <= 0) {
            this.burst = null;
            this.alarmRemaining = this.normalRemaining = 0;
            this.faults=[]; this.pressure=0; this.strips=[]; this.lights=[]; this.textWave=null; this.bassOpen=false; this.frameLines=[];
        }
        if (this.burst && this.clock - this.burst.born > this.burst.duration + .48) this.burst = null;
    },
    render(api, frame) {
        this.update(api, frame);
        let c=api.ctx;
        const p=frame.parameters || {}, t=api.time;
        const rect = api.visibleRect;
        c.fillStyle = '#eef3f4'; c.fillRect(0, 0, api.width, api.height);
        // Fit the entire composition, including the portrait, into cover-cropped windows.
        const scale = Math.min(rect.width / 1920, rect.height / 1080);
        c.save(); c.translate(rect.x + (rect.width - 1920 * scale) / 2, rect.y + (rect.height - 1080 * scale) / 2); c.scale(scale, scale);
        const ink = '#226f8c', blue = '#348da8', muted = '#7c9aa6';
        const line = (x,y,xx,yy,color='#c5d6dc') => { c.strokeStyle=color; c.lineWidth=1; c.beginPath(); c.moveTo(x,y); c.lineTo(xx,yy); c.stroke(); };
        const animate=frame.motion!==false && !frame.reducedMotion && p.animatedText!==false;
        const float=animate?Number(p.textFloat ?? 1):0;
        const moving=frame.motion!==false && !frame.reducedMotion;
        const depth=moving?Number(p.parallax ?? 1):0;
        const target=moving && frame.pointer?.active ? frame.pointer : {x:0,y:0};
        const damp=1-Math.exp(-Math.min(.08,frame.dt||0)*6);
        this.pointer.x+=(target.x-this.pointer.x)*damp;this.pointer.y+=(target.y-this.pointer.y)*damp;
        const px=this.pointer.x*depth,py=this.pointer.y*depth;
        // A shallow camera shear follows the frame; the portrait and type sit at
        // different depths. Every alternate-state slice uses the same portrait origin.
        this.parallaxPose={frameX:-px*3,frameY:-py*2,portraitX:px*11,portraitY:py*6};
        c.translate(960,540);
        c.transform(1,py*.002,px*.003,1,-px*3,-py*2);
        c.translate(-960,-540);
        const output=c, panel=this.leftPanel.getContext('2d');
        panel.setTransform(1,0,0,1,0,0);panel.clearRect(0,0,900,1080);
        this.parallaxPose.panelX=px*5+Math.sin(t*.48)*1.5*float;
        this.parallaxPose.panelY=py*4+Math.sin(t*.39)*float;
        const onPanel=draw=>{const previous=c;c=panel;c.save();draw();c.restore();c=previous;};
        const text = (s,x,y,size=12,color=blue,font=null) => {
            const wave=p.textGlitch!==false ? this.textWave : null;
            const lag=Math.max(0,1-Math.min(1,x/1920))*.045+(Math.floor(y/31)%3)*.006;
            const age=wave?this.clock-wave.born-lag:-1;
            const active=age>=0 && age<.28;
            let output=s;
            if(active) {
                const phase=age/.28,head=s.length+2-phase*(s.length+5);
                const tick=Math.floor(age*13),alphabet='01/<>?#_:+X';
                output=[...s].map((ch,i)=>{
                    if(ch===' '||Math.abs(i-head)>Math.max(2,s.length*.22))return ch;
                    return alphabet[(wave.seed+i*7+tick*3+Math.floor(y))%alphabet.length];
                }).join('');
            }
            const xx=x;
            const yy=y;
            c.save();c.font=font||`${size}px monospace`;c.fillStyle=color;
            c.fillText(output,xx,yy);
            if(active && age<.13) {
                // Small displaced scan fragment accompanies symbol substitution.
                const shift=(Math.floor(y)%2?1:-1)*Math.min(3,size*.035);
                c.beginPath();c.rect(xx-4,yy-size*.55,c.measureText(output).width+8,Math.max(1,size*.08));c.clip();
                c.fillStyle='#b34863';c.globalAlpha=.55;c.fillText(output,xx+shift,yy);
            }
            c.restore();
        };
        // Brief staggered decoding is confined to secondary labels; warnings stay intact.
        const decode=(s,seed=0)=>{
            if(!animate)return s;
            const phase=(t+seed*1.37)%9;
            if(phase>.42)return s;
            const settled=Math.floor(phase/.42*s.length),tick=Math.floor(t*14);
            return [...s].map((ch,i)=>i<settled||ch===' '?ch:'0123456789ABCDEF'[(tick+i*3+seed)%16]).join('');
        };
        const fault=kind=>this.faults.find(f=>f.kind===kind);
        const fade=f=>f ? Math.min(1,(f.life-(this.clock-f.born))/.3) : 0;
        const alarm = this.alarmRemaining > 0;
        const damageGain = Math.min(1.5, Number(p.corruption ?? 1));
        // White station bulkheads surrounding a dark observation recess, not a flat photo card.
        const bg = c.createLinearGradient(0,0,1920,1080);
        bg.addColorStop(0,'#fafcfc'); bg.addColorStop(1,'#dde8ec'); c.fillStyle=bg; c.fillRect(0,0,1920,1080);
        c.fillStyle='#d5e1e5'; c.fillRect(878,0,914,1080);
        c.fillStyle='#192d34'; c.fillRect(910,0,842,1080);
        // Cover the FIXED aperture, with overscan for maximum depth and slice offsets.
        // Top anchoring preserves the ears; only the lower body/table is cropped.
        const aperture={x:918,y:12,width:826,height:1026};
        const w=aperture.width+80,h=w*1516/1037;
        const x=aperture.x-(w-aperture.width)/2+this.parallaxPose.portraitX;
        const y=aperture.y-32+this.parallaxPose.portraitY;
        this.portraitLayout={x,y,width:w,height:h,aperture};
        c.save();c.beginPath();c.rect(aperture.x,aperture.y,aperture.width,aperture.height);c.clip();
        c.drawImage(this.layers.calm,x,y,w,h);
        if (p.stars !== false) for(let i=0;i<38;i++) {
            const sx=917+(i*97.37)%820, sy=30+(i*163.7)%920;
            if (sx>x+35 && sx<x+w-35) continue;
            c.globalAlpha=.18+.18*Math.sin(i+t*.13)**2; c.fillStyle='#cce9ef'; c.fillRect(sx,sy,1.5,1.5);
        }
        c.globalAlpha=1;
        // Each strip owns a delay, lifetime, travelling window and damped offset.
        // Geometry reveals/restores pixels at full opacity; there is no fading image overlay.
        c.save();c.beginPath();c.rect(x,y,w,h);c.clip();
        const gain=Number(p.glitch ?? .8);
        for(const strip of this.strips) {
            const age=this.clock-strip.born;
            if(age<0)continue;
            const phase=Math.min(1,age/strip.life);
            const opening=Math.min(1,phase/.14);
            const closing=Math.min(1,(1-phase)/.26);
            const span=strip.w*opening*closing;
            if(span<=0)continue;
            // Width contracts from a different end for each element. Source coordinates
            // travel with the window, so the sad face remains registered to the calm face.
            const left=strip.x+(strip.w-span)*(strip.seed>.5?1:0)+age*strip.drift;
            const top=strip.y+age*strip.velocity;
            const height=strip.h*(.85+.15*Math.sin(phase*Math.PI));
            const settle=Math.exp(-phase*4.5);
            const jitter=phase<.4?Math.sin(Math.floor(age*strip.frequency)*2.7+strip.seed*17)*1.5:0;
            const dx=(strip.dx*settle+jitter)*gain;
            const sx=left*1037, sy=top*1516, sw=span*1037, sh=height*1516;
            const tx=x+left*w, ty=y+top*h, tw=span*w, th=height*h;
            c.drawImage(this.layers.grief,sx,sy,sw,sh,tx+dx,ty,tw,th);
            if(Math.abs(dx)>.7) {
                c.globalAlpha=.32;
                c.drawImage(this.cyan,sx,sy,sw,Math.min(2,sh),tx-dx*.45,ty-1,tw,1);
                c.globalAlpha=1;
            }
        }
        c.restore();
        c.restore(); // Fixed portrait aperture.
        // Structural window rails and a quiet white foreground desk.
        for(const xx of [886,898,1760,1773]) line(xx,0,xx,1080,'#a9c0c9');
        c.fillStyle='#f3f7f8'; c.beginPath(); c.moveTo(0,963); c.lineTo(880,963); c.lineTo(948,1040); c.lineTo(1782,1040); c.lineTo(1846,963); c.lineTo(1920,963); c.lineTo(1920,1080); c.lineTo(0,1080); c.fill();
        line(0,963,880,963); line(880,963,948,1040); line(948,1040,1782,1040);
        for(let i=0;i<6;i++) { c.fillStyle=i===1?'#67c4de':'#ccdade'; c.fillRect(1810,430+i*30,42,3); }
        text('D I J I A N G',1808,210,10); text('DECK / 07',1808,232,10);
        // The complete left instrument is rendered into ONE transparent panel.
        c=panel;
        // Left editorial field: large identifier, sparse technical hierarchy.
        line(92,105,800,105); c.fillStyle=blue; c.fillRect(92,103,68,4);
        text('ENDFIELD INDUSTRIES',94,80,14,ink); text(decode('ORBITAL RELAY / 02',2),593,80,12);
        text(decode('PERSONNEL ARCHIVE',3),94,169,12);
        text('PERLICA',86,274,96,ink,'300 96px sans-serif');
        text('佩丽卡  /  SUPERVISOR',96,313,17);
        text(decode('P E R S I S T E N C E   O F   M E M O R Y',4),96,366,12,muted);
        line(94,405,800,405);
        if (p.telemetry !== false) {
            const corrupt=alarm;
            text(corrupt?'[ ! ]  MEMORY INTEGRITY LOST':'[ + ]  PERSONNEL SIGNAL VERIFIED',96,457,17,corrupt?'#a65a63':ink);
            const normal=[['UPLINK','DIJIANG / STABLE'],['ARCHIVE','P-001 / SYNCHRONIZED'],['LOCATION','TALOS-II / HIGH ORBIT'],['PROTOCOL','KEEP THE SIGNAL ALIVE']];
            const broken=['ERR / NO RESPONSE','FRAGMENT 0x','UNRECOVERABLE','DO NOT LOOK BACK'];
            normal.forEach(([label,value],i)=>{
                const f=fault(5+i), code=f?.seed.toString(16).toUpperCase().padStart(4,'0');
                text(label,96,511+i*36,11,muted);
                text(f?broken[i]+(i===1?code:''):value,284,511+i*36,13,f?'#a23d54':blue);
                if(f){c.save();c.globalAlpha=fade(f)*.6;c.fillStyle='#c34860';c.fillRect(268,502+i*36,2,10);c.restore();}
            });
            if(corrupt) {
                c.fillStyle='#d7eaf0'; c.fillRect(93,662,408,2); c.fillRect(109,666,168,2);
                text('RX / ARCHIVE LINK LOST',96,695,11,'#9a5864');
            } else text('RX / CHECKSUM VALID',96,695,11,muted);
        }
        if (p.spectrum !== false) {
            const bands=api.bandsSource({count:64,minHz:35,maxHz:12000,spacing:'log',attack:32,release:10,smoothing:.2});
            text('FREQUENCY RESPONSE',96,765,11,muted);
            text('LOW / MID / HIGH',630,765,11,muted);
            for(let i=0;i<64;i++){
                const amplitude=bands[i]*46;
                c.fillStyle=ink;c.fillRect(96+i*11,836-amplitude,2,2+amplitude);
            }
            line(94,843,800,843);
            for(let i=0;i<9;i++)line(96+i*87.5,843,96+i*87.5,848);
            text('35 Hz',96,865,10);text('1 kHz',418,865,10);text('12 kHz',758,865,10);
        }
        if (p.telemetry !== false) {
            const tick=animate?Math.floor(t*5):0;
            const hex=n=>Math.floor(n).toString(16).toUpperCase().padStart(4,'0');
            text('PKT '+hex(tick*37%65536)+'  /  RX '+hex(tick*13%65536),96,891,10,muted);
            if(animate){c.fillStyle=blue;c.globalAlpha=.3+.5*Math.sin(t*2)**2;c.fillRect(788,882,4,9);c.globalAlpha=1;}
            // Slowly scrolling packet log, inspired by the Endfield / Rhodes terminals.
            for(let i=0;i<3;i++){
                const row=(i+(animate?t*.35:0))%3;
                c.save();c.globalAlpha=Math.sin(row/3*Math.PI)*.45;
                text(hex((tick+i*379)%65536)+' / '+['RELAY','SYNC','ARCHIVE'][i],638,649+row*21,10,muted);c.restore();
            }
        }
        text('01 / AFTERIMAGE',96,923,12,ink); text('A RECORD OF WHAT REMAINS.',362,923,11,muted);
        c=output;
        // Damage occupies framing and empty space; readable telemetry is never sliced.
        if (damageGain > 0 && this.faults.some(f=>f.kind<5)) {
            const red='#b72f4b', hot='#ed5062';
            const rail=fault(0),blocks=fault(1),buffer=fault(2),streak=fault(3),badge=fault(4);
            c.save();
            // A thin warning frame stays structural; travelling light is drawn separately.
            if(rail){c.globalAlpha=.3;c.strokeStyle=red;c.lineWidth=1;c.strokeRect(918,12,826,1026);}
            // Stable packet of erased/offset interface blocks on each beat.
            if(blocks) for(let i=0;i<13;i++) {
                const born=blocks.born+(i%5)*.07;
                const life=.32+(i%4)*.19;
                const age=this.clock-born;
                if(age<0 || age>life)continue;
                const phase=age/life, envelope=Math.min(1,phase/.12,(1-phase)/.24);
                const side=i%2, bx=side?1784:718;
                const previous=c;if(!side)c=panel;c.save();
                const by=112+(i*137+blocks.seed*53)%748+age*(i%2?18:-13);
                const width=(12+(i*31)%94)*envelope;
                const shift=(i%2?1:-1)*9*Math.exp(-phase*4);
                c.globalAlpha=Math.min(.65,damageGain*.65);
                c.fillStyle=i%3?red:'#192d34';
                c.fillRect(bx+(i*17)%62+shift,by,width,2+(i%3)*2);
                c.fillStyle=hot;c.fillRect(bx-10+shift,by+12,3,1);
                c.restore();c=previous;
            }
            onPanel(()=>{
            // Torn registration lines and broken archive buffer, away from text rows.
            c.globalAlpha=fade(buffer)*Math.min(1,damageGain);
            c.strokeStyle=red;c.lineWidth=2;
            c.beginPath();c.moveTo(92,405);c.lineTo(630,405);c.lineTo(645,396);
            c.lineTo(704,396);c.lineTo(716,412);c.lineTo(800,412);c.stroke();
            for(let i=0;i<35;i++) {
                c.fillStyle=(i+(buffer?.seed||0))%7<3?red:'#aec7d1';
                c.fillRect(96+i*14,718,9,4+(i%4===0?4:0));
            }
            });
            // Red data-loss streaks interrupt a few image strips, leaving her eyes visible.
            if(streak) for(let i=0;i<5;i++) {
                const age=this.clock-streak.born-i*.06, life=.28+i*.09;
                if(age<0 || age>life)continue;
                const phase=age/life, width=(190+i*35)*Math.sin(phase*Math.PI);
                c.globalAlpha=Math.min(.17,damageGain*.15);c.fillStyle=red;
                c.fillRect(1010+(i*89)%220+age*24,585+i*73+age*(i%2?12:-9),width,1+i%2);
            }
            c.globalAlpha=1;
            if (badge) {
                c.globalAlpha=fade(badge);
                onPanel(()=>{c.globalAlpha=fade(badge);text('!  ARCHIVE QUARANTINE',96,391,11,red);});
                c.fillStyle='#f2e3e7';c.fillRect(1810,620,70,106);
                text('FAULT',1818,646,12,red);text('P-001',1818,670,10,red);
                text('LINK',1818,693,10,red);text('LOST',1818,709,10,red);
            }
            c.restore();
        }
        const lightGain=Math.max(0,Math.min(1.5,Number(p.lightMotion ?? 1)))*(frame.lighting?.intensity ?? 1);
        if(lightGain>0) {
            c.save();
            c.beginPath();c.rect(820,0,110,1080);c.rect(1748,0,172,1080);
            c.rect(92,95,708,19);c.rect(948,1037,834,43);c.clip();
            for(const pulse of this.lights) {
                const age=this.clock-pulse.born;
                if(age<0)continue;
                const previous=c;
                if(pulse.path===2)c=panel;
                c.save();
                if(pulse.path===2){c.beginPath();c.rect(92,95,708,19);c.clip();}
                const phase=Math.min(1,age/pulse.life);
                const body=Math.sin(phase*Math.PI);
                const vertical=pulse.path<2;
                const track=pulse.path<2?1080:pulse.path===2?708:834;
                const at=pulse.origin*track+age*pulse.speed*pulse.direction;
                const px=vertical?(pulse.path===0?901:1774):(pulse.path===2?92:948)+at;
                const py=vertical?at:(pulse.path===2?104:1052);
                const radius=(18+pulse.width*body)*Math.sqrt(lightGain);
                const length=pulse.length*body;
                if(radius<1||length<1){c.restore();c=previous;continue;}
                const rgb=pulse.red?'196,53,80':'55,179,215';
                // Constant peak radiance; the footprint moves, widens and separates into heads.
                const halo=c.createRadialGradient(px,py,0,px,py,radius);
                halo.addColorStop(0,`rgba(${rgb},.24)`);halo.addColorStop(.4,`rgba(${rgb},.11)`);halo.addColorStop(1,`rgba(${rgb},0)`);
                c.fillStyle=halo;c.fillRect(px-radius,py-radius,radius*2,radius*2);
                c.save();c.translate(px,py);if(vertical)c.rotate(Math.PI/2);
                const trail=c.createLinearGradient(-length*pulse.direction,0,0,0);
                trail.addColorStop(0,`rgba(${rgb},0)`);trail.addColorStop(.75,`rgba(${rgb},.28)`);trail.addColorStop(1,`rgba(${rgb},.8)`);
                c.fillStyle=trail;c.fillRect(Math.min(0,-length*pulse.direction),-1,length,2);
                // Moving reflection and a narrower secondary head have distinct speeds.
                c.fillStyle=pulse.red?'#d65570':'#70cce3';
                c.fillRect(-pulse.direction*length*.22,-3,3,6);
                c.fillStyle=`rgba(${rgb},.28)`;c.fillRect(-pulse.direction*length*.58,4,length*.23,1);
                c.restore();
                c.restore();c=previous;
            }
            c.restore();
        }
        // Closed-loop runners retain individual birth/expiry, can pass each other,
        // and continue around corners. They share the frame's parallax transform.
        if(lightGain>0)for(const runner of this.frameLines){
            const age=this.clock-runner.born;
            if(age<0)continue;
            const phase=Math.min(1,age/runner.life);
            const span=runner.length*Math.min(1,phase/.1,(1-phase)/.18);
            if(span<1)continue;
            const lane=runner.lane,left=918-lane,top=12-lane;
            const width=826+lane*2,height=1026+lane*2,perimeter=(width+height)*2;
            const head=((runner.origin*perimeter+age*runner.speed*runner.direction)%perimeter+perimeter)%perimeter;
            c.save();
            const color=runner.red?'#cc5270':'#55b6d1';
            c.strokeStyle=color;c.lineWidth=2;c.globalAlpha=Math.min(.85,.55+lightGain*.15);
            c.setLineDash([span,perimeter-span]);c.lineDashOffset=-head;
            c.strokeRect(left,top,width,height);
            // A longer, dimmer trace trails this runner, independently of other runners.
            const tail=Math.min(perimeter-1,span*1.65);
            c.globalAlpha=.16*Math.min(1,lightGain);c.lineWidth=4;
            c.setLineDash([tail,perimeter-tail]);
            c.lineDashOffset=-(head+(runner.direction<0?0:span-tail));
            c.strokeRect(left,top,width,height);c.restore();
        }
        onPanel(()=>{
            for(const yy of [136,890]){line(838,yy,858,yy,blue);line(848,yy-10,848,yy+10,blue);}
        });
        c.save();
        c.translate(this.parallaxPose.panelX,this.parallaxPose.panelY);
        c.drawImage(this.leftPanel,0,0);
        c.restore();
        c.restore();
    },
    dispose(api) {
        for(const surface of Object.values(this.layers || {})) api.releaseSurface(surface);
        if(this.cyan) api.releaseSurface(this.cyan);
        if(this.leftPanel)api.releaseSurface(this.leftPanel);
        this.leftPanel=null;
        this.layers=null; this.cyan=null; this.burst=null; this.faults=[]; this.strips=[]; this.lights=[]; this.textWave=null; this.frameLines=[];
    }
});
