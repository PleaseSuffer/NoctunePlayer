// Rhodes Island / PRTS field terminal. Themes API v2.
NoctuneScene.define({
    init(api) {
        // Convert the supplied monochrome mark into a reusable transparent ink mask.
        const s = api.createSurface(1536, 1344), c = s.getContext('2d');
        c.drawImage(api.images.logo, 0, 0, 1536, 1344);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = api.palette.background === '#eaf0f2' ? '#172c3b' : '#e3eef4';
        c.fillRect(0, 0, 1536, 1344);
        this.mark = s;
        this.echo = api.createSurface(1536, 1344);
        const e = this.echo.getContext('2d');
        e.drawImage(s, 0, 0);e.globalCompositeOperation='source-in';e.fillStyle='#9edbf1';e.fillRect(0,0,1536,1344);
        this.warp = api.createSurface(1536,1344);
        this.panel = api.createSurface(1200,900);
    },
    render(api, frame) {
        let c = api.ctx;
        const t = api.time, p = frame.parameters;
        const light = api.palette.background === '#eaf0f2';
        const bg = api.palette.background, ink = light ? '#172c3b' : '#e3eef4';
        const muted = light ? '#657e8a' : '#7894a8', yellow = light ? '#167b9d' : '#46c8ed';
        const faint = light ? 'rgba(35,80,105,.09)' : 'rgba(115,177,211,.08)';
        const glitch=Number(p.glitch ?? .6), drift=Number(p.backgroundMotion ?? 1);
        const bt=t*drift, energy=api.energy;
        const rect = api.visibleRect;
        c.fillStyle = bg; c.fillRect(0, 0, api.width, api.height);
        // A quiet cartographic field behind the high contrast central instrument.
        c.strokeStyle = faint; c.lineWidth = 1;
        for (let x = 0; x < 1920; x += 64) for (let y = 0; y < 1080; y += 64) {
            c.beginPath(); c.moveTo(x-3,y); c.lineTo(x+3,y); c.moveTo(x,y-3); c.lineTo(x,y+3); c.stroke();
        }
        if (p.contours !== false) {
            for (let j = 0; j < 19; j++) {
                c.beginPath();
                for (let i = 0; i <= 100; i++) {
                    const a = i / 100 * Math.PI * 2, r = 360 + j * 25;
                    const x = 960 + Math.cos(a)*r*(1+.055*Math.sin(a*5+j*.16+bt*.24)) + Math.sin(bt*.18+j*.18)*18;
                    const y = 470 + Math.sin(a)*r*.69 + 18*Math.sin(a*3+j*.23-bt*.32);
                    if (!i) c.moveTo(x,y); else c.lineTo(x,y);
                }
                c.closePath(); c.stroke();
            }
        }
        // PRTS radar: a rotating sweep and discontinuous range rings across the viewport.
        c.save();c.translate(960,470);c.strokeStyle=yellow;
        for(let j=0;j<4;j++) {
            c.globalAlpha=.045;c.beginPath();c.arc(0,0,330+j*115,bt*.035+j*.2,bt*.035+j*.2+Math.PI*1.7);c.stroke();
        }
        c.rotate(bt*.13);c.globalAlpha=.07;
        c.beginPath();c.moveTo(0,0);c.lineTo(1000,0);c.stroke();
        for(let j=0;j<7;j++) {c.globalAlpha=.018*(1-j/7);c.rotate(-.025);c.beginPath();c.moveTo(0,0);c.lineTo(1000,0);c.stroke();}
        c.restore();
        // Full-viewport telemetry: orbiting packets, wind trails and travelling interference.
        c.save();
        if(p.particles !== false) for(let i=0;i<100;i++) {
            const f=(Math.sin(i*127.1)*43758.5)%1;
            const x=((i*193.7+bt*(12+Math.abs(f)*30))%1920+1920)%1920;
            const y=((i*89.3-bt*(8+i%7))%1080+1080)%1080;
            c.strokeStyle=i%6 ? muted : yellow;c.globalAlpha=.12+(i%5)*.045;
            c.beginPath();c.moveTo(x,y);c.lineTo(x-8-i%23,y+3);c.stroke();
            c.fillStyle=i%9===0 ? '#c8955d' : yellow;
            if(i%7===0) {
                // Stylized mineral fragments, not a simulated medical reading.
                c.save();c.translate(x,y);c.rotate(bt*.09+i);c.beginPath();c.moveTo(0,-7);c.lineTo(3,0);c.lineTo(0,8);c.lineTo(-3,0);c.closePath();c.stroke();c.restore();
            } else c.fillRect(x,y,2,2);
        }
        for(let i=0;i<9;i++) {
            const a=bt*(.07+i*.003)+i*2.4,r=430+i*48;
            const x=960+Math.cos(a)*r,y=470+Math.sin(a)*r*.69;
            c.globalAlpha=.22;c.strokeStyle=yellow;c.strokeRect(x-5,y-5,10,10);
            c.beginPath();c.moveTo(x-25,y);c.lineTo(x-10,y);c.stroke();
        }
        if(p.scan !== false) {
            const x=(bt*83)%2300-190;
            const g=c.createLinearGradient(x-160,0,x+18,0);
            g.addColorStop(0,'transparent');g.addColorStop(.9,light?'rgba(30,140,170,.035)':'rgba(70,200,237,.035)');g.addColorStop(1,'transparent');
            c.globalAlpha=1;c.fillStyle=g;c.fillRect(x-160,0,178,1080);
        }
        if(glitch>0) for(let j=0;j<3;j++) {
            const travel=(t*(135+j*51)+j*357)%1350-150;
            const envelope=Math.pow(Math.max(0,Math.sin(t*1.9+j*2.1)),6)*glitch;
            c.globalAlpha=envelope*.25;c.fillStyle=j%2?yellow:muted;
            for(let k=0;k<7;k++) {const x=(j*571+k*239+t*(34+k*7))%1920;c.fillRect(x,travel+k*3,30+(k*37)%140,k%3===0?3:1);}
        }
        c.restore();
        // Fit the complete instrument into the visible cover crop and above player controls.
        let availableBottom = rect.y + rect.height - 75;
        if (api.safeArea && api.safeArea.y > rect.y + rect.height*.45) availableBottom = Math.min(availableBottom, api.safeArea.y-24);
        const scale = Math.max(.12, Math.min(1, (rect.width-56)/1120, (availableBottom-rect.y-80)/780));
        c.save(); c.translate(rect.x+rect.width/2, rect.y+40+(availableBottom-rect.y-40)/2); c.scale(scale,scale);
        const output=c;
        c=this.panel.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,1200,900);c.save();c.translate(600,450);
        // Frame-rate-independent damping, driven exclusively by the host cursor.
        const depth=Number(p.parallax ?? 1);
        const target=frame.motion && frame.pointer?.active ? frame.pointer : {x:0,y:0};
        const alpha=1-Math.exp(-Math.min(.08,Math.max(0,frame.dt))*7);
        this.tiltX=(this.tiltX ?? 0)+(target.x-(this.tiltX ?? 0))*alpha;
        this.tiltY=(this.tiltY ?? 0)+(target.y-(this.tiltY ?? 0))*alpha;
        const yaw=-this.tiltX*.28*depth,pitch=this.tiltY*.22*depth;
        const cameraX=this.tiltX*12*depth,cameraY=this.tiltY*9*depth;
        c.translate(cameraX*.3,cameraY*.3);
        const text = (s,x,y,size=12,color=muted) => {
            const float=Number(p.textFloat ?? 1);
            c.fillStyle=color;c.font=`${size}px monospace`;
            c.fillText(s,x+Math.sin(t*.37+y*.008)*1.8*float,y+Math.sin(t*.29+x*.006)*1.3*float);
        };
        const line = (x,y,xx,yy,color=faint) => { c.strokeStyle=color;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.stroke(); };
        const animated=p.animatedText !== false;
        const tt=animated?t:0, tick=Math.floor(tt*8);
        const decode=(s,seed=0)=>{
            if(!animated) return s;
            const phase=(tt+seed)%8;
            if(phase>1.2) return s;
            const settled=Math.floor(phase/1.2*s.length);
            return [...s].map((ch,i)=>i<settled||ch===' '?ch:'0123456789ABCDEF/:'[(tick*7+i*3+seed)%18]).join('');
        };
        text('RHODES ISLAND',-530,-338,15,ink);
        text(decode('PHARMACEUTICALS INC.'),-530,-315,11);
        text(light ? '02 / MEDICAL WHITE' : '01 / PRTS BLACK',330,-338,13,yellow);
        line(-530,-292,530,-292);
        c.fillStyle=yellow;c.fillRect(-530,-292,52,3);
        c.save();c.translate(cameraX,cameraY);
        // The original mark and its three edge-aligned frequency instruments.
        const vertices=[[0,-260],[305,280],[-305,280]];
        const ranges=[[35,260],[260,2400],[2400,16000]];
        const labels=['01 / LOW','02 / MID','03 / HIGH'];
        const gain = Number(p.amplitude ?? 1);
        for(let side=0;side<3;side++) {
            const a=vertices[side],b=vertices[(side+1)%3],dx=b[0]-a[0],dy=b[1]-a[1];
            const length=Math.hypot(dx,dy),nx=dy/length,ny=-dx/length;
            const bands=api.bandsSource({count:64,minHz:ranges[side][0],maxHz:ranges[side][1],spacing:'log',attack:24,release:8,smoothing:.3});
            line(a[0],a[1],b[0],b[1],yellow);
            c.save();c.strokeStyle=yellow;c.lineWidth=3;
            c.shadowColor=yellow;c.shadowBlur=7*(frame.lighting?.intensity ?? 1);
            for(let i=0;i<64;i++) {
                const u=(i+.5)/64,x=a[0]+dx*u+nx*8,y=a[1]+dy*u+ny*8,h=bands[i]*(side===1?28:82)*gain;
                if(h<.25) continue;
                c.beginPath();c.moveTo(x,y);c.lineTo(x+nx*h,y+ny*h);c.stroke();
            }
            c.restore();
            for(let j=0;j<7;j++) {const u=j/6;line(a[0]+dx*u+nx*(side===1?38:108),a[1]+dy*u+ny*(side===1?38:108),a[0]+dx*u+nx*(side===1?43:113),a[1]+dy*u+ny*(side===1?43:113));}
            const u=(t*.11+side/3)%1;
            c.fillStyle=yellow;c.fillRect(a[0]+dx*u-2,a[1]+dy*u-2,4,4);
        }
        // Travelling wave packets displace the actual image slices, then settle back.
        const burst=Math.pow(Math.max(0,Math.sin(t*2.3)+.22*Math.sin(t*5.7)),5);
        const w=this.warp.getContext('2d');w.clearRect(0,0,1536,1344);
        for(let sy=0;sy<1344;sy+=8) {
            const y=sy/1344*525-247;
            let offset=0;
            for(let j=0;j<2;j++) {
                const center=((t*(180+j*73)+j*270)%760)-360;
                const d=(y-center)/32;
                offset+=Math.exp(-d*d)*Math.sin(y*.22-t*31+j)*glitch*(9+burst*19+energy*7);
            }
            const h=Math.min(8,1344-sy);
            if(Math.abs(offset)>.6) {w.globalAlpha=.45;w.drawImage(this.echo,0,sy,1536,h,-offset*2,sy,1536,h);w.globalAlpha=1;}
            w.drawImage(this.mark,0,sy,1536,h,offset*2.56,sy,1536,h);
        }
        c.drawImage(this.warp,-300,-247,600,525);
        // Motto is an inscription inside the emblem, separate from signal glitches.
        // Keep it still relative to the tower and outside the spectrum's outward bars.
        if(p.motto !== false) {
            const inscription=(s,x,y,angle)=>{
                c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=bg;
                c.font='11px Georgia';c.textAlign='center';c.textBaseline='middle';
                c.fillText(s,0,0,260);c.restore();
            };
            inscription('May I enjoy my life and practice my art.',-176,107,-Math.atan2(540,305));
            inscription('Respected by all men and in all times.',176,107,Math.atan2(540,305));
        }
        c.save();c.translate(cameraX*.35,cameraY*.35);
        text(decode(labels[0],2),260,-20,11,yellow);text(decode(labels[1],3),365,300,10,yellow);text(decode(labels[2],4),-350,-20,11,yellow);
        c.restore();c.restore();
        // Independent telemetry layers move more slowly than the emblem.
        c.save();c.translate(cameraX*.65,cameraY*.65);
        const hex=(n,width=4)=>Math.floor(n).toString(16).toUpperCase().padStart(width,'0');
        const position=frame.playback?.position;
        const seconds=Number.isFinite(position) ? Math.max(0,Math.floor(position)) : null;
        const pad=n=>String(n).padStart(2,'0');
        const hours=seconds===null?0:Math.floor(seconds/3600);
        const clock=seconds===null?'--:--:--':hours>=100
            ? Math.floor(hours/24)+'d '+pad(hours%24)+':'+pad(Math.floor(seconds/60)%60)
            : [hours,Math.floor(seconds/60)%60,seconds%60].map(pad).join(':');
        text(frame.playback?.live ? 'UPLINK / LIVE' : 'TRACK / '+clock,-525,-236,11,yellow);
        text(decode('PRTS // CONNECTED',1),-525,-214,10);
        text('PKT '+hex(tick*37%65536),-525,-193,10);
        text('ORIGINIUM / SCAN',370,-236,10,yellow);
        text('RX '+hex(tick*13%65536),370,-214,10);
        text(decode('FIELD OPS / READY',5),370,-193,10);
        text('MEDICAL / TELEMETRY',370,132,10,yellow);
        c.strokeStyle=yellow;c.globalAlpha=.45;c.beginPath();
        for(let i=0;i<=140;i++) {
            const phase=((i-tt*34)%78+78)%78;
            const pulse=Math.exp(-Math.pow((phase-28)/2.8,2))*-16+Math.exp(-Math.pow((phase-34)/3,2))*9;
            const yy=156+pulse*(.4+energy*.6);
            if(i===0)c.moveTo(370+i,yy);else c.lineTo(370+i,yy);
        }
        c.stroke();c.globalAlpha=1;
        text(decode('ORIPATHY RESEARCH',6),370,185,9);
        // Tiny terminal rows scroll upward continuously, fading at their boundaries.
        for(let i=0;i<4;i++) {
            const row=(i+tt*.7)%4, y=155+row*18;
            c.globalAlpha=Math.sin(row/4*Math.PI)*.65;
            text(hex((Math.floor(tt*.7)+i)*379%65536)+' : '+['PRTS OK','MED LINK','OPS SYNC','RI DATA'][(Math.floor(tt*.7)+i)%4],-525,y,10);
        }
        c.globalAlpha=1;
        if(animated && Math.floor(tt*2)%2===0) {c.fillStyle=yellow;c.fillRect(-525+95,-201,5,9);}
        c.restore();
        if(p.particles !== false) for(let i=0;i<64;i++) {
            const seed=Math.sin(i*127.1+34)*43758.5453, f=seed-Math.floor(seed);
            const x=((i*97.73+t*(5+f*10))%1060)-530,y=((i*71.31-t*(9+f*16))%610+610)%610-280;
            if(Math.abs(x)<310 && y<260) continue;
            c.globalAlpha=.15+f*.4;c.fillStyle=i%5?muted:yellow;c.fillRect(x,y, i%9?2:5,2);
        }
        c.globalAlpha=1;
        if(p.scan !== false) {const y=-260+(t*38%545);c.globalAlpha=.14;line(-315,y,315,y,yellow);c.globalAlpha=1;}
        line(-530,322,530,322);text('TERRA  //  LANDSHIP NETWORK',-530,350,12,ink);
        text(decode('PRTS / ACOUSTIC MONITOR',3),-530,373,10);
        text(frame.audio.playing && frame.audio.enabled ? 'PRTS / ONLINE' : 'PRTS / STANDBY',325,350,12,yellow);
        const meter=api.bandsSource({count:44,minHz:35,maxHz:16000,spacing:'hybrid',attack:22,release:8,smoothing:.3});
        for(let i=0;i<44;i++) {
            const h=3+meter[i]*25;
            c.fillStyle=i%5===Math.floor(tt*11)%5?yellow:ink;
            c.fillRect(330+i*4,394-h,i%3?1:2,h);
        }
        text('RX '+hex(tick*71%65536)+' / '+String(Math.round(energy*100)).padStart(3,'0')+'%',325,414,10);
        if(animated) {c.fillStyle=yellow;c.globalAlpha=.4+.6*Math.pow(Math.sin(tt*3),2);c.fillRect(313,342,4,4);c.globalAlpha=1;}
        c.restore();
        // Perspective projection of the complete panel, including text and the spectrum.
        // Each mesh cell is two affine triangles; source coordinates stay continuous.
        const project=(u,v)=>{
            const x=u-600,y=v-450;
            const xx=x*Math.cos(yaw),z=-x*Math.sin(yaw);
            const yy=y*Math.cos(pitch)-z*Math.sin(pitch),zz=y*Math.sin(pitch)+z*Math.cos(pitch);
            const k=1500/(1500+zz);return [xx*k,yy*k];
        };
        const tri=(a,b,d)=>{
            const A=project(...a),B=project(...b),D=project(...d);
            const ux=b[0]-a[0],uy=b[1]-a[1],vx=d[0]-a[0],vy=d[1]-a[1],det=ux*vy-uy*vx;
            const m0=((B[0]-A[0])*vy-(D[0]-A[0])*uy)/det;
            const m1=((B[1]-A[1])*vy-(D[1]-A[1])*uy)/det;
            const m2=((D[0]-A[0])*ux-(B[0]-A[0])*vx)/det;
            const m3=((D[1]-A[1])*ux-(B[1]-A[1])*vx)/det;
            const cx=(A[0]+B[0]+D[0])/3,cy=(A[1]+B[1]+D[1])/3;
            const expand=q=>{const dx=q[0]-cx,dy=q[1]-cy,r=Math.hypot(dx,dy);return [q[0]+dx/r*.7,q[1]+dy/r*.7];};
            output.save();output.beginPath();output.moveTo(...expand(A));output.lineTo(...expand(B));output.lineTo(...expand(D));output.closePath();output.clip();
            output.transform(m0,m1,m2,m3,A[0]-m0*a[0]-m2*a[1],A[1]-m1*a[0]-m3*a[1]);output.drawImage(this.panel,0,0);output.restore();
        };
        if(Math.abs(yaw)+Math.abs(pitch)<.0001) output.drawImage(this.panel,-600,-450);
        else for(let y=0;y<900;y+=150)for(let x=0;x<1200;x+=150){tri([x,y],[x+150,y],[x,y+150]);tri([x+150,y],[x+150,y+150],[x,y+150]);}
        output.restore();
    },
    dispose(api) { for(const key of ['mark','echo','warp','panel']) {if(this[key]) api.releaseSurface(this[key]);this[key]=null;} }
});
