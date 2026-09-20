import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Keep a reproducible listening comparison outside the shipped application.
// Choose an older implementation with AUDIO_BASE_REF; HEAD is the default
// during development. Both versions receive the same telemetry and RMS gain.
const root = '.artifacts/audio/review';
await mkdir(`${root}/legacy/audio`, { recursive: true });
const ref = process.env.AUDIO_BASE_REF || 'HEAD';
for (const file of ['audio.js', 'audio/model.js', 'audio/synthesis.js']) {
  const source = execFileSync('git', ['show', `${ref}:src/${file}`], { encoding: 'utf8' });
  await writeFile(`${root}/legacy/${file}`, source);
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const renders = await page.evaluate(async () => {
    const results = [];
    const cases = [
      { id: 'engine', journey: 'coast', solo: 'engine' },
      { id: 'drive', journey: 'coast' },
      { id: 'surf', journey: 'coast', solo: 'ambience' },
      { id: 'rain', journey: 'city', solo: 'ambience' },
      { id: 'radio', journey: 'plains', solo: 'music', afterOnly: true },
    ];
    for (const item of cases) for (const version of item.afterOnly ? ['after'] : ['before', 'after']) {
      const path = version === 'before' ? '/.artifacts/audio/review/legacy' : '/src';
      const { DriveAudio } = await import(`${path}/audio.js`);
      const { createSoundGraph } = await import(`${path}/audio/synthesis.js`);
      const rate = 24000, seconds = 18, ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const audio = new DriveAudio(); audio.context = ctx; audio.graph = createSoundGraph(ctx); audio.enabled = true;
      if (audio.mix) audio.mix = { master: .72, engine: .8, road: .7, ambience: .85, traffic: .65, music: item.solo === 'music' ? .7 : 0, night: false };
      audio.setJourney(item.journey); audio.syncOutput();
      // Keep both comparisons focused on the original layers. Wildlife and
      // new traffic do not get to win this comparison by adding more detail.
      if (audio.director && item.solo !== 'music') audio.director.update = () => {};
      const tick = () => {
        const t = ctx.currentTime;
        const speed = t < 2 ? 0 : t < 9 ? (t - 2) * 4 : t < 12 ? 28 : t < 15 ? Math.max(0, 28 - (t - 12) * 10) : -Math.min(5, (t - 15) * 3);
        audio.update({ speed, throttle: t > 2 && t < 9 || t >= 15 ? 1 : 0, brake: t >= 12 && t < 15 ? 1 : 0, offRoad: t >= 10 && t < 12 ? 1 : 0 }, 1 / 30, true);
        if (item.solo) {
          const g = audio.graph;
          const mute = param => { param.cancelScheduledValues(t); param.setValueAtTime(0, t); };
          if (g.buses) for (const [channel, param] of Object.entries(g.buses)) { if (channel !== item.solo) mute(param); }
          else if (item.solo === 'engine') for (const name of ['road', 'rough', 'wind', 'bed', 'air']) { mute(g[name].level); if (name === 'rough') mute(g.roughPulse); }
          else if (item.solo === 'ambience') { for (const name of ['engineLevel', 'bodyLevel', 'roughPulse']) mute(g[name]); for (const name of ['combustion', 'road', 'rough', 'wind']) mute(g[name].level); }
        }
        if (t > 17) audio.graph.master.setTargetAtTime(0, t, .12);
      };
      tick();
      const steps = [];
      for (let t = 1 / 30; t < seconds - .05; t += 1 / 30) steps.push(ctx.suspend(t).then(() => { tick(); return ctx.resume(); }));
      const buffer = await ctx.startRendering(); await Promise.all(steps);
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      let energy = 0, peak = 0;
      for (const channel of channels) for (const value of channel) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
      const rms = Math.sqrt(energy / (buffer.length * 2)), gain = Math.min(.045 / Math.max(.00001, rms), .9 / Math.max(.00001, peak));
      const bytes = new Uint8Array(buffer.length * 4), view = new DataView(bytes.buffer);
      for (let i = 0; i < buffer.length; i++) for (let ch = 0; ch < 2; ch++) view.setInt16((i * 2 + ch) * 2, Math.round(channels[ch][i] * gain * 32767), true);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      results.push({ id: item.id, version, rate, rms, peak, gain, pcm: btoa(binary) });
      audio.graph.dispose();
    }
    return results;
  });
  for (const result of renders) {
    const data = Buffer.from(result.pcm, 'base64'), header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(result.rate, 24); header.writeUInt32LE(result.rate * 4, 28);
    header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
    await writeFile(`${root}/${result.id}-${result.version}.wav`, Buffer.concat([header, data]));
    delete result.pcm;
  }
  await writeFile(`${root}/levels.json`, JSON.stringify(renders, null, 2));
  const labels = { engine: 'Engine', drive: 'Driving', surf: 'Ocean', rain: 'Rain', radio: 'Music' };
  const sections = Object.entries(labels).map(([id, label]) => `<section><h2>${label}</h2>${renders.filter(r => r.id === id).map(r => `<article><label for="${id}-${r.version}">${r.version === 'before' ? 'Before' : 'After'}</label><audio id="${id}-${r.version}" controls preload="none" src="${id}-${r.version}.wav"></audio></article>`).join('')}</section>`).join('');
  await writeFile(`${root}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Audio comparison</title>
    <style>body{font:16px system-ui;background:#edf0e6;color:#25473e;max-width:820px;margin:40px auto;padding:0 20px}h1{font-weight:500}p{line-height:1.6}section{border-top:1px solid #bccbbf;padding:20px 0}h2{font-size:19px}article{display:inline-flex;flex-direction:column;gap:10px;margin:0 15px 15px 0}audio{max-width:100%}</style>
    <h1>Audio comparison</h1><p>Same driving inputs, matched volume. New wildlife and traffic are excluded.</p>
    ${sections}<script>document.addEventListener('play',event=>{for(const player of document.querySelectorAll('audio'))if(player!==event.target)player.pause()},true)</script></html>`);
  console.log(`Listening comparisons: ${root}/index.html`);
  console.log(JSON.stringify(renders, null, 2));
} finally { await browser.close(); }
