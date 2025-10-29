# ============================================================
# 📦 Multilogin + FamilyTreeNow Automation — Railway Dockerfile
# ============================================================

FROM node:20-bookworm-slim

# ------------------------------------------------------------
# 🧩 System basics only
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first
COPY package*.json ./

# Install dependencies
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy project files
COPY . .

# ------------------------------------------------------------
# 🧱 Runtime settings
# ------------------------------------------------------------
ENV NODE_ENV=production
ENV FTN_DEBUG_PATH=/app/ftn_debug

RUN mkdir -p /app/ftn_debug && chmod 777 /app/ftn_debug

# ------------------------------------------------------------
# 🚀 Start command (Multilogin automation)
# ------------------------------------------------------------
CMD ["node", "mlx_playwright_runner.js"]
