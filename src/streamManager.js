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

  startStream(channelId, source) {
    if (this.activeStreams.has(channelId)) {
      this.stopStream(channelId);
    }

    if (source.type === 'testtone' || source.type === 'silence') {
      return this._startSineStream(channelId, source);
    }

    const outputDir = this.getChannelOutputDir(channelId);
    const playlistPath = path.join(outputDir, 'stream.m3u8');
    const sourceConfig = this._resolveSource(source);

    const isFileSource = source.type === 'file';
    const isLoopFile = isFileSource && source.loop === true;

    // Sources fichier non-loop : mode VOD — tous segments conservés, EXT-X-ENDLIST final.
    // Sources fichier loop : stream_loop N (N répétitions fixes) en mode VOD.
    //   FFmpeg concatène N fois le fichier en un seul passage → playlist VOD complète.
    //   HLS.js lit en mode VOD (baseConfig, pas liveConfig) → lecture fluide sans saut.
    //   À la fin (stream:vod_ended), le client recharge depuis le début (seamless).
    //   N = ceil(LOOP_WINDOW / durée_fichier) — LOOP_WINDOW = 7200s (2h).
    // Sources live (AES67, ALSA…) : fenêtre glissante, delete_segments.
    const LOOP_WINDOW_S = 7200; // 2h par "itération VOD"
    if (isLoopFile) {
      // Durée du fichier via ffprobe (synchrone, une seule fois au démarrage)
      let fileDuration = 60; // valeur par défaut si ffprobe échoue
      try {
        const { execSync } = require('child_process');
        const dur = execSync(
          `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${source.path}"`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        if (parseFloat(dur) > 0) fileDuration = parseFloat(dur);
      } catch {}
      const loopCount = Math.ceil(LOOP_WINDOW_S / fileDuration);
      console.log(`[Stream ${channelId}] Loop VOD: ${loopCount}× ${fileDuration.toFixed(1)}s = ${(loopCount * fileDuration / 3600).toFixed(1)}h`);
      sourceConfig.inputOptions = [`-stream_loop ${loopCount}`, ...(sourceConfig.inputOptions || [])];
    }

    const outputOptions = isFileSource && !isLoopFile ? [
      '-f hls',
      `-hls_time ${config.audio.hlsSegmentDuration}`,
      '-hls_list_size 0',
      '-hls_playlist_type vod',
      '-hls_flags independent_segments',
      '-hls_segment_type mpegts',
      `-hls_segment_filename ${path.join(outputDir, 'seg%05d.ts')}`,
      '-hls_allow_cache 1',
    ] : isLoopFile ? [
      // VOD loop : hls_list_size 0 = tous les segments conservés, EXT-X-ENDLIST à la fin.
      // Le client recharge depuis seg00000 quand stream:vod_ended est reçu.
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
      '-hls_flags delete_segments+append_list+omit_endlist+independent_segments',
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
        if (isFileSource && isLoopFile) {
          // Loop VOD : l'encodage N×fichier est terminé. On émet vod_ended pour que
          // les clients se reconnectent, puis on relance FFmpeg après 2s.
          console.log(`[Stream ${channelId}] Loop VOD complete, restarting...`);
          this.emit('stream:vod_ended', { channelId });
          this.activeStreams.delete(channelId);
          setTimeout(() => {
            if (!this.activeStreams.has(channelId)) {
              this.startStream(channelId, source);
            }
          }, 2000);
        } else if (isFileSource && !isLoopFile) {
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
      '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
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
      case 'testtone': {
        const sineStream = generateSineStream(source.frequency || 440, config.audio.sampleRate);
        return {
          input: sineStream,
          stream: sineStream,
          inputOptions: ['-f s16le', `-ar ${config.audio.sampleRate}`, '-ac 2'],
        };
      }
      case 'silence': {
        const silenceStream = generateSineStream(0, config.audio.sampleRate);
        return {
          input: silenceStream,
          stream: silenceStream,
          inputOptions: ['-f s16le', `-ar ${config.audio.sampleRate}`, '-ac 2'],
        };
      }
      default:
        throw new Error(`Unknown source type: ${source.type}`);
    }
  }

  _pruneOldSegments(channelId, keepCount) {
    const outputDir = path.join(config.paths.hlsOutput, channelId);
    if (!fs.existsSync(outputDir)) return;
    try {
      const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.ts'))
        .sort();
      const toDelete = files.slice(0, Math.max(0, files.length - keepCount - 2));
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(outputDir, f)); } catch (e) {}
      }
    } catch (e) {
      console.warn(`[Stream ${channelId}] Prune error:`, e.message);
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
      result.push({ channelId, source: stream.source, startedAt: stream.startedAt });
    }
    return result;
  }

  isStreaming(channelId) {
    return this.activeStreams.has(channelId);
  }
}

module.exports = new StreamManager();
