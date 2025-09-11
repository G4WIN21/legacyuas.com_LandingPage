// sky.js — Real-time virtual sky with weather (Open-Meteo) + Sun/Moon/Stars
(() => {
  // ---------- Canvas bootstrap ----------
  let canvas = document.getElementById('skyCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'skyCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
  }
  const ctx = canvas.getContext('2d');

  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  function resize(){
    const w = innerWidth, h = innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    canvas.style.width = w+'px';
    canvas.style.height = h+'px';
  }
  addEventListener('resize', resize);
  resize();

  // ---------- Location ----------
  let lat = 32.0809, lon = -81.0912; // fallback: Savannah, GA
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(p => {
      lat = p.coords.latitude; lon = p.coords.longitude;
      fetchWeather(); // refresh with real location
    }, () => {});
  }

  // ---------- Weather state ----------
  const WX = {
    cloudCover: 7,     // %
    rainRate: 0,        // mm/h
    snowRate: 0,        // mm/h (water equiv)
    tempF: 75,
    windSpeed: 3,       // mph
    windDir: 180,       // degrees (direction FROM; convert to TO by +180)
    humidity: 60,       // %
    visibility: 20000,  // m
    wmo: 1,             // code
  };

  let lastFetch = 0;
  async function fetchWeather(){
    // Throttle to every 10 min
    if (Date.now() - lastFetch < 10*60*1000) return;
    lastFetch = Date.now();
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                  `&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto` +
                  `&hourly=cloudcover,precipitation,rain,snowfall,relativehumidity_2m,visibility,winddirection_10m,windspeed_10m,temperature_2m,weathercode`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();

      // Prefer current_weather + nearest hourly for details
      const cw = data.current_weather || {};
      const idx = data.hourly && data.hourly.time ? Math.max(0, data.hourly.time.findIndex(t => t.startsWith(cw.time?.slice(0,13)))) : 0;

      WX.cloudCover = pick(data.hourly?.cloudcover?.[idx],  cw.cloudcover, WX.cloudCover) ?? WX.cloudCover;
      WX.rainRate   = pick(data.hourly?.rain?.[idx],         0, WX.rainRate) ?? WX.rainRate;
      WX.snowRate   = pick(data.hourly?.snowfall?.[idx],     0, WX.snowRate) ?? WX.snowRate;
      WX.humidity   = pick(data.hourly?.relativehumidity_2m?.[idx], WX.humidity, WX.humidity);
      WX.visibility = pick(data.hourly?.visibility?.[idx],   WX.visibility, WX.visibility);
      WX.windDir    = pick(data.hourly?.winddirection_10m?.[idx], cw.winddirection, WX.windDir);
      WX.windSpeed  = pick(data.hourly?.windspeed_10m?.[idx], cw.windspeed, WX.windSpeed);
      WX.tempF      = pick(data.hourly?.temperature_2m?.[idx], cw.temperature, WX.tempF);
      WX.wmo        = pick(data.hourly?.weathercode?.[idx], cw.weathercode, WX.wmo);

    } catch (e) {
      console.warn('Weather fetch failed:', e);
    }
  }
  function pick(...vals){ return vals.find(v => typeof v === 'number' && !Number.isNaN(v)); }
  fetchWeather();
  setInterval(fetchWeather, 10*60*1000);

  // ---------- Day/Night (Sun/Moon/Stars) ----------
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const mix3 = (A,B,t)=>[A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t];
  const rgb = c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
  const smooth = (e0,e1,x)=>{ const t=clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); };

  // Stars
  const STAR_COUNT = innerWidth >= 900 ? 800 : 400;
  const stars = Array.from({length: STAR_COUNT}).map(() => ({
    x: Math.random(), y: Math.random()*0.7,
    r: Math.random()<.85 ? 1 : 1.5, a: Math.random()*.7+.3,
    t: Math.random()*2+.5, phi: Math.random()*Math.PI*2
  }));

  function drawStars(night){
    const t = Date.now()/1000;
    for (const s of stars){
      const tw = 0.5 + 0.5*Math.sin(t*s.t + s.phi);
      ctx.fillStyle = `rgba(255,255,255,${(night*s.a*tw).toFixed(3)})`;
      ctx.fillRect(s.x*canvas.width, s.y*canvas.height, s.r*dpr, s.r*dpr);
    }
  }
  function drawSun(x,y,r,str){
    const g = ctx.createRadialGradient(x,y,0, x,y,r);
    g.addColorStop(0, `rgba(255,255,220,${0.95*str})`);
    g.addColorStop(0.4, `rgba(255,200,80,${0.7*str})`);
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  function drawMoon(x,y,r,b){
    const g = ctx.createRadialGradient(x,y,0, x,y,r);
    g.addColorStop(0, `rgba(255,255,255,${0.6*b})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }

  // ---------- Weather visuals (clouds/precip/fog) ----------
  // Cloud "puffs" (lightweight noise-ish)
  const CLOUD_MAX = 120;
  const clouds = Array.from({length: CLOUD_MAX}).map(() => newCloud());
  function newCloud(){
    return {
      x: Math.random()*canvas.width,
      y: (0.1 + Math.random()*0.5)*canvas.height, // top 60%
      r: (60 + Math.random()*160) * dpr,
      a: 0,                 // alpha will be driven by cloud cover
      z: 0.5 + Math.random()*1.5, // layer speed multiplier
      seed: Math.random()*Math.PI*2
    };
  }

  // Rain & Snow particles
  const RAIN_MAX = 600, SNOW_MAX = 350;
  const raindrops = [];
  const snowflakes = [];
  function spawnRain(n){
    while (raindrops.length < n) {
      raindrops.push({
        x: Math.random()*canvas.width,
        y: Math.random()*-canvas.height,
        len: (8 + Math.random()*10)*dpr,
        life: 0
      });
    }
    if (raindrops.length > n) raindrops.length = n;
  }
  function spawnSnow(n){
    while (snowflakes.length < n) {
      const s = (Math.random()*1.3 + 0.4)*dpr;
      snowflakes.push({
        x: Math.random()*canvas.width,
        y: Math.random()*-canvas.height,
        r: s, sway: Math.random()*2*Math.PI, speed: 0.3 + Math.random()*0.7
      });
    }
    if (snowflakes.length > n) snowflakes.length = n;
  }

  // ---------- Main loop ----------
  function loop(){

    let last = performance.now();
    const target = 1000/30; // ~33.3ms
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
      
      const CLOUD_SPEED = 0.50; // 50% of current speed


      for (let i=0;i<CLOUD_MAX;i++){
        const c = clouds[i];

        // alpha smoothing independent of FPS
        const active = i < cloudTarget;
        const targetA = active ? (0.3 + 0.6*overcast) * (0.6 + 0.4*(1 - dayT)) : 0;
        c.a += (targetA - c.a) * Math.min(1, dt * 6); // was 0.02/frame

        // velocity (px/sec), gentle bob
        const speed = basePxPerSec * c.z* CLOUD_SPEED; // px/sec 
        const bob = Math.sin(t*0.25 + c.seed) * (2 * dpr); // small vertical wobble

        c.x += (speed * windX) * dt;                  // ✅ proper px/sec
        c.y += (speed * 0.2 * windY) * dt + bob * dt;

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


  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(loop); });
  requestAnimationFrame(loop);
})();
