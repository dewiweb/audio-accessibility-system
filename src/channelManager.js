const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const PERSIST_PATH = process.env.CHANNELS_FILE || path.join(__dirname, '../uploads/channels.json');

class ChannelManager extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
    this.listeners = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(PERSIST_PATH)) {
        const data = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'));
        for (const ch of data) {
          this.channels.set(ch.id, { ...ch, active: false, listenerCount: 0 });
        }
        console.log(`[ChannelManager] Loaded ${this.channels.size} channel(s) from disk`);
      }
    } catch (e) {
      console.warn('[ChannelManager] Could not load channels:', e.message);
    }
  }

  _save() {
    try {
      const dir = path.dirname(PERSIST_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.channels.values());
      fs.writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[ChannelManager] Could not save channels:', e.message);
    }
  }

  createChannel({ name, description, language, icon, color, source }) {
    const id = uuidv4();
    const channel = {
      id,
      name,
      description: description || '',
      language: language || 'fr',
      icon: icon || '🎧',
      color: color || '#4f46e5',
      source,
      active: false,
      listenerCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.channels.set(id, channel);
    this._save();
    this.emit('channel:created', channel);
    return channel;
  }

  updateChannel(id, updates) {
    const channel = this.channels.get(id);
    if (!channel) return null;
    const updated = { ...channel, ...updates, id };
    this.channels.set(id, updated);
    this._save();
    this.emit('channel:updated', updated);
    return updated;
  }

  deleteChannel(id) {
    const channel = this.channels.get(id);
    if (!channel) return false;
    this.channels.delete(id);
    this._save();
    this.emit('channel:deleted', { id });
    return true;
  }

  getChannel(id) {
    return this.channels.get(id) || null;
  }

  getAllChannels() {
    return Array.from(this.channels.values());
  }

  getPublicChannels() {
    return this.getAllChannels().filter(c => c.active).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      language: c.language,
      icon: c.icon,
      color: c.color,
      listenerCount: c.listenerCount,
    }));
  }

  setActive(id, active) {
    return this.updateChannel(id, { active });
  }

  addListener_(channelId, listenerId) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    if (!this.listeners.has(channelId)) this.listeners.set(channelId, new Set());
    this.listeners.get(channelId).add(listenerId);
    const count = this.listeners.get(channelId).size;
    this.updateChannel(channelId, { listenerCount: count });
    this.emit('listener:joined', { channelId, listenerId, count });
  }

  removeListener_(channelId, listenerId) {
    if (!this.listeners.has(channelId)) return;
    this.listeners.get(channelId).delete(listenerId);
    const count = this.listeners.get(channelId).size;
    this.updateChannel(channelId, { listenerCount: count });
    this.emit('listener:left', { channelId, listenerId, count });
  }

  removeListenerFromAll(listenerId) {
    for (const [channelId] of this.listeners) {
      this.removeListener_(channelId, listenerId);
    }
  }

  getStats() {
    const channels = this.getAllChannels();
    return {
      totalChannels: channels.length,
      activeChannels: channels.filter(c => c.active).length,
      totalListeners: channels.reduce((sum, c) => sum + c.listenerCount, 0),
      channels: channels.map(c => ({
        id: c.id,
        name: c.name,
        active: c.active,
        listenerCount: c.listenerCount,
      })),
    };
  }
}

module.exports = new ChannelManager();
