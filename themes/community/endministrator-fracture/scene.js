// Endministrator / Fracture. Local Canvas assets; Worker-compatible SDK 2.
NoctuneScene.define({
    init(api) {
        this.clock=0; this.level=0; this.peak=0; this.open=false;
        this.cooldown=0; this.reveal=0; this.hits=0; this.runners=[];this.faults=[];
        this.pointer={x:0,y:0}; this.db=-90;
        this.silentBands=new Float32Array(48);
        this.fragments=[];this.fragmentSerial=0;this.nextMemory=0;
        this.textWave=null;this.textReady=0;
        this.borderBursts=[];
        this.power=Float32Array.from({length:256},(_,b)=>b?10**((-90+b/255*80)/10):0);
        this.layers={};
        for(const name of ['calm','fracture']) {
            const surface=api.createSurface(1672,941);
            surface.getContext('2d').drawImage(api.images[name],0,0,1672,941);
            this.layers[name]=surface;
        }
        this.violet=api.createSurface(1672,941);
        const tint=this.violet.getContext('2d');tint.drawImage(this.layers.fracture,0,0);
        tint.globalCompositeOperation='source-in';tint.fillStyle='#b677ef';tint.fillRect(0,0,1672,941);
        this.backdrop=api.createSurface(96,96);
        const grid=this.backdrop.getContext('2d');
        grid.strokeStyle='rgba(167,151,194,.065)';grid.lineWidth=1;
        grid.beginPath();grid.moveTo(0,.5);grid.lineTo(96,.5);grid.moveTo(.5,0);grid.lineTo(.5,96);grid.stroke();
        grid.fillStyle='rgba(190,171,217,.12)';grid.fillRect(47,47,2,2);
        grid.strokeStyle='rgba(167,151,194,.04)';grid.beginPath();
        grid.moveTo(0,86);grid.lineTo(10,96);grid.moveTo(0,78);grid.lineTo(18,96);grid.moveTo(0,70);grid.lineTo(26,96);grid.stroke();
    },
    spawnFractures(strength,p,memory=false) {
        let seed=(this.hits+this.fragmentSerial+1)*7919;
        const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        for(let i=0;i<(memory?4:11)&&this.fragments.length<40;i++) {
            const vertical=i%4===0;
            this.fragments.push({id:this.fragmentSerial=(this.fragmentSerial+1)%65536,
                born:this.clock+(memory?0:random()*.075),life:Number(p.recovery??.45)*(.7+random()*1.7)*(memory?1.5:1),
                x:.36+random()*.23,y:.41+random()*.23,
                w:vertical?.022+random()*.035:.08+random()*.13,
                h:vertical?.09+random()*.13:.016+random()*.05,
                dx:(random()-.5)*28*strength,dy:(random()-.5)*9*strength,
                drift:(random()-.5)*.025,reverse:random()>.5,seed:random(),memory});
        }
    },
    spawnBorder(p) {
        const limits={echo:4,shard:14,arc:8,scan:4};
        let seed=(this.hits+1)*3571;
        const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        for(const kind of ['echo','shard','shard','shard','arc','scan']){
            if(p['border'+kind[0].toUpperCase()+kind.slice(1)]===false||Number(p.borderIntensity??1)<=0)continue;
            if(this.borderBursts.filter(f=>f.kind===kind).length>=limits[kind])continue;
            this.borderBursts.push({kind,born:this.clock,life:kind==='echo'?.75:kind==='shard'?1.1+random()*.5:kind==='arc'?.3+random()*.25:.85,
                side:Math.floor(random()*4),anchor:.08+random()*.84,seed:random(),direction:random()>.5?1:-1});
        }
    },
    update(api,frame) {
        const dt=Math.min(.08,Math.max(0,frame.dt||0)),p=frame.parameters||{},a=frame.audio||{};
        const moving=frame.motion!==false&&!frame.reducedMotion;
        const enabled=moving&&a.enabled&&a.playing;
        if(moving)this.clock+=dt;
        this.cooldown=Math.max(0,this.cooldown-dt);
        const data=a.spectrum||[],rate=a.sampleRate||48000;
        const lo=Math.max(0,Math.floor(35/(rate/2)*data.length));
        const hi=Math.min(data.length,Math.max(lo+1,Math.ceil(180/(rate/2)*data.length)));
        let sum=0;if(enabled)for(let i=lo;i<hi;i++)sum+=this.power[data[i]]||0;
        const amp=enabled&&hi>lo?Math.sqrt(sum/(hi-lo))*(a.intensity??1):0;
        this.db=amp>0?20*Math.log10(amp):-90;
        this.peak=Math.max(amp,this.peak*Math.exp(-dt*.1));
        const sensitivity=Number(p.sensitivity??1);
        const absolute=10**(Number(p.bassFloor??-46)/20)/sensitivity;
        const threshold=Math.max(absolute,this.peak*.35/Math.sqrt(sensitivity));
        this.open=!!enabled&&amp>threshold*(this.open?.89:1.12);
        const bass=this.open?Math.min(1,amp/Math.max(this.peak,absolute*8),Math.max(0,(this.db-20*Math.log10(absolute))/18)):0;
        const previous=this.level;
        this.level+=(bass-this.level)*(1-Math.exp(-dt*(bass>this.level?40:10)));
        const strength=Number(p.fracture??1);
        if(enabled&&strength>0&&this.cooldown===0&&this.level-previous>.035&&bass>.2) {
            this.hits=(this.hits+1)%65536;this.cooldown=.18;this.reveal=Math.min(1,.65+bass*.35);
            if(this.runners.length<8)this.runners.push({born:this.clock,life:1.8,offset:(this.hits*.381966)%1});
            const kind=this.hits%4;
            if(!this.faults.some(f=>f.kind===kind))this.faults.push({kind,born:this.clock,life:.65+kind*.3});
            this.spawnFractures(bass,p);
            this.spawnBorder(p);
            if(p.textGlitch!==false&&bass>.45&&this.clock>=this.textReady){
                this.textWave={born:this.clock,life:3.5,seed:this.hits};this.textReady=this.clock+3.9;
            }
        }
        const sustained=enabled&&strength>0?Math.max(0,(this.level-.3)/.7)*.55:0;
        this.reveal=Math.max(sustained,this.reveal*Math.exp(-dt/Number(p.recovery??.45)));
        if(enabled&&strength>0&&sustained>.15&&this.clock>=this.nextMemory){this.spawnFractures(sustained,p,true);this.nextMemory=this.clock+.38;}
        if(!enabled){this.reveal=0;this.runners=[];this.faults=[];this.fragments=[];this.level=0;this.textWave=null;this.borderBursts=[];}
        this.borderBursts=this.borderBursts.filter(f=>this.clock-f.born<f.life&&p['border'+f.kind[0].toUpperCase()+f.kind.slice(1)]!==false&&Number(p.borderIntensity??1)>0);
        if(p.textGlitch===false||this.textWave&&this.clock-this.textWave.born>=this.textWave.life)this.textWave=null;
        this.runners=this.runners.filter(r=>this.clock-r.born<r.life);
        this.fragments=this.fragments.filter(f=>this.clock-f.born<f.life);
        if(strength<=0)this.fragments=[];
        this.faults=this.faults.filter(f=>this.clock-f.born<f.life);
        const target=moving&&frame.pointer?.active?frame.pointer:{x:0,y:0};
        const ease=1-Math.exp(-dt*6);
        this.pointer.x+=(target.x-this.pointer.x)*ease;this.pointer.y+=(target.y-this.pointer.y)*ease;
        if(!moving)this.pointer={x:0,y:0};
    },
    render(api,frame) {
        this.update(api,frame);
        const c=api.ctx,p=frame.parameters||{},r=api.visibleRect||{x:0,y:0,width:1920,height:1080};
        const x=r.x,y=r.y,w=r.width,h=r.height;
        const compact=w/h<1.25;
        const background=c.createLinearGradient(0,0,api.width,api.height);
        background.addColorStop(0,'#1d1d29');background.addColorStop(.55,'#151720');background.addColorStop(1,'#10131c');
        c.fillStyle=background;c.fillRect(0,0,api.width,api.height);
        c.fillStyle=c.createPattern(this.backdrop,'repeat');c.fillRect(0,0,api.width,api.height);
        const depth=-Number(p.parallax??1.5),pose=this.pointer;
        c.save();c.translate(x+w/2,y+h/2);
        c.transform(1,pose.y*.0025*depth,pose.x*.003*depth,1,-pose.x*5*depth,-pose.y*3*depth);
        c.translate(-x-w/2,-y-h/2);
        // Inverted shared cursor transform; the portrait adds a small matching depth offset.
        this.interfacePose=Array.from([c.getTransform().a,c.getTransform().b,c.getTransform().c,c.getTransform().d,c.getTransform().e,c.getTransform().f]);
        const margin=Math.max(24,Math.min(54,w*.035)),bottom=y+h-Math.max(100,h*.1);
        const panelX=compact?x+margin:x+w*.50,panelY=y+margin;
        const panelW=compact?w-margin*2:w*.40,panelH=bottom-panelY;
        this.layout={panelX,panelY,panelW,panelH,compact};
        const line=(ax,ay,bx,by,color='#282331')=>{c.strokeStyle=color;c.lineWidth=1;c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke();};
        // Station bulkheads, paired rails and a recessed observation aperture.
        c.fillStyle='#10111a';c.fillRect(panelX-14,y,panelW+28,bottom-y+12);
        for(const xx of [panelX-21,panelX-9,panelX+panelW+9,panelX+panelW+21])line(xx,y,xx,bottom+12);
        if(!compact)for(let i=0;i<18;i++)line(panelX-30,panelY+22+i*(panelH-44)/17,panelX-24,panelY+22+i*(panelH-44)/17,'#5a486c');
        const px=-pose.x*1.25*depth,py=-pose.y*.75*depth;
        c.save();c.beginPath();c.roundRect(panelX,panelY,panelW,panelH,4);c.clip();
        // Overscan retains coverage at maximum pointer travel; crop is shared by both states.
        const scale=Math.max((panelW+128)/1672,(panelH+96)/941);
        const iw=1672*scale,ih=941*scale;
        const ix=panelX+(panelW-iw)/2+px,iy=panelY+(panelH-ih)/2+py;
        this.portraitPose={ix,iy,iw,ih,px,py,depth};
        c.drawImage(this.layers.calm,ix,iy,iw,ih);
        const reveal=Math.min(1,this.reveal*Number(p.fracture??1));
        // Infection opens angular windows through the suppressor, not a full-image fade.
        // Each packet grows, drifts and contracts independently; later beats never reset it.
        for(const f of this.fragments) {
            const age=this.clock-f.born;if(age<0)continue;
            const phase=age/f.life,aperture=Math.min(1,phase/.12,(1-phase)/.30);
            if(aperture<=0)continue;
            const fw=f.w*iw*aperture,fh=f.h*ih;
            const fx=ix+(f.x+age*f.drift)*iw+(f.reverse?f.w*iw-fw:0),fy=iy+f.y*ih;
            const offset=p.glitch!==false?Math.exp(-phase*5)*Number(p.distortion??1):0;
            const dx=f.dx*offset,dy=f.dy*offset;
            // Bevels and diagonals echo the carbon-fiber mask and originium crystals.
            c.save();c.beginPath();c.moveTo(fx+fw*.13,fy);c.lineTo(fx+fw,fy+fh*.12);
            c.lineTo(fx+fw*.90,fy+fh*.78);c.lineTo(fx+fw*.42,fy+fh);
            c.lineTo(fx,fy+fh*.66);c.closePath();c.clip();
            c.drawImage(this.layers.fracture,ix+dx,iy+dy,iw,ih);
            if(offset>.15){c.globalAlpha=.22*offset;c.drawImage(this.violet,ix-dx*.45,iy-dy*.4,iw,ih);}
            c.restore();
            c.save();c.globalAlpha=Math.min(.6,aperture*.5)*(1-phase);
            c.strokeStyle=f.memory?'#755598':'#cf9fff';c.lineWidth=1;
            c.beginPath();c.moveTo(fx+fw*.13,fy);c.lineTo(fx+fw*.53,fy+fh*.04);c.stroke();c.restore();
        }
        const shade=c.createLinearGradient(panelX,panelY,panelX,bottom);
        shade.addColorStop(0,'rgba(5,8,15,.12)');shade.addColorStop(.65,'rgba(5,8,15,0)');shade.addColorStop(1,'rgba(5,8,15,.76)');
        c.fillStyle=shade;c.fillRect(panelX,panelY,panelW,panelH);
        c.restore();
        c.strokeStyle='#343143';c.lineWidth=1;c.strokeRect(panelX+.5,panelY+.5,panelW-1,panelH-1);
        // Short violet pulses travel around a single closed frame.
        const perimeter=2*(panelW+panelH);
        const point=d=>{d=(d%perimeter+perimeter)%perimeter;if(d<panelW)return[panelX+d,panelY];d-=panelW;if(d<panelH)return[panelX+panelW,panelY+d];d-=panelH;if(d<panelW)return[panelX+panelW-d,bottom];return[panelX,bottom-(d-panelW)];};
        for(const runner of this.runners) {
            const age=this.clock-runner.born;c.strokeStyle='rgba(196,151,255,'+(1-age/runner.life)*.8+')';c.lineWidth=2;
            c.beginPath();for(let i=0;i<=16;i++){const pt=point(runner.offset*perimeter+age*420-i*5);if(i)c.lineTo(...pt);else c.moveTo(...pt);}c.stroke();
        }
        // Confine all auxiliary bursts to the aperture's perimeter, leaving the face and UI clear.
        c.save();c.beginPath();c.rect(panelX-34,panelY-22,panelW+68,panelH+44);
        c.rect(panelX+8,panelY+8,panelW-16,panelH-16);c.clip('evenodd');
        const borderGain=Number(p.borderIntensity??1);
        for(const f of this.borderBursts){
            const age=this.clock-f.born,phase=age/f.life;
            const envelope=Math.max(0,Math.min(1,age/.055,(1-phase)/.35));
            c.save();c.globalAlpha=Math.min(1,envelope*borderGain);c.shadowColor='#b460f1';c.shadowBlur=8;
            if(f.kind==='echo'){
                const d=3+phase*22;c.globalAlpha*=.65*(1-phase);c.strokeStyle='#cda4ff';c.lineWidth=1.5;
                c.strokeRect(panelX-d,panelY-d,panelW+2*d,panelH+2*d);
                c.strokeStyle='#f1b5dd';c.globalAlpha*=.45;c.strokeRect(panelX-d-4,panelY-d-4,panelW+2*d+8,panelH+2*d+8);
            }else if(f.kind==='shard'){
                const vertical=f.side<2,sign=f.side%2?1:-1;
                const drift=phase*(10+f.seed*16),travel=phase*f.direction*35;
                const xx=vertical?(sign<0?panelX-drift:panelX+panelW+drift):panelX+f.anchor*panelW+travel;
                const yy=vertical?panelY+f.anchor*panelH+travel:(sign<0?panelY-drift:bottom+drift);
                const length=(6+f.seed*12)*(1-phase*.6),width=2+f.seed*3;
                c.translate(xx,yy);c.rotate(f.seed*3+phase*f.direction*.8);
                c.fillStyle='#9c69ce';c.strokeStyle='#dfbaff';c.lineWidth=.8;
                c.beginPath();c.moveTo(0,-length);c.lineTo(width,0);c.lineTo(0,length*.5);c.lineTo(-width*.6,0);c.closePath();c.fill();c.stroke();
            }else if(f.kind==='arc'){
                const xx=f.side%2?panelX+panelW+12:panelX-12;
                const start=panelY+f.anchor*Math.max(1,panelH-100);
                c.globalAlpha*=.65+.35*Math.sin(Math.floor(age*20)*7+f.seed*10)**2;
                const path=()=>{c.beginPath();for(let i=0;i<8;i++){
                    const ax=xx+Math.sin(f.seed*91+i*13)*8,ay=start+i*14;
                    if(i)c.lineTo(ax,ay);else c.moveTo(ax,ay);
                }};
                c.strokeStyle='#9b46d5';c.lineWidth=4;path();c.stroke();
                c.strokeStyle='#ebc4ff';c.lineWidth=1;path();c.stroke();
                c.beginPath();c.moveTo(xx,start+42);c.lineTo(xx+f.direction*13,start+53);c.lineTo(xx+f.direction*17,start+76);c.stroke();
            }else if(f.kind==='scan'){
                const head=panelX+(f.direction>0?phase:1-phase)*panelW;
                const yy=f.side%2?panelY-5:bottom+5;
                const tail=head-f.direction*(80+f.seed*100);
                const glow=c.createLinearGradient(tail,yy,head,yy);glow.addColorStop(0,'rgba(153,76,218,0)');glow.addColorStop(1,'#dfb4ff');
                c.strokeStyle=glow;c.lineWidth=3;c.beginPath();c.moveTo(tail,yy);c.lineTo(head,yy);c.stroke();
                c.fillStyle='#f4d2f6';c.fillRect(head-1,yy-4,2,8);
                for(let i=0;i<3;i++){c.fillStyle='rgba(190,126,231,'+(.4-i*.1)+')';c.fillRect(head-f.direction*(15+i*12),yy+7,6,1);}
            }
            c.restore();
        }
        c.restore();
        const textX=x+margin,textY=compact?panelY+28:y+h*.14;
        c.save();
        if(compact){c.fillStyle='rgba(8,11,18,.78)';c.fillRect(textX-8,textY-24,Math.min(panelW-20,390),110);}
        const wave=this.textWave,age=wave?this.clock-wave.born:-1;
        const waveWidth=Math.max(24,w*.026);
        const waveCenter={x:panelX+panelW*.5+px,y:panelY+panelH*.52+py};
        const squareNorm=(dx,dy)=>(Math.abs(dx)**6+Math.abs(dy)**6)**(1/6);
        // A superellipse keeps broad flat sides and rounded corners; small stable ripples
        // roughen the contour without frame-to-frame jitter or a different text boundary.
        const roughness=angle=>1+.009*Math.sin(angle*12+(wave?.seed||0))+.004*Math.sin(angle*27+(wave?.seed||0)*.7);
        const waveMetric=(dx,dy)=>squareNorm(dx,dy)/roughness(Math.atan2(dy,dx));
        const waveReach=Math.max(...[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([xx,yy])=>waveMetric(xx-waveCenter.x,yy-waveCenter.y)))+waveWidth;
        const waveRadius=Math.max(0,age)*waveReach/3.2;
        const root=this.interfacePose,det=root[0]*root[3]-root[1]*root[2];
        const scenePoint=(matrix,xx,yy)=>{
            const ax=matrix.a*xx+matrix.c*yy+matrix.e-root[4],ay=matrix.b*xx+matrix.d*yy+matrix.f-root[5];
            return {x:(root[3]*ax-root[2]*ay)/det,y:(root[0]*ay-root[1]*ax)/det};
        };
        // A slow rounded-square shock front expands from the portrait's center.
        if(wave&&age>=0){
            // The portrait aperture occludes the entire wave, including its wide glow.
            c.save();c.beginPath();c.rect(x,y,w,h);
            c.roundRect(panelX,panelY,panelW,panelH,4);c.clip('evenodd');
            const trace=()=>{c.beginPath();for(let i=0;i<=192;i++){
                const angle=i/192*Math.PI*2,dx=Math.cos(angle),dy=Math.sin(angle);
                const radius=waveRadius*roughness(angle)/squareNorm(dx,dy);
                const xx=waveCenter.x+dx*radius,yy=waveCenter.y+dy*radius;
                if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);
            }c.closePath();};
            c.strokeStyle='rgba(181,76,230,.055)';c.lineWidth=waveWidth*2;trace();c.stroke();
            c.strokeStyle='rgba(219,125,255,.38)';c.lineWidth=1.4;trace();c.stroke();c.restore();
        }
        const label=(value,tx,ty,size,color='#a9a5b9',weight=400)=>{
            const original=String(value);c.save();c.font=weight+' '+size+'px '+(size<=18?'monospace':'sans-serif');
            if(!wave){c.fillStyle=color;c.fillText(original,tx,ty);c.restore();return;}
            const chars=Array.from(original),matrix=c.getTransform(),glyphs=[];
            let prefix='',affected=false;
            for(const ch of chars){
                const offset=c.measureText(prefix).width;prefix+=ch;
                const advance=c.measureText(prefix).width-offset;
                const pt=scenePoint(matrix,tx+offset+advance*.5,ty-size*.4);
                const distance=wave&&age>=0?Math.abs(waveMetric(pt.x-waveCenter.x,pt.y-waveCenter.y)-waveRadius):Infinity;
                const strength=Math.max(0,1-distance/waveWidth);
                glyphs.push({ch,offset,advance,strength});if(strength>0&&ch!==' ')affected=true;
            }
            if(!affected){c.fillStyle=color;c.fillText(original,tx,ty);c.restore();return;}
            // Retain original glyph positions so distortion cannot shift untouched letters.
            for(let i=0;i<glyphs.length;i++){
                const g=glyphs[i],xx=tx+g.offset;
                if(g.strength<=0||g.ch===' '){c.fillStyle=color;c.fillText(g.ch,xx,ty);continue;}
                const tick=Math.floor(age*22),symbol=g.strength>.25?'01/<>:#_[]'[(wave.seed+i*3+tick)%10]:g.ch;
                const shift=Math.sin(tick*2.7+wave.seed+i)*Math.min(7,2+size*.12)*g.strength;
                c.save();c.beginPath();c.rect(xx-3,ty-size-4,g.advance+6,size+10);c.clip();
                c.fillStyle='rgba(197,78,232,'+g.strength*.2+')';c.fillRect(xx,ty-size,g.advance,size+3);
                c.globalAlpha=g.strength*.8;c.fillStyle='#ff55bc';c.fillText(symbol,xx-shift,ty+1);
                c.fillStyle='#a97bff';c.fillText(symbol,xx+shift,ty-1);
                c.globalAlpha=1;c.fillStyle='#f2bfff';c.shadowColor='#b949fa';c.shadowBlur=g.strength*6;
                c.fillText(symbol,xx,ty);c.restore();
            }c.restore();
        };
        const fault=kind=>this.faults.find(f=>f.kind===kind);
        const faultFade=kind=>{const f=fault(kind);return f?Math.min(1,(f.life-(this.clock-f.born))/.25):0;};
        label('ENDFIELD  /  INTERNAL RECORD',textX,textY,compact?11:14,'#8e839e');
        label('ENDMINISTRATOR',textX,textY+(compact?33:64),compact?23:Math.min(42,w*.023),'#eee9f7',600);
        label('F R A C T U R E',textX,textY+(compact?57:104),compact?12:18,'#bd9aee');
        if(!compact) {
            const end=x+w*.445;
            line(textX,textY-30,end,textY-30);
            c.fillStyle='#b38fd5';c.fillRect(textX,textY-32,66,3);
            const base=textY+177;
            const available=bottom-textY;
            // Fit the complete instrument into shorter wide windows, like Perlica's panel.
            // Reserve the spectrum header, graph and axis before fitting the upper instrument.
            // Its lowest fault strip is 652 design pixels below textY, including its height.
            const uiScale=Math.min(1,Math.max(.1,(available-(p.spectrum!==false?185:28))/652),(end-textX)/750);
            this.telemetryLayout={bottom:textY+652*uiScale,spectrumTop:bottom-159};
            c.save();c.translate(textX,textY);c.scale(uiScale,uiScale);c.translate(-textX,-textY);
            const uiEnd=textX+(end-textX)/uiScale;
            line(textX,base,uiEnd,base);
            label('01 / SUPPRESSOR',textX,base+32,13,'#726881');
            label(reveal>.15?'[ ! ] INTEGRITY COMPROMISED':'[ + ] CONTAINMENT STABLE',textX,base+63,18,reveal>.15?'#d1a7ff':'#b9b0c8',500);
            const rows=[['UPLINK',fault(0)?'ERR / RELAY DISCONNECTED':'DIJIANG / ENCRYPTED'],['MEMORY',fault(1)?'FRAGMENT / ACCESS DENIED':'ARCHIVE / SEALED'],['DIRECTIVE',fault(2)?'SUPPRESSOR / BREACH':'ZEROTH / STANDBY']];
            rows.forEach(([key,value],i)=>{
                label(key,textX,base+112+i*30,11,'#746881');
                label(value,textX+185,base+112+i*30,13,fault(i)?'#d6a4f0':'#b5a8c8');
                c.fillStyle=fault(i)?'#ae73d7':'#3d344c';c.fillRect(uiEnd-8,base+104+i*30,4,4);
            });
            const meterY=base+210,meterW=uiEnd-textX;
            c.fillStyle='#101019';c.fillRect(textX,meterY,meterW,126);
            line(textX,meterY,uiEnd,meterY,'#3b2c4b');
            label('02 / LOW-FREQUENCY PRESSURE',textX+14,meterY+25,12,'#857591');
            label((this.db<=-90?'—':this.db.toFixed(1))+' dB',textX+14,meterY+63,24,'#d7c2ee',500);
            label('35–180 Hz / RMS',uiEnd-195,meterY+62,12,'#877491');
            const dbLevel=Math.max(0,Math.min(1,(this.db+60)/50));
            for(let i=0;i<48;i++){c.fillStyle=i/48<dbLevel?(i>39?'#dfb5eb':'#a980ce'):'#292032';c.fillRect(textX+14+i*(meterW-28)/48,meterY+80,Math.max(1,(meterW-28)/48-3),9);}
            for(let i=0;i<6;i++)label(String(-60+i*10),textX+14+i*(meterW-44)/5,meterY+111,10,'#72617f',400);
            // Short independent faults repair themselves instead of accumulating text.
            label('03 / NOW PLAYING',textX,base+377,12,'#726881');
            const fit=(value,width,size)=>{
                c.font='400 '+size+'px monospace';
                const chars=Array.from(String(value||''));
                if(c.measureText(chars.join('')).width<=width)return chars.join('');
                while(chars.length&&c.measureText(chars.join('')+'…').width>width)chars.pop();
                return chars.join('')+'…';
            };
            const playing=frame.playback||{};
            label(fit(playing.title||'AWAITING TRACK DATA',meterW,18),textX,base+408,18,'#e3d6b9',500);
            if(playing.artist)label(fit(playing.artist,meterW,11),textX,base+430,11,'#93849f',400);
            const phase=Math.floor(this.clock*.35)%3;
            const packets=['RX / SUPPRESSOR CHANNEL ONLINE','RX / ARCHIVE CHECKSUM VALID','RX / MEMORY PARTITION LOCKED'];
            label(fault(3)?'!  QUARANTINE / RESTORING':packets[phase],textX,base+450,12,fault(3)?'#d5a6e7':'#796c88');
            for(let i=0;i<36;i++){
                const broken=fault(3)&&i%7<3;
                c.fillStyle=broken?'#ac71c4':'#383044';c.fillRect(textX+i*meterW/36,base+468,Math.max(1,meterW/36-4),broken?7:3);
            }
            if(fault(2)){
                c.save();c.globalAlpha=faultFade(2)*.6;c.fillStyle='#b985e0';
                for(let i=0;i<5;i++)c.fillRect(uiEnd-115+i*19,base-8+(i%3)*5,12,2);
                c.restore();
            }
            c.restore();
            if(p.spectrum!==false) {
                const bands=frame.motion!==false&&!frame.reducedMotion&&frame.audio?.enabled&&frame.audio?.playing?api.spectrum(48,35,12000,'fracture','log'):this.silentBands;
                const sw=end-textX,by=bottom-65;
                const freqX=hz=>textX+Math.log(hz/35)/Math.log(12000/35)*sw;
                label('SPECTRAL ANALYSIS / LOG',textX,by-84,10,'#9583a6');
                label('35 Hz — 12 kHz',end-150,by-84,10,'#9583a6',400);
                for(const hz of [35,60,100,250,500,1000,2500,5000,12000]){
                    const xx=freqX(hz);line(xx,by-70,xx,by+5,'rgba(147,117,174,.13)');
                    const value=hz>=1000?String(hz/1000)+'k':String(hz);
                    c.font='400 9px monospace';const tw=c.measureText(value).width;
                    label(value,Math.max(textX,Math.min(end-tw,xx-tw/2)),by+17,9,'#867394',400);
                }
                c.fillStyle='#b293d8';
                for(let i=0;i<bands.length;i++)c.fillRect(textX+i*sw/48,by-bands[i]*70,Math.max(1,sw/48-3),Math.max(1,bands[i]*70));
                line(textX,by+1,end,by+1,'#665071');
                for(const [a,b,title]of [[35,250,'LOW'],[250,2500,'MID'],[2500,12000,'HIGH']]){
                    const left=freqX(a),right=freqX(b);
                    line(left+3,by+28,right-3,by+28,'#41334d');
                    label(title,(left+right)/2-12,by+44,9,'#9b85ac');
                }
            }
            // Auxiliary strip is outside the portrait: readable even during mask glitches.
            const railX=panelX+panelW+38,railW=Math.max(24,x+w-margin-railX);
            label('TALOS-II',railX,panelY+30,10,'#93809e');
            label('DECK / 07',railX,panelY+49,9,'#665972');
            const railY=panelY+108,railH=Math.max(80,panelH-260);
            line(railX+7,railY,railX+7,railY+railH,'#382a45');
            for(let i=0;i<24;i++){
                const lit=i/24<this.level;c.fillStyle=lit?'#ba8ee6':'#30263a';
                c.fillRect(railX,railY+railH-i*railH/24,Math.min(railW,lit?26:14),2);
            }
            label('LOCK',railX,bottom-80,10,reveal>.15?'#d6b4f3':'#83708d');
            for(let i=0;i<4;i++){c.fillStyle=fault(i)?'#b679d4':'#352a3f';c.fillRect(railX+i*9,bottom-60,4,14);}
        }
        c.restore();
        label('SUPPRESSOR  //  '+(reveal>.15?'FRACTURED':'SEALED'),panelX+20,bottom-25,compact?10:12,reveal>.15?'#dab9ff':'#aca4b5');
        if(compact)label((this.db<=-90?'—':this.db.toFixed(1))+' dB',panelX+panelW-95,bottom-25,12,'#d7c2ee',400);
        if(p.particles!==false) {
            c.save();c.beginPath();c.rect(panelX,panelY,panelW,panelH);c.clip();
            for(let i=0;i<24;i++) {
                const xx=panelX+((i*.61803398875)%1)*panelW;
                const yy=panelY+((i*.381966+this.clock*.008*(1+i%3))%1)*panelH;
                c.fillStyle='rgba(195,174,223,'+(.08+(i%5)*.025+reveal*.07)+')';c.fillRect(xx,yy,1.5,1.5);
            }c.restore();
        }
        // Angular foreground console ties both panels together, as on Perlica's station.
        line(x+margin,bottom+23,panelX-34,bottom+23);
        line(panelX-34,bottom+23,panelX-14,bottom+43);
        line(panelX-14,bottom+43,panelX+panelW+14,bottom+43);
        if(!compact){label('ENDFIELD / RESTRICTED PERSONNEL FILE',textX,bottom+55,10,'#574b63');label('SUPPRESSOR INTERFACE',panelX+20,bottom+67,10,'#574b63');}
        c.restore();
    },
    dispose(api) { for(const surface of Object.values(this.layers||{}))api.releaseSurface(surface);if(this.violet)api.releaseSurface(this.violet);if(this.backdrop)api.releaseSurface(this.backdrop);this.layers={};this.fragments=[];this.runners=[];this.borderBursts=[]; }
});
