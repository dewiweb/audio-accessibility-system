FROM node:20-alpine

# Install FFmpeg with full codec support (including RTP/SDP for AES67)
RUN apk add --no-cache \
    ffmpeg \
    tzdata \
    openssl \
    && rm -rf /var/cache/apk/*

# Set timezone and enforce production security checks
ENV TZ=Europe/Paris
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Copy application source
COPY src/ ./src/
COPY public/ ./public/

# Create required directories with correct permissions
RUN mkdir -p public/hls uploads uploads/audio sdp certs

# Non-root user for security
RUN addgroup -S audioapp && adduser -S audioapp -G audioapp \
    && chown -R audioapp:audioapp /app

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Ensure writable dirs are accessible when mounted as Docker volumes
VOLUME ["/app/public/hls", "/app/sdp", "/app/uploads", "/app/certs"]

USER audioapp

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- --no-check-certificate https://localhost:${HTTPS_PORT:-8443}/api/channels || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
