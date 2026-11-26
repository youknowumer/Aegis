FROM python:3.12-slim
WORKDIR /srv/server
COPY server/requirements.txt server/requirements-mms.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Optional local language voices (Meta MMS, non-commercial licence): docker compose build --build-arg WITH_MMS=1
# The models are NOT in the image: they live on the /data volume (docker compose exec aegis python scripts/mms_download.py).
ARG WITH_MMS=0
RUN if [ "$WITH_MMS" = "1" ]; then pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements-mms.txt; fi
COPY server/ /srv/server/
# Website files: the server also serves them, so http://<server>/ works without GitHub Pages too.
COPY *.html *.js *.css favicon.svg favicon.ico site.webmanifest /srv/
COPY icons/ /srv/icons/
COPY fonts/ /srv/fonts/
COPY assets/ /srv/assets/
# Run as a normal user, not root. /data holds the database (mount a volume there).
RUN useradd --system --uid 10001 --home /srv aegis && mkdir -p /srv/downloads /data && chown -R aegis /srv /data
USER aegis
ENV AEGIS_DB=/data/aegis.db AEGIS_MMS_DIR=/data/mms_models PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/readyz' % os.environ.get('PORT','8000'), timeout=4)" || exit 1
# One process on purpose: chats, devices, reminders and rate limits live in memory (see SCALING.md). An async server handles
# thousands of open chats in one process; scale UP first, and read SCALING.md before running more than one copy.
# --ws-max-size caps a single websocket message at 1 MB.
CMD ["sh", "-c", "uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --ws-max-size 1048576 --timeout-graceful-shutdown 15"]
