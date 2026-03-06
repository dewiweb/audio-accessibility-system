const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const os = require('os');
const config = require('./config');
const channelManager = require('./channelManager');

function writeSinePCM(stdinStream, frequency, sampleRate, onStop) {
  const channels = 2;
  const bytesPerSample = 2;
  const chunkMs = 20;
  const samplesPerChunk = Math.floor(sampleRate * chunkMs / 1000);
  const bufSize = samplesPerChunk * channels * bytesPerSample;
  let phase = 0;
  const phaseInc = (2 * Math.PI * (frequency || 0)) / sampleRate;
  let running = true;
  let timer = null;

  const write = () => {
    if (!running) return;
    const buf = Buffer.alloc(bufSize);
    if (frequency > 0) {
      for (let i = 0; i < samplesPerChunk; i++) {
        const sample = Math.round(Math.sin(phase) * 0x6FFF);
        buf.writeInt16LE(sample, i * channels * bytesPerSample);
        buf.writeInt16LE(sample, i * channels * bytesPerSample + bytesPerSample);
        phase += phaseInc;
        if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      }
    }
    if (stdinStream.writable) {
      stdinStream.write(buf, () => {
        if (running) timer = setTimeout(write, chunkMs);
      });
    } else {
      running = false;
    }
  };

  stdinStream.on('error', () => { running = false; });
  stdinStream.on('close', () => { running = false; });
  timer = setTimeout(write, 0);

  return () => {
    running = false;
    if (timer) clearTimeout(timer);
  };
}

class StreamManager extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(config.paths.hlsOutput)) {
      fs.mkdirSync(config.paths.hlsOutput, { recursive: true });
    }
  }

  getChannelOutputDir(channelId) {
    const dir = path.join(config.paths.hlsOutput, channelId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async startStream(channelId, source) {
    if (this.activeStreams.has(channelId)) {
      this.stopStream(channelId);
    }

    if (source.type === 'testtone' || source.type === 'silence') {
      return this._startSineStream(channelId, source);
    }

    // Mode WebRTC low-latency : FFmpeg → libopus → RTSP → MediaMTX → WHEP navigateur.
    // WebRTC est le défaut pour AES67 (latence ~100ms vs ~3-4s HLS).
    // Forcer streamMode='hls' dans la source pour revenir au mode HLS si besoin.
    if (source.type === 'aes67' && source.streamMode !== 'hls') {
      return this._startWhipStream(channelId, source);
    }

    const outputDir = this.getChannelOutputDir(channelId);
    const playlistPath = path.join(outputDir, 'stream.m3u8');
    const sourceConfig = this._resolveSource(source);

    const isFileSource = source.type === 'file';
    const isLoopFile = isFileSource && source.loop === true;

    // Sources live (AES67, ALSA…) : fenêtre glissante, delete_segments.
    // Sources fichier non-loop : VOD complet (EXT-X-ENDLIST), segments conservés.
    // Sources fichier loop : voir _startLoopFileStream() ci-dessous — architecture séparée.
    if (isLoopFile) {
      return this._startLoopFileStream(channelId, source, sourceConfig, outputDir);
    }

    const outputOptions = isFileSource ? [
      '-f hls',
      `-hls_time ${config.audio.hlsSegmentDuration}`,
      '-hls_list_size 0',
      '-hls_playlist_type vod',
      '-hls_flags independent_segments',
      '-hls_segment_type mpegts',
      `-hls_segment_filename ${path.join(outputDir, 'seg%05d.ts')}`,
      '-hls_allow_cache 1',
    ] : [
      '-f hls',
      `-hls_time ${config.audio.hlsSegmentDuration}`,
      `-hls_list_size ${config.audio.hlsListSize}`,
      '-hls_flags delete_segments+append_list+independent_segments',
      '-hls_segment_type mpegts',
      `-hls_segment_filename ${path.join(outputDir, 'seg%05d.ts')}`,
      '-hls_allow_cache 0',
      '-movflags +faststart',
    ];

    // Construction de la chaîne de filtres audio
    const audioFilters = [];

    // 1. Sélection de paire stéréo dans un flux multicanal (ex: canaux 3+4 d'un flux 8ch)
    // source.channelMap = [3, 4]  — index 1-basés, comme sur la console
    if (source.channelMap && source.channelMap.length === 2) {
      const [l, r] = source.channelMap.map(n => n - 1);
      audioFilters.push(`pan=stereo|c0=c${l}|c1=c${r}`);
    }

    // 2. Downmix multicanal → stéréo (5.1, 7.1, etc.)
    // source.downmix = 'stereo'       — downmix ITU-R BS.775 natif FFmpeg
    // source.downmix = 'stereo-loud'  — mix renforcé (LFE + surround) pour malentendants
    // source.downmix = 'binaural'     — HRTF binaurale pour casque (3D immersif)
    if (source.downmix && !source.channelMap) {
      switch (source.downmix) {
        case 'stereo':
          // Downmix standard ITU-R BS.775 — laisse FFmpeg calculer les coefficients
          audioFilters.push('aformat=channel_layouts=stereo');
          break;
        case 'stereo-loud':
          // Mix renforcé pour malentendants : L+C*0.7+Ls*0.5+LFE*0.7 / R+C*0.7+Rs*0.5+LFE*0.7
          audioFilters.push(
            'pan=stereo|' +
            'c0=0.65*c0+0.45*c2+0.45*c4+0.55*c6|' +
            'c1=0.65*c1+0.45*c2+0.45*c5+0.55*c6'
          );
          break;
        case 'binaural':
          // Rendu binaural HRTF via filtre headphone (intégré FFmpeg, pas besoin de SOFA)
          audioFilters.push('headphone=hrir=compensated:type=time');
          break;
        case 'mono-to-stereo':
          // Flux mono (voix audiodescription) → dupliqué L+R
          audioFilters.push('pan=stereo|c0=c0|c1=c0');
          break;
      }
    }

    // 3. Gain (volume) — utile pour l'audiodescription où la voix doit dominer
    // source.gain = valeur en dB, ex: +6, -3, 0 (défaut)
    if (source.gain && source.gain !== 0) {
      audioFilters.push(`volume=${source.gain}dB`);
    }

    if (audioFilters.length > 0) {
      outputOptions.push(`-af ${audioFilters.join(',')}`);
    }

    const proc = ffmpeg(sourceConfig.input)
      .inputOptions(sourceConfig.inputOptions)
      .audioCodec('aac')
      .audioBitrate(config.audio.bitrate)
      .audioFrequency(config.audio.sampleRate)
      .audioChannels(2)
      .outputOptions(outputOptions)
      .output(playlistPath)
      .on('start', (cmd) => {
        console.log(`[Stream ${channelId}] Started: ${cmd}`);
        channelManager.setActive(channelId, true);
        this.emit('stream:started', { channelId });
      })
      .on('error', (err) => {
        console.error(`[Stream ${channelId}] Error:`, err.message);
        this.activeStreams.delete(channelId);
        channelManager.setActive(channelId, false);
        this.emit('stream:error', { channelId, error: err.message });
      })
      .on('end', () => {
        if (isFileSource) {
          // Mode VOD non-loop : FFmpeg a terminé, playlist complète avec EXT-X-ENDLIST.
          console.log(`[Stream ${channelId}] Encoding complete (VOD ready)`);
          const stream = this.activeStreams.get(channelId);
          if (stream) stream.proc = null;
          this.emit('stream:vod_ended', { channelId });
        } else {
          console.log(`[Stream ${channelId}] Ended`);
          this.activeStreams.delete(channelId);
          channelManager.setActive(channelId, false);
          this.emit('stream:ended', { channelId });
        }
      });

    proc.run();

    this.activeStreams.set(channelId, {
      proc,
      source,
      startedAt: new Date().toISOString(),
      tempSdp: sourceConfig.tempSdp || null,
      sineStream: null,
      stopSine: null,
      cleanupInterval: null,
    });

    return { channelId, playlistUrl: `/hls/${channelId}/stream.m3u8` };
  }

  _getFileDuration(filePath) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, meta) => {
        if (err || !meta?.format?.duration) return resolve(null);
        resolve(parseFloat(meta.format.duration));
      });
    });
  }

  async _startLoopFileStream(channelId, source, sourceConfig, outputDir) {
    // Boucle infinie via stream_loop -1 + HLS live (fenêtre glissante, delete_segments).
    // FFmpeg relit le fichier indéfiniment → pas de EXT-X-ENDLIST → HLS.js en mode live.
    // stream:started émis dès le premier segment disponible après le démarrage.
    // Pas de pré-encodage, pas d'attente : le stream démarre immédiatement.

    const playlistPath = path.join(outputDir, 'stream.m3u8');

    const audioFilters = [];
    if (source.channelMap && source.channelMap.length === 2) {
      const [l, r] = source.channelMap.map(n => n - 1);
      audioFilters.push(`pan=stereo|c0=c${l}|c1=c${r}`);
    }
    if (source.downmix && !source.channelMap) {
      switch (source.downmix) {
        case 'stereo':         audioFilters.push('aformat=channel_layouts=stereo'); break;
        case 'stereo-loud':    audioFilters.push('pan=stereo|c0=0.65*c0+0.45*c2+0.45*c4+0.55*c6|c1=0.65*c1+0.45*c2+0.45*c5+0.55*c6'); break;
        case 'binaural':       audioFilters.push('headphone=hrir=compensated:type=time'); break;
        case 'mono-to-stereo': audioFilters.push('pan=stereo|c0=c0|c1=c0'); break;
      }
    }
    if (source.gain && source.gain !== 0) audioFilters.push(`volume=${source.gain}dB`);

    // Durée de segment adaptée à la durée du fichier :
    //   segment ≤ fileDuration/2 pour éviter les discontinuités à la jointure de boucle,
    //   minimum 2s, maximum 4s, fenêtre totale = 6 segments (min 12s, max 24s).
    const fileDuration = await this._getFileDuration(sourceConfig.input);
    let LOOP_SEGMENT_DURATION = 4;
    if (fileDuration !== null) {
      LOOP_SEGMENT_DURATION = Math.max(2, Math.min(4, Math.floor(fileDuration / 2)));
      console.log(`[Stream ${channelId}] File duration: ${fileDuration.toFixed(1)}s → hls_time: ${LOOP_SEGMENT_DURATION}s`);
    }
    const LOOP_LIST_SIZE = 6;

    const outputOptions = [
      '-f hls',
      `-hls_time ${LOOP_SEGMENT_DURATION}`,
      `-hls_list_size ${LOOP_LIST_SIZE}`,
      '-hls_flags delete_segments+append_list+independent_segments',
      '-hls_segment_type mpegts',
      `-hls_segment_filename ${path.join(outputDir, 'seg%05d.ts')}`,
      '-hls_allow_cache 0',
    ];
    if (audioFilters.length > 0) outputOptions.push(`-af ${audioFilters.join(',')}`);

    const proc = ffmpeg(sourceConfig.input)
      .inputOptions(['-stream_loop -1', ...(sourceConfig.inputOptions || [])])
      .audioCodec('aac')
      .audioBitrate(config.audio.bitrate)
      .audioFrequency(config.audio.sampleRate)
      .audioChannels(2)
      .outputOptions(outputOptions)
      .output(playlistPath)
      .on('start', (cmd) => {
        console.log(`[Stream ${channelId}] Loop live: ${cmd}`);
        channelManager.setActive(channelId, true);
        this.emit('stream:started', { channelId });
      })
      .on('error', (err) => {
        console.error(`[Stream ${channelId}] Loop error:`, err.message);
        this.activeStreams.delete(channelId);
        channelManager.setActive(channelId, false);
        this.emit('stream:error', { channelId, error: err.message });
      })
      .on('end', () => {
        console.log(`[Stream ${channelId}] Loop ended unexpectedly`);
        this.activeStreams.delete(channelId);
        channelManager.setActive(channelId, false);
        this.emit('stream:ended', { channelId });
      });

    proc.run();

    this.activeStreams.set(channelId, {
      proc,
      source,
      startedAt: new Date().toISOString(),
      tempSdp: null,
      sineStream: null,
      stopSine: null,
      cleanupInterval: null,
    });

    return { channelId, playlistUrl: `/hls/${channelId}/stream.m3u8` };
  }

  _startSineStream(channelId, source) {
    const outputDir = this.getChannelOutputDir(channelId);
    const sampleRate = config.audio.sampleRate;
    const frequency = source.frequency || 440;
    const ffmpegPath = config.audio.ffmpegPath || 'ffmpeg';

    const args = [
      '-f', 's16le', '-ar', String(sampleRate), '-ac', '2', '-i', 'pipe:0',
      '-y',
      '-acodec', 'aac', '-b:a', config.audio.bitrate, '-ar', String(sampleRate), '-ac', '2',
      '-f', 'hls',
      '-hls_time', String(config.audio.hlsSegmentDuration),
      '-hls_list_size', String(config.audio.hlsListSize),
      '-hls_flags', 'delete_segments+append_list+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', path.join(outputDir, 'seg%05d.ts'),
      '-hls_allow_cache', '0',
      path.join(outputDir, 'stream.m3u8'),
    ];

    console.log(`[Stream ${channelId}] Spawn: ${ffmpegPath} ${args.join(' ')}`);

    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stderr.on('data', (d) => {
      process.stdout.write(`[FFmpeg ${channelId.slice(0,8)}] ${d.toString()}`);
    });

    const stopSine = writeSinePCM(proc.stdin, frequency, sampleRate);

    proc.on('spawn', () => {
      console.log(`[Stream ${channelId}] Sine stream spawned`);
      channelManager.setActive(channelId, true);
      this.emit('stream:started', { channelId });
    });

    proc.on('error', (err) => {
      console.error(`[Stream ${channelId}] Spawn error:`, err.message);
      stopSine();
      this.activeStreams.delete(channelId);
      channelManager.setActive(channelId, false);
      this.emit('stream:error', { channelId, error: err.message });
    });

    proc.on('close', (code) => {
      console.log(`[Stream ${channelId}] Sine process closed (code ${code})`);
      stopSine();
      this.activeStreams.delete(channelId);
      channelManager.setActive(channelId, false);
      this.emit('stream:ended', { channelId });
    });

    this.activeStreams.set(channelId, {
      proc: { kill: (sig) => proc.kill(sig) },
      source,
      startedAt: new Date().toISOString(),
      tempSdp: null,
      sineStream: null,
      stopSine,
    });

    return { channelId, playlistUrl: `/hls/${channelId}/stream.m3u8` };
  }

  _startWhipStream(channelId, source) {
    const sourceConfig = this._resolveSource(source);
    // RTSP vers MediaMTX (plus fiable que WHIP : pas de DTLS FFmpeg↔MediaMTX)
    // MediaMTX redistribue ensuite en WHEP vers les navigateurs
    const rtspBase = (config.audio.mediamtxUrl || 'http://127.0.0.1:8889')
      .replace(/^http:/, 'rtsp:').replace(/^https:/, 'rtsps:').replace(/:8889$/, ':8554');
    const rtspUrl = `${rtspBase}/${channelId}`;

    // Filtres audio identiques au mode HLS
    const audioFilters = [];
    if (source.channelMap && source.channelMap.length === 2) {
      const [l, r] = source.channelMap.map(n => n - 1);
      audioFilters.push(`pan=stereo|c0=c${l}|c1=c${r}`);
    }
    if (source.downmix && !source.channelMap) {
      switch (source.downmix) {
        case 'stereo':       audioFilters.push('aformat=channel_layouts=stereo'); break;
        case 'stereo-loud':  audioFilters.push('pan=stereo|c0=0.65*c0+0.45*c2+0.45*c4+0.55*c6|c1=0.65*c1+0.45*c2+0.45*c5+0.55*c6'); break;
        case 'binaural':     audioFilters.push('headphone=hrir=compensated:type=time'); break;
        case 'mono-to-stereo': audioFilters.push('pan=stereo|c0=c0|c1=c0'); break;
      }
    }
    if (source.gain && source.gain !== 0) audioFilters.push(`volume=${source.gain}dB`);

    // FFmpeg publie en RTSP vers MediaMTX (TCP, opus audio only)
    const args = [
      ...sourceConfig.inputOptions.flatMap(o => o.trim().split(/\s+/)),
      '-i', sourceConfig.input,
    ];
    if (audioFilters.length > 0) args.push('-af', audioFilters.join(','));
    args.push(
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ac', '2',
      '-ar', String(config.audio.sampleRate),
      '-application', 'lowdelay',
      '-frame_duration', '20',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      rtspUrl,
    );

    console.log(`[Stream ${channelId}] WebRTC mode → RTSP→MediaMTX → ${rtspUrl}`);
    const proc = spawn(config.audio.ffmpegPath || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', () => {});
    proc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) console.log(`[Stream ${channelId}] ${line}`);
    });

    proc.once('spawn', () => {
      channelManager.setActive(channelId, true);
      this.emit('stream:started', { channelId, mode: 'webrtc' });
      console.log(`[Stream ${channelId}] RTSP→MediaMTX stream started (pid ${proc.pid})`);
    });

    proc.once('error', err => {
      console.error(`[Stream ${channelId}] RTSP error:`, err.message);
      this.activeStreams.delete(channelId);
      channelManager.setActive(channelId, false);
      this.emit('stream:error', { channelId, error: err.message });
    });

    proc.once('close', code => {
      console.log(`[Stream ${channelId}] RTSP process closed (code ${code})`);
      this.activeStreams.delete(channelId);
      channelManager.setActive(channelId, false);
      if (sourceConfig.tempSdp && fs.existsSync(sourceConfig.tempSdp)) {
        try { fs.unlinkSync(sourceConfig.tempSdp); } catch {}
      }
      this.emit('stream:ended', { channelId });
    });

    this.activeStreams.set(channelId, {
      proc: { kill: sig => proc.kill(sig), pid: proc.pid },
      source,
      mode: 'webrtc',
      rtspUrl,
      startedAt: new Date().toISOString(),
      tempSdp: sourceConfig.tempSdp || null,
      stopSine: null,
      cleanupInterval: null,
    });

    return { channelId, whepUrl: `/${channelId}/whep`, mode: 'webrtc' };
  }

  stopStream(channelId) {
    const stream = this.activeStreams.get(channelId);
    if (!stream) return false;

    if (stream.proc) {
      try {
        stream.proc.kill('SIGTERM');
      } catch (e) {
        console.warn(`[Stream ${channelId}] Kill error:`, e.message);
      }
    }

    if (stream.tempSdp && fs.existsSync(stream.tempSdp)) {
      try { fs.unlinkSync(stream.tempSdp); } catch (e) {}
    }

    if (stream.stopSine) {
      try { stream.stopSine(); } catch (e) {}
    }

    if (stream.cleanupInterval) {
      clearInterval(stream.cleanupInterval);
    }

    this.activeStreams.delete(channelId);
    channelManager.setActive(channelId, false);
    this._cleanupSegments(channelId);
    this.emit('stream:stopped', { channelId });
    return true;
  }

  restartStream(channelId) {
    const stream = this.activeStreams.get(channelId);
    if (!stream) return false;
    const { source } = stream;
    this.stopStream(channelId);
    setTimeout(() => this.startStream(channelId, source), 500);
    return true;
  }

  startTestTone(channelId, frequency = 440) {
    return this.startStream(channelId, { type: 'testtone', frequency });
  }

  _resolveSource(source) {
    switch (source.type) {
      case 'alsa':
        return {
          input: `hw:${source.card || 0},${source.device || 0}`,
          inputOptions: ['-f alsa', `-ar ${config.audio.sampleRate}`, '-ac 2'],
        };
      case 'pulse':
        return {
          input: source.device || 'default',
          inputOptions: ['-f pulse', `-ar ${config.audio.sampleRate}`, '-ac 2'],
        };
      case 'aes67': {
        const bufSize = Math.floor((config.audio.rtpBufferMs * config.audio.sampleRate * 4) / 1000);
        const localaddr = config.audio.multicastInterface || '';
        const commonOpts = [
          '-protocol_whitelist file,udp,rtp,crypto,data',
          `-buffer_size ${bufSize}`,
          '-probesize 32768',        // 32KB : réduit l'analyse initiale tout en restant stable
          '-analyzeduration 500000',  // 500ms max (vs 5s par défaut)
        ];
        if (localaddr) commonOpts.push(`-localaddr ${localaddr}`);

        if (source.sdpFile) {
          // SDP file path inside container
          return {
            input: source.sdpFile,
            inputOptions: ['-f sdp', ...commonOpts],
          };
        }

        if (source.sdpContent) {
          // SDP content pasted/uploaded — write to temp file
          const tmpPath = path.join(os.tmpdir(), `aes67-${Date.now()}.sdp`);
          fs.writeFileSync(tmpPath, source.sdpContent, 'utf8');
          return {
            input: tmpPath,
            inputOptions: ['-f sdp', ...commonOpts],
            tempSdp: tmpPath,
          };
        }

        // Direct multicast address — generate minimal SDP on-the-fly
        const addr = source.multicastAddress;
        const port = source.port || 5004;
        const channels = source.channels || 2;
        const sampleRate = source.sampleRate || config.audio.sampleRate;
        const encoding = source.encoding || 'L24';
        const payloadType = 96;
        const sdpContent = [
          'v=0',
          `o=- 0 0 IN IP4 ${localaddr || '0.0.0.0'}`,
          `s=AES67`,
          `c=IN IP4 ${addr}/32`,
          't=0 0',
          `m=audio ${port} RTP/AVP ${payloadType}`,
          `a=rtpmap:${payloadType} ${encoding}/${sampleRate}/${channels}`,
          'a=ptime:1',
          'a=recvonly',
        ].join('\r\n') + '\r\n';
        const tmpPath = path.join(os.tmpdir(), `aes67-${Date.now()}.sdp`);
        fs.writeFileSync(tmpPath, sdpContent, 'utf8');
        console.log(`[AES67] Generated SDP for ${addr}:${port} → ${tmpPath}`);
        return {
          input: tmpPath,
          inputOptions: ['-f sdp', ...commonOpts],
          tempSdp: tmpPath,
        };
      }
      case 'rtsp':
        return {
          input: source.url,
          inputOptions: ['-rtsp_transport tcp'],
        };
      case 'file':
        return {
          input: source.path,
          inputOptions: [],
        };
      default:
        throw new Error(`Unknown source type: ${source.type}`);
    }
  }

  _cleanupSegments(channelId) {
    const outputDir = path.join(config.paths.hlsOutput, channelId);
    if (!fs.existsSync(outputDir)) return;
    try {
      const files = fs.readdirSync(outputDir);
      files.forEach(f => {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          fs.unlinkSync(path.join(outputDir, f));
        }
      });
    } catch (e) {
      console.warn(`[Stream ${channelId}] Cleanup error:`, e.message);
    }
  }

  getActiveStreams() {
    const result = [];
    for (const [channelId, stream] of this.activeStreams) {
      const ch = channelManager.getChannel(channelId);
      result.push({
        channelId,
        name: ch?.name || channelId,
        sourceType: stream.source?.type || 'unknown',
        isVod: stream.source?.type === 'file' && stream.proc === null,
        startedAt: stream.startedAt,
      });
    }
    return result;
  }

  isStreaming(channelId) {
    return this.activeStreams.has(channelId);
  }
}

module.exports = new StreamManager();
