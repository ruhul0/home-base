FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/*.js ./
COPY index.html landing.css landing.js newtab.html newtab.css newtab.js admin.html admin.css admin.js privacy.html privacy.css ./public/
COPY icons ./public/icons
COPY assets/store/screenshot-*.png ./public/screens/

USER node
CMD ["node", "index.js"]
