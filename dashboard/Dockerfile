FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.mjs"]
