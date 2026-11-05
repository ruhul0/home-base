FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/*.js ./
COPY newtab.html newtab.css newtab.js privacy.html privacy.css ./public/
COPY icons ./public/icons

USER node
CMD ["node", "index.js"]
