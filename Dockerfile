# Aran console: the team's design (app/ui, served at /), the earlier React console (at /classic)
# and the FastAPI server running the real Aran firewall.
FROM node:22-slim AS web
WORKDIR /web
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/web/ ./
RUN npm run build

FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY app/server/requirements.txt app/server/requirements.txt
RUN pip install --no-cache-dir -r app/server/requirements.txt
COPY research/ research/
# Real Loghub production logs, replayed as the bank's normal traffic
RUN bash research/fetch_data.sh
COPY app/server/ app/server/
COPY app/ui/ app/ui/
COPY --from=web /web/dist app/web/dist
WORKDIR /srv/app/server
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
