FROM python:3.12-slim
WORKDIR /srv/server
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ /srv/server/
COPY web/ /srv/web/
RUN mkdir -p /srv/downloads /data
ENV AEGIS_DB=/data/aegis.db
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
