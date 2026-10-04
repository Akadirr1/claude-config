FROM node:22-alpine
WORKDIR /app
COPY server.mjs store.mjs ./
COPY public ./public
# Kalıcı defter: Coolify'da bu yola bir volume bağla (Storages → /app/data); bağlanmazsa her deploy'da sıfırlanır
RUN mkdir -p /app/data && chown node:node /app/data
ENV WF_DATA_DIR=/app/data
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.mjs"]
