# Racing Wars em producao: servidor Node (arquivos estaticos + relay WebSocket das salas).
# Os mapas SRB2Kart (public/tracks/srb2kart) sao locais e ficam fora da imagem (.dockerignore).
FROM node:26.12.1-alpine

ENV NODE_ENV=production PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY shared ./shared
COPY sim ./sim
COPY public ./public
COPY tools/page.js ./tools/page.js

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1
CMD ["node", "server/index.js"]
