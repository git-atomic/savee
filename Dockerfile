# Production image for CMS (Next.js + Payload) with embedded Python worker
# Base includes Node and Playwright browsers
FROM mcr.microsoft.com/playwright:v1.46.0-jammy as base

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PLAYWRIGHT_BROWSERS_PATH=/.cache/ms-playwright \
    PORT=3000

WORKDIR /app

# Install Python and system deps
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ca-certificates && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    python -m pip install --upgrade pip && \
    rm -rf /var/lib/apt/lists/*

# Enable corepack to use pnpm@10 (CMS engines require ^9 || ^10)
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Copy repo
COPY . .

# Install CMS deps and build
WORKDIR /app/apps/cms
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm build

# Install worker Python dependencies
WORKDIR /app/apps/worker
COPY apps/worker/requirements.txt ./requirements.txt
RUN python -m pip install -r requirements.txt

# Ensure Playwright browsers for Python are installed (Chromium is sufficient)
RUN python -m playwright install chromium --with-deps || true

# Expose CMS port
EXPOSE 3000

# Start Payload/Next server
WORKDIR /app/apps/cms
CMD ["pnpm", "start", "-p", "3000"]


