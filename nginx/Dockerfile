FROM nginx:alpine

# openssl est déjà inclus dans nginx:alpine
RUN apk add --no-cache openssl

COPY entrypoint.sh /entrypoint.sh
COPY audio-access.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /entrypoint.sh

# Le certificat est généré au démarrage dans ce volume
VOLUME ["/etc/nginx/certs"]

ENTRYPOINT ["/entrypoint.sh"]
