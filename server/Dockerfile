FROM node:16

WORKDIR /usr/src/app

EXPOSE 8080

ENV API_PORT=8080
ENV NODE_ENV=production

COPY package.json ./
COPY yarn.lock ./
RUN yarn install

COPY . .

CMD ["yarn", "start"]
