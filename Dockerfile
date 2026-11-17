FROM python:3.12-slim
WORKDIR /srv/server
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ /srv/server/
# Website files: the server also serves them, so http://<server>/ works without GitHub Pages too.
COPY index.html app.html app.js orb.js config.js landing.js landing.css style.css /srv/
RUN mkdir -p /srv/downloads /data
ENV AEGIS_DB=/data/aegis.db
VOLUME /data
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
