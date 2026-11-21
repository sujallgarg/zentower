import { ThemeKey, MaterialType } from '../types';

export class ZenAudioEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private rainNode: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;

  constructor() {
    // Initialized on user interaction
  }

  public ensureContext(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(mute ? 0 : 0.035, this.ctx.currentTime, 0.1);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleRainAmbience(active: boolean): void {
    if (!active) {
      if (this.rainGain && this.ctx) {
        this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      }
      return;
    }
    this.ensureContext();
    if (!this.ctx) return;

    if (!this.rainNode) {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.18) * 0.5;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 0.6;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;

      source.connect(filter);
      filter.connect(this.rainGain);
      this.rainGain.connect(this.ctx.destination);
      source.start();
      this.rainNode = source;
    }

    if (!this.muted && this.rainGain) {
      this.rainGain.gain.setTargetAtTime(0.035, this.ctx.currentTime, 0.3);
    }
  }

  public playRotateTick(): void {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.03);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  /**
   * Positive Competence Micro-Feedback: Subtle rising harmonic pitch progression for blocks 1–5
   * C4 (261.63Hz) -> D4 (293.66Hz) -> E4 (329.63Hz) -> G4 (392.00Hz) -> A4 (440.00Hz)
   */
  public playCompetenceChime(step: number): void {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const pitches = [261.63, 293.66, 329.63, 392.00, 440.00];
    const freq = pitches[Math.max(0, Math.min(step - 1, pitches.length - 1))];
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.42);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.45);
  }

  public playCollision(intensity: number, themeKey: ThemeKey, materialType: MaterialType): void {
    if (this.muted || intensity < 0.08) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const vol = Math.min(0.32, intensity * 0.25);

    if (materialType === 'ice') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200 + Math.random() * 300, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.09);
      gain.gain.setValueAtTime(vol * 0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
      return;
    }

    if (themeKey === 'kyoto') {
      const baseFreq = 290 + Math.random() * 90;
      [1, 2.02].forEach((mult, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq * mult, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * mult * 0.96, now + 0.14);
        gain.gain.setValueAtTime(idx === 0 ? vol : vol * 0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.17);
      });
    } else if (themeKey === 'obsidian') {
      const baseFreq = 520 + Math.random() * 140;
      [1, 1.5, 2.75].forEach((mult, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(baseFreq * mult, now);
        gain.gain.setValueAtTime(vol / (idx + 1.4), now);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.32);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.34);
      });
    } else {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const startFreq = materialType === 'stone' ? 115 : 165 + Math.random() * 30;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.11);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  public playSplash(): void {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const length = Math.floor(this.ctx.sampleRate * 0.55);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.16));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  public playVictoryChime(): void {
    if (this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const now = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.085;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.58);
    });
  }
}

export const audioEngine = new ZenAudioEngine();
