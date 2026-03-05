const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const os = require('os');
const config = require('./config');
const channelManager = require('./channelManager');

function generateSineStream(frequency = 440, sampleRate = 48000) {
  const stream = new PassThrough();
  const channels = 2;
  const bytesPerSample = 2;
  const chunkMs = 100;
  const samplesPerChunk = Math.floor(sampleRate * chunkMs / 1000);
  const bufSize = samplesPerChunk * channels * bytesPerSample;
  let phase = 0;
  const phaseInc = (2 * Math.PI * frequency) / sampleRate;
  let running = true;

  const write = () => {
    if (!running) return;
    const buf = Buffer.alloc(bufSize);
    for (let i = 0; i < samplesPerChunk; i++) {
      const sample = Math.round(Math.sin(phase) * 0x6FFF);
      buf.writeInt16LE(sample, i * channels * bytesPerSample);
      buf.writeInt16LE(sample, i * channels * bytesPerSample + bytesPerSample);
      phase += phaseInc;
    }
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    const ok = stream.push(buf);
    if (ok) setTimeout(write, chunkMs);
    else stream.once('drain', write);
  };

  stream.on('close', () => { running = false; });
  setTimeout(write, 0);
  return stream;
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

    const outputDir = this.getChannelOutputDir(channelId);
    const playlistPath = path.join(outputDir, 'stream.m3u8');

    const sourceConfig = this._resolveSource(source);

    const proc = ffmpeg(sourceConfig.input)
      .inputOptions(sourceConfig.inputOptions)
      .audioCodec('libopus')
      .audioBitrate(config.audio.bitrate)
      .audioFrequency(config.audio.sampleRate)
      .audioChannels(2)
      .outputOptions([
        '-f hls',
        `-hls_time ${config.audio.hlsSegmentDuration}`,
        `-hls_list_size ${config.audio.hlsListSize}`,
        '-hls_flags delete_segments+append_list+omit_endlist+independent_segments',
        '-hls_segment_type mpegts',
        `-hls_segment_filename ${path.join(outputDir, 'seg%05d.ts')}`,
        '-hls_allow_cache 0',
        '-movflags +faststart',
      ])
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
        console.log(`[Stream ${channelId}] Ended`);
        this.activeStreams.delete(channelId);
        channelManager.setActive(channelId, false);
        this.emit('stream:ended', { channelId });
      });

    proc.run();
    this.activeStreams.set(channelId, { proc, source, startedAt: new Date().toISOString(), tempSdp: sourceConfig.tempSdp || null });

    return { channelId, playlistUrl: `/hls/${channelId}/stream.m3u8` };
  }

  stopStream(channelId) {
    const stream = this.activeStreams.get(channelId);
    if (!stream) return false;

    try {
      stream.proc.kill('SIGTERM');
    } catch (e) {
      console.warn(`[Stream ${channelId}] Kill error:`, e.message);
    }

    if (stream.tempSdp && fs.existsSync(stream.tempSdp)) {
      try { fs.unlinkSync(stream.tempSdp); } catch (e) {}
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
          inputOptions: ['-stream_loop -1'],
        };
      case 'testtone': {
        const sineStream = generateSineStream(source.frequency || 440, config.audio.sampleRate);
        return {
          input: sineStream,
          inputOptions: [
            '-f s16le',
            `-ar ${config.audio.sampleRate}`,
            '-ac 2',
          ],
        };
      }
      case 'silence': {
        const silenceStream = generateSineStream(0, config.audio.sampleRate);
        return {
          input: silenceStream,
          inputOptions: ['-f s16le', `-ar ${config.audio.sampleRate}`, '-ac 2'],
        };
      }
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
      result.push({ channelId, source: stream.source, startedAt: stream.startedAt });
    }
    return result;
  }

  isStreaming(channelId) {
    return this.activeStreams.has(channelId);
  }
}

module.exports = new StreamManager();
