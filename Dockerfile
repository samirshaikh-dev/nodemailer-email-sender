FROM node:20-alpine

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
