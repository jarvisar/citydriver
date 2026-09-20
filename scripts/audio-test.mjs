import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts/audio', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline);
  assert.equal(await page.evaluate(() => window.__coastline.audio.context), null);
  // Sound is a pause-screen setting now; M still reaches it from the drive.
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__coastline.audio.context?.state === 'running');
  const graphSize = await page.evaluate(() => {
    const a = window.__coastline.audio;
    window.originalAudioContext = a.context;
    return [a.graph.nodeCount, a.graph.sourceCount];
  });
  await page.keyboard.down('KeyW');
  // The menu already cruises above 8 m/s; wait for pedal response as well.
  await page.waitForFunction(() => window.__coastline.vehicle.speed > 8 && window.__coastline.audio.state.load > .5);
  assert.ok(await page.evaluate(() => window.__coastline.audio.state.load > .5));
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.__coastline.audio.state.load < .1);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__coastline.audio.context.state === 'suspended');
  assert.equal(await page.evaluate(() => window.__coastline.audio.graph.master.value), 0);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__coastline.audio.context.state === 'running');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__coastline.audio.context.state === 'suspended');
  const rapid = await page.evaluate(async () => {
    const a = window.__coastline.audio;
    await Promise.all([a.toggle(), a.toggle(), a.toggle(), a.toggle()]);
    return { enabled: a.enabled, same: a.context === window.originalAudioContext };
  });
  assert.deepEqual(rapid, { enabled: false, same: true });
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__coastline.audio.context.state === 'running');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => window.__coastline.audio.context.state === 'suspended');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await page.evaluate(() => window.__coastline.audio.audible), false);
  await page.keyboard.press('KeyP');
  for (const journey of ['desert', 'snow', 'jungle', 'plains', 'city', 'coast']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), journey);
    assert.equal(await page.evaluate(() => window.__coastline.audio.journey), journey);
    assert.deepEqual(await page.evaluate(() => [window.__coastline.audio.graph.nodeCount, window.__coastline.audio.graph.sourceCount]), graphSize);
  }
  await page.keyboard.press('KeyP');

  // Mixer is reachable while paused, supports native keyboard sliders, and
  // persists without constructing an AudioContext on the following visit.
  await page.locator('#audio-mixer-toggle').click();
  await page.locator('[data-audio-preset="scenic"]').click();
  assert.equal(await page.evaluate(() => window.__coastline.audio.preset), 'scenic');
  await page.locator('#audio-engine').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#audio-engine').inputValue(), '43');
  assert.equal(await page.evaluate(() => window.__coastline.audio.mix.engine), .43);
  await page.evaluate(() => window.__coastline.action('menuPrevious'));
  assert.equal(await page.locator('#audio-engine').inputValue(), '38');
  assert.equal(await page.evaluate(() => window.__coastline.paused), true);
  await page.locator('#audio-mixer').screenshot({ path: '.artifacts/audio/mixer-desktop.png' });
  await page.locator('[data-audio-preset="balanced"]').click();

  // Render the real Web Audio graph, not mocks, to measure levels and retain
  // short WAV previews for listening. All presets use the same deterministic noise.
  const renders = await page.evaluate(async () => {
    const { DriveAudio } = await import('/src/audio.js');
    const { createSoundGraph } = await import('/src/audio/synthesis.js');
    const results = [];
    for (const journey of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city']) {
      const rate = 24000, seconds = 14;
      const ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const audio = new DriveAudio(); audio.context = ctx; audio.graph = createSoundGraph(ctx);
      audio.enabled = true; audio.setJourney(journey); audio.syncOutput();
      const drive = time => {
        const speed = time < 2 ? 0 : time < 8 ? (time - 2) * 4.5 : time < 10 ? 27 : Math.max(0, 27 - (time - 10) * 12);
        return { speed, throttle: time >= 2 && time < 8 ? 1 : 0, brake: time >= 10 ? 1 : 0, offRoad: time >= 8 && time < 10 ? 1 : 0, steer: time > 9 ? .8 : 0 };
      };
      audio.update(drive(0), 1 / 30, true);
      // Suspend offline rendering every 33 ms to schedule exactly the parameters
      // that the live update loop would produce at that audio-clock position.
      const steps = [];
      for (let time = 1 / 30; time < seconds - .1; time += 1 / 30) {
        steps.push(ctx.suspend(time).then(() => {
          audio.update(drive(ctx.currentTime), 1 / 30, true);
          if (ctx.currentTime >= 13) audio.graph.master.setTargetAtTime(0, ctx.currentTime, .065);
          return ctx.resume();
        }));
      }
      const buffer = await ctx.startRendering(); await Promise.all(steps);
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const stats = (start, end) => {
        let peak = 0, energy = 0, derivative = 0, count = 0;
        for (const channel of channels) for (let i = Math.floor(start * rate) + 1; i < end * rate; i++) {
          const value = channel[i]; peak = Math.max(peak, Math.abs(value)); energy += value * value;
          derivative += (value - channel[i - 1]) ** 2; count++;
        }
        return { peak, rms: Math.sqrt(energy / count), brightness: energy ? Math.sqrt(derivative / energy) : 0 };
      };
      const bytes = new Uint8Array(buffer.length * 4), view = new DataView(bytes.buffer);
      for (let i = 0; i < buffer.length; i++) for (let ch = 0; ch < 2; ch++) view.setInt16((i * 2 + ch) * 2, Math.round(Math.max(-1, Math.min(1, channels[ch][i])) * 32767), true);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      results.push({ journey, rate, overall: stats(0, seconds), idle: stats(.8, 2), drive: stats(5, 8), muted: stats(13.8, 14), pcm: btoa(binary) });
      audio.graph.dispose();
    }
    return results;
  });
  const report = [];
  await writeFile('.artifacts/audio/latest-render-levels.json', JSON.stringify(renders.map(({ pcm, ...result }) => result), null, 2));
  for (const { pcm, ...result } of renders) {
    assert.ok(result.overall.peak < .85 && result.overall.peak > .02, `${result.journey}: headroom`);
    assert.ok(result.overall.rms > .008 && result.overall.rms < .2, `${result.journey}: audible and restrained`);
    assert.ok(result.drive.rms > result.idle.rms * 1.15, `${result.journey}: driving responds`);
    assert.ok(result.muted.peak < .0001, `${result.journey}: clean fade to silence`);
    const data = Buffer.from(pcm, 'base64'), header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
    header.writeUInt32LE(result.rate, 24); header.writeUInt32LE(result.rate * 4, 28);
    header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
    await writeFile(`.artifacts/audio/${result.journey}-drive.wav`, Buffer.concat([header, data])); report.push(result);
  }
  assert.ok(report[0].idle.rms > report[1].idle.rms * 1.05, 'coast has a fuller surf bed');
  assert.notEqual(report[1].idle.brightness.toFixed(3), report[2].idle.brightness.toFixed(3), 'inland presets differ in timbre');
  const features = await page.evaluate(async () => {
    const { DriveAudio } = await import('/src/audio.js');
    const { createSoundGraph } = await import('/src/audio/synthesis.js');
    const { ENGINES } = await import('/src/audio/profiles.js');
    const results = [];
    for (const kind of ['pickup', 'sports', 'formula', 'music', 'silence', 'traffic', 'maximum', 'night']) {
      const rate = 24000, ctx = new OfflineAudioContext(2, rate * 3, rate);
      const audio = new DriveAudio(); audio.context = ctx; audio.graph = createSoundGraph(ctx); audio.enabled = true;
      const g = audio.graph;
      audio.setJourney('city'); audio.setCar(ENGINES[kind] ? kind : 'sports');
      audio.mix = { master: 1, engine: 0, road: 0, ambience: 0, traffic: 0, music: 0, night: kind === 'night' };
      if (ENGINES[kind]) audio.mix.engine = 1;
      else if (['music', 'traffic'].includes(kind)) audio.mix[kind] = 1;
      else if (kind === 'maximum' || kind === 'night') for (const name of ['engine', 'road', 'ambience', 'traffic', 'music']) audio.mix[name] = 1;
      audio.syncOutput();
      for (let step = 0; step < 120; step++) audio.update({ speed: kind === 'formula' ? 50 : 27, throttle: 1, steer: 1, brake: .2 }, 1 / 60, true);
      if (['maximum', 'night', 'traffic'].includes(kind)) for (let i = 0; i < g.traffic.length; i++) {
        audio.target(g.traffic[i].level, 1); audio.target(g.traffic[i].pan, (i - 1.5) / 2);
      }
      if (kind === 'maximum' || kind === 'night') {
        g.event('road', { time: .6, duration: .3, level: .3, frequency: 240, endFrequency: 65 });
        g.event('weather', { time: .6, duration: 2, level: .12, frequency: 140, endFrequency: 65 });
      }
      const buffer = await ctx.startRendering();
      let energy = 0, peak = 0, count = 0;
      for (let channel = 0; channel < 2; channel++) for (const sample of buffer.getChannelData(channel).subarray(rate / 2)) {
        if (!Number.isFinite(sample)) throw new Error(`${kind}: invalid sample`);
        energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); count++;
      }
      results.push({ kind, peak, rms: Math.sqrt(energy / count), nodes: g.nodeCount, sources: g.sourceCount });
      g.dispose();
    }
    return results;
  });
  for (const result of features) {
    assert.ok(result.peak < .95, `${result.kind}: headroom at full volume`);
    assert.ok(result.kind === 'silence' ? result.peak < .000001 : result.rms > .002, `${result.kind}: independent mixer channel`);
    assert.deepEqual([result.nodes, result.sources], graphSize, `${result.kind}: bounded graph`);
  }
  assert.ok(features.find(r => r.kind === 'night').rms < features.find(r => r.kind === 'maximum').rms * .8, 'night compression reduces the full mix');
  const disposed = await page.evaluate(async () => {
    const a = window.__coastline.audio, ctx = a.context;
    await a.dispose(); await a.dispose();
    return { state: ctx.state, graph: a.graph, enabled: a.enabled };
  });
  assert.deepEqual(disposed, { state: 'closed', graph: null, enabled: false });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await mobile.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  // A touchscreen reaches sound through the pause screen, which is also the
  // one place it can be switched on without the drive running.
  await mobile.locator('#start').tap();
  await mobile.locator('#pause').tap();
  await mobile.locator('#audio-mixer-toggle').tap();
  await mobile.locator('[data-audio-preset="night"]').tap();
  assert.equal(await mobile.evaluate(() => window.__coastline.audio.preset), 'night');
  await mobile.locator('#audio-mixer').screenshot({ path: '.artifacts/audio/mixer-mobile.png' });
  await mobile.locator('#audio-mixer-toggle').tap();
  await mobile.locator('#sound').tap();
  await mobile.waitForFunction(() => window.__coastline.audio.context);
  assert.equal(await mobile.locator('#sound').getAttribute('aria-pressed'), 'true');
  await mobile.locator('#resume').tap();
  await mobile.waitForFunction(() => window.__coastline.audio.context.state === 'running');
  await mobile.locator('#pause').tap();
  await mobile.waitForFunction(() => window.__coastline.audio.context.state === 'suspended');
  await mobile.locator('#sound').tap();
  await mobile.locator('#sound').tap();
  assert.equal(await mobile.locator('#sound').getAttribute('aria-pressed'), 'true');
  assert.equal(await mobile.evaluate(() => window.__coastline.audio.context.state), 'suspended');
  await mobile.locator('#resume').tap();
  await mobile.waitForFunction(() => window.__coastline.audio.context.state === 'running');
  await mobile.reload();
  await mobile.waitForFunction(() => window.__coastline);
  assert.equal(await mobile.evaluate(() => window.__coastline.audio.preset), 'night');
  assert.equal(await mobile.evaluate(() => window.__coastline.audio.context), null);
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/audio/report.json', JSON.stringify({ graphSize, renders: report, features, errors }, null, 2));
  console.log(JSON.stringify({ graphSize, renders: report, features, errors }, null, 2));
} finally { await browser.close(); }
