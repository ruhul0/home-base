FROM node:22-alpine
WORKDIR /tests
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.js ./
USER node
