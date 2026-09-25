# This dockerfile specifies the environment the production
# code will be run in, along with what files are needed
# for production

# Use an official Node.js runtime as the base image
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Copy .next, public, package.json and package-lock.json
COPY .next/ ./.next/
COPY public/ ./public/
COPY package*.json ./

# Create a system user and give it ownership of the app
RUN groupadd --system nodejs && \
    useradd --system --gid nodejs --create-home --home-dir /home/nodejs nodejs && \
    chown -R nodejs:nodejs /app

# Switch to user for subsequent commands
USER nodejs

# Clean install production dependencies
RUN npm ci --omit=dev

# Expose the port Next.js runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]