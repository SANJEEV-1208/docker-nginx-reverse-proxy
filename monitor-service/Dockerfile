FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.js ./
EXPOSE 6000
CMD ["node", "index.js"]
