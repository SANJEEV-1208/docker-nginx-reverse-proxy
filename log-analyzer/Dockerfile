FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.js ./
EXPOSE 7000
CMD ["node", "index.js"]
