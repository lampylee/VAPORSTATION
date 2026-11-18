// Audio input: live device (via getUserMedia) or a file (test mode).
// Both feed the same path:  source -> [channel pick] -> inputGain -> AnalyserNode
// Files are additionally sent to the speakers; live input never is (no feedback).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mode = 'none';        // 'none' | 'live' | 'file'
    this.stream = null;
    this.liveSource = null;
    this.fileEl = null;
    this.fileSource = null;
    this.routed = null;        // { src, node } currently feeding the analysis path
    this.channel = 'both';
    this.deviceLabel = '';
  }

  _ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.inputGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0; // we smooth ourselves, per band
    this.inputGain.connect(this.analyser);
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get needsResume() { return !!this.ctx && this.ctx.state !== 'running' && this.mode !== 'none'; }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }

  setGainDb(db) {
    this._ensure();
    this.inputGain.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.03);
  }

  async listInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  _unroute() {
    if (!this.routed) return;
    try { this.routed.src.disconnect(this.routed.node); } catch (e) { /* already gone */ }
    if (this.routed.splitter) { try { this.routed.splitter.disconnect(); } catch (e) { /* ignore */ } }
    this.routed = null;
  }

  _route(src) {
    this._unroute();
    if (this.channel === 'both') {
      src.connect(this.inputGain);
      this.routed = { src, node: this.inputGain };
    } else {
      const splitter = this.ctx.createChannelSplitter(2);
      src.connect(splitter);
      // mono sources only have output 0
      const idx = this.channel === 'right' && src.channelCount > 1 ? 1 : 0;
      splitter.connect(this.inputGain, idx);
      this.routed = { src, node: splitter, splitter };
    }
  }

  setChannel(channel) {
    this.channel = channel;
    if (this.routed) this._route(this.routed.src);
  }

  /** Start live input. Returns { deviceId, label } of the device actually opened. */
  async startLive(deviceId) {
    this._ensure();
    this.stopLive();
    if (this.fileEl) this.fileEl.pause();
    const audio = {
      // A line-level music feed: turn off all the voice-call processing.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      latency: { ideal: 0 },
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio });
    } catch (e) {
      if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        console.warn('Saved device not found, falling back to default input.');
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } else throw e;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    this.deviceLabel = track.label || '';
    this.liveSource = this.ctx.createMediaStreamSource(stream);
    this._route(this.liveSource);
    this.mode = 'live';
    track.addEventListener('ended', () => { if (this.mode === 'live') this.mode = 'none'; });
    return { deviceId: settings.deviceId || deviceId || '', label: this.deviceLabel, settings };
  }

  stopLive() {
    if (this.liveSource) { if (this.routed?.src === this.liveSource) this._unroute(); this.liveSource.disconnect(); this.liveSource = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.mode === 'live') this.mode = 'none';
  }

  /** Attach the page's <audio> element used for file test mode. */
  attachPlayer(el) { this.fileEl = el; }

  /** Play a File or URL through the analysis path (and the speakers). */
  async playFile(fileOrUrl) {
    this._ensure();
    this.stopLive();
    const el = this.fileEl;
    if (!this.fileSource) {
      this.fileSource = this.ctx.createMediaElementSource(el);
      this.fileSource.connect(this.ctx.destination);
    }
    if (el.dataset.objUrl) { URL.revokeObjectURL(el.dataset.objUrl); delete el.dataset.objUrl; }
    if (typeof fileOrUrl === 'string') el.src = fileOrUrl;
    else { const u = URL.createObjectURL(fileOrUrl); el.dataset.objUrl = u; el.src = u; }
    this._route(this.fileSource);
    this.mode = 'file';
    await this.resume();
    await el.play();
  }
}
