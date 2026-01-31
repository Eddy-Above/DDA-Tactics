FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files from app directory
COPY app/package.json app/package-lock.json ./

# Install dependencies with npm
RUN npm ci

# Copy source code from app directory
COPY app/ .

# Build the application
RUN npm run build

# Expose the port
EXPOSE 3000

# Set environment variable for host binding
ENV HOST=0.0.0.0
ENV PORT=3000

# Start command - push db schema then start server
CMD ["sh", "-c", "npm run db:push && npm run start"]
