const { v4: uuidv4 } = require('uuid');
const channelManager = require('./channelManager');
const streamManager = require('./streamManager');

class WsManager {
  constructor() {
    this.clients = new Map();
  }

  attach(expressWs, app) {
    app.ws('/ws', (ws, req) => {
      const clientId = uuidv4();
      const isAdmin = req.query.admin === 'true';
      this.clients.set(clientId, { ws, isAdmin, channelId: null, joinedAt: Date.now() });

      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        channels: channelManager.getPublicChannels(),
        stats: channelManager.getStats(),
      }));

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          this._handleMessage(clientId, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(clientId);
        if (client && client.channelId) {
          channelManager.removeListener_(client.channelId, clientId);
        }
        this.clients.delete(clientId);
        this._broadcastStats();
      });

      ws.on('error', (err) => {
        console.error(`[WS ${clientId}] Error:`, err.message);
        this.clients.delete(clientId);
      });
    });

    channelManager.on('channel:created', () => this._broadcastToAdmins('channels:update', channelManager.getStats()));
    channelManager.on('channel:updated', () => {
      this._broadcastToAdmins('channels:update', channelManager.getStats());
      this._broadcastToAll('public:channels', channelManager.getPublicChannels());
    });
    channelManager.on('channel:deleted', () => {
      this._broadcastToAdmins('channels:update', channelManager.getStats());
      this._broadcastToAll('public:channels', channelManager.getPublicChannels());
    });
    channelManager.on('listener:joined', (data) => this._broadcastStats());
    channelManager.on('listener:left', (data) => this._broadcastStats());
    streamManager.on('stream:started', (data) => this._broadcastToAdmins('stream:started', data));
    streamManager.on('stream:stopped', (data) => this._broadcastToAdmins('stream:stopped', data));
    streamManager.on('stream:error', (data) => this._broadcastToAdmins('stream:error', data));
  }

  _handleMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'join:channel': {
        if (client.channelId) {
          channelManager.removeListener_(client.channelId, clientId);
        }
        client.channelId = msg.channelId;
        channelManager.addListener_(msg.channelId, clientId);
        client.ws.send(JSON.stringify({ type: 'joined', channelId: msg.channelId }));
        break;
      }
      case 'leave:channel': {
        if (client.channelId) {
          channelManager.removeListener_(client.channelId, clientId);
          client.channelId = null;
        }
        client.ws.send(JSON.stringify({ type: 'left' }));
        break;
      }
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;
      default:
        client.ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
    }
  }

  _broadcastToAll(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) client.ws.send(msg);
    }
  }

  _broadcastToAdmins(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const [, client] of this.clients) {
      if (client.isAdmin && client.ws.readyState === 1) client.ws.send(msg);
    }
  }

  _broadcastStats() {
    const stats = channelManager.getStats();
    this._broadcastToAdmins('stats:update', stats);
    this._broadcastToAll('public:channels', channelManager.getPublicChannels());
  }

  getConnectedCount() {
    return this.clients.size;
  }
}

module.exports = new WsManager();
