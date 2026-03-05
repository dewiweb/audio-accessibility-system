FROM node:20-alpine

# Install FFmpeg with full codec support (including RTP/SDP for AES67)
RUN apk add --no-cache \
    ffmpeg \
    tzdata \
    && rm -rf /var/cache/apk/*

# Set timezone
ENV TZ=Europe/Paris

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Copy application source
COPY src/ ./src/
COPY public/ ./public/

# Create required directories
RUN mkdir -p public/hls uploads sdp

# Non-root user for security
RUN addgroup -S audioapp && adduser -S audioapp -G audioapp \
    && chown -R audioapp:audioapp /app

USER audioapp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/channels || exit 1

CMD ["node", "src/server.js"]
