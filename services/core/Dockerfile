ARG REGISTRY=
FROM ${REGISTRY}python:3.12-slim
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends fonts-roboto-unhinted fonts-dejavu-core libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY services/core/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/core/app ./app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request as u;u.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
