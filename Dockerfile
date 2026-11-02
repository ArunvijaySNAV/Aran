# Aran: core (private) and cloud (public) from one image. The command decides which one runs.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY aran-cloud/core/requirements.txt aran-cloud/core/requirements.txt
RUN pip install --no-cache-dir -r aran-cloud/core/requirements.txt requests
COPY aran-cloud/ aran-cloud/
COPY scripts/seed_demo.py scripts/seed_demo.py
ENV PYTHONUNBUFFERED=1 ARAN_DATA_DIR=/srv/data
