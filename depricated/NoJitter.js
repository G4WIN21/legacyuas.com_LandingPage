let last = performance.now();
let t = 0; // seconds since start

function loop(now = performance.now()){
  const dt = Math.min((now - last) / 1000, 0.05); // seconds; clamp big jumps
  last = now;
  t += dt;

  const w = canvas.width, h = canvas.height;

  // ==== Day/night + gradient (UNCHANGED) ====
  let dayT = 0, sunX = null, sunY = null;
  if (window.SunCalc){
    const sun = SunCalc.getPosition(new Date(), lat, lon);
    const alt = sun.altitude, az = sun.azimuth + Math.PI;
    dayT = Math.max(0, Math.min(1, (alt + 0.15) / 1.2));
    const horizonY = h * 0.65;
    const r = Math.cos(alt) * (h * 0.45);
    sunX = w/2 + r * Math.sin(az);
    sunY = horizonY - (Math.sin(alt) * h * 0.5);
  } else {
    const nowHrs = new Date().getHours() + new Date().getMinutes()/60;
    dayT = Math.max(0, Math.min(1, Math.sin((nowHrs-6)/12*Math.PI)));
  }

  const overcast = WX.cloudCover/100;
  const dayTop=[20,60,130], dayBot=[90,170,255];
  const duskTop=[120,40,90], duskBot=[250,120,60];
  const nightTop=[8,10,20],  nightBot=[18,20,35];
  const smooth = (e0,e1,x)=>{ const tt=Math.max(0,Math.min(1,(x-e0)/(e1-e0))); return tt*tt*(3-2*tt); };
  const mix3 = (A,B,u)=>[A[0]+(B[0]-A[0])*u, A[1]+(B[1]-A[1])*u, A[2]+(B[2]-A[2])*u];
  const rgb = c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;

  const t1=smooth(0,0.25,dayT), t2=smooth(0.25,0.75,dayT);
  let top = mix3(mix3(nightTop,duskTop,t1), dayTop, t2);
  let bot = mix3(mix3(nightBot,duskBot,t1), dayBot, t2);
  // dim with cloud cover
  top = mix3(top, [top[0]*0.6, top[1]*0.6, top[2]*0.6], overcast*0.7);
  bot = mix3(bot, [bot[0]*0.6, bot[1]*0.6, bot[2]*0.6], overcast*0.7);

  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
  ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

  // Stars (fade with clouds)
  const night = (1 - dayT) * (1 - overcast*0.9);
  if (night > 0.05) {
    const STAR_COUNT = stars.length;
    const twT = Date.now()/1000;
    for (let i=0;i<STAR_COUNT;i++){
      const s = stars[i];
      const tw = 0.5 + 0.5*Math.sin(twT * s.t + s.phi);
      ctx.fillStyle = `rgba(255,255,255,${(night * s.a * tw).toFixed(3)})`;
      ctx.fillRect(s.x*canvas.width, s.y*canvas.height, s.r*dpr, s.r*dpr);
    }
  }

  // Sun/Moon (dim with overcast)
  if (window.SunCalc && sunX !== null){
    if (dayT > 0.02) drawSun(sunX, sunY, 60*dpr, dayT*(1 - overcast*0.85));
    const mpos = SunCalc.getMoonPosition(new Date(), lat, lon);
    const maz = mpos.azimuth + Math.PI, malt = mpos.altitude;
    const r2 = Math.cos(malt)*(h*0.45);
    const mx = w/2 + r2*Math.sin(maz);
    const my = h*0.65 - (Math.sin(malt)*h*0.5);
    const illum = SunCalc.getMoonIllumination(new Date()).phase;
    const bright = (1 - Math.abs(illum - 0.5)*2) * (1 - overcast*0.9);
    if (malt > -0.15) drawMoon(mx, my, 40*dpr, bright*(night+0.2));
  }

  // ==== Wind vector (TO direction) ====
  const windToDeg = (WX.windDir + 180) % 360;
  const ang = windToDeg * Math.PI / 180;
  const windX = Math.cos(ang);
  const windY = Math.sin(ang);

  // ==== Clouds (dt-based; smooth alpha; bobbing) ====
  const cloudTarget = Math.round((0.3 + 0.7*overcast) * CLOUD_MAX);

  // px/sec baseline cloud speed (tweakable)
  const basePxPerSec = (12 + 48*(WX.windSpeed/25));

  for (let i=0;i<CLOUD_MAX;i++){
    const c = clouds[i];

    // alpha smoothing independent of FPS
    const active = i < cloudTarget;
    const targetA = active ? (0.3 + 0.6*overcast) * (0.6 + 0.4*(1 - dayT)) : 0;
    c.a += (targetA - c.a) * Math.min(1, dt * 6); // was 0.02/frame

    // velocity (px/sec), gentle bob
    const speed = basePxPerSec * c.z;
    const bob = Math.sin(t*0.25 + c.seed) * (2 * dpr); // small vertical wobble

    c.x += (speed * windX) * dt * 60;           // scale to px/frame at ~60fps
    c.y += (speed * 0.2 * windY) * dt * 60 + bob * dt; // tiny wobble

    // wrap
    if (c.x < -c.r) c.x = w + c.r;
    if (c.x > w + c.r) c.x = -c.r;
    if (c.y < h*0.05) c.y = h*0.05;
    if (c.y > h*0.7)  c.y = h*0.7;

    // draw (soft blobs)
    if (c.a > 0.01){
      ctx.globalAlpha = c.a;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k=0;k<3;k++){
        const off = (k-1)*0.6*c.r;
        ctx.beginPath();
        ctx.ellipse(c.x + off*0.6, c.y + Math.sin(c.seed + k)*8*dpr, c.r*0.9, c.r*0.6, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ==== Precip (dt-based) ====
  const tempF = WX.tempF;
  const isSnow = (WX.snowRate > WX.rainRate && tempF <= 34) || [71,73,75,85,86].includes(WX.wmo);
  const rainIntensity = Math.max(0, Math.min(1, (isSnow ? 0 : WX.rainRate)/8));
  const snowIntensity = Math.max(0, Math.min(1, (isSnow ? WX.snowRate : 0)/5));

  // target counts
  spawnRain(Math.round(rainIntensity * RAIN_MAX));
  spawnSnow(Math.round(snowIntensity * SNOW_MAX));

  // rain
  if (raindrops.length){
    ctx.strokeStyle = 'rgba(200,200,255,0.6)';
    ctx.lineWidth = 1 * dpr;
    const speed = (400 + 600*rainIntensity) * dpr; // px/sec
    for (const r of raindrops){
      r.x += windX * WX.windSpeed * 0.8 * dpr * dt * 60;
      r.y += speed * dt;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - windX*4*dpr, r.y - r.len);
      ctx.stroke();
      if (r.y > h + 20*dpr || r.x < -20*dpr || r.x > w+20*dpr){
        r.x = Math.random()*w; r.y = Math.random()*-h; r.len = (8 + Math.random()*10)*dpr;
      }
    }
  }

  // snow
  if (snowflakes.length){
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const s of snowflakes){
      s.sway += (0.03 + Math.random()*0.02) * dt * 60;
      s.x += Math.cos(s.sway)*0.6*dpr * dt * 60 + windX*WX.windSpeed*0.25*dpr * dt * 60;
      s.y += (40 + 60*s.speed) * dpr * dt;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
      if (s.y > h + 10*dpr || s.x < -10*dpr || s.x > w+10*dpr){
        s.x = Math.random()*w; s.y = Math.random()*-h;
        s.r = (Math.random()*1.3 + 0.4)*dpr;
        s.speed = 0.3 + Math.random()*0.7;
      }
    }
  }

  // ==== Fog (unchanged, drawn after precip) ====
  const foggy = (WX.wmo===45 || WX.wmo===48) || (WX.visibility < 10000 && WX.humidity > 85 && WX.cloudCover > 60);
  const fogAlpha = foggy ? Math.max(0.1, Math.min(0.65, 1 - (WX.visibility/20000))) : 0;
  if (fogAlpha > 0.01){
    const fogG = ctx.createLinearGradient(0,0,0,h);
    fogG.addColorStop(0, `rgba(220,220,230,${fogAlpha*0.35})`);
    fogG.addColorStop(1, `rgba(220,220,230,${fogAlpha})`);
    ctx.fillStyle = fogG;
    ctx.fillRect(0,0,w,h);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
