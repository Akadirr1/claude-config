FROM python:3.12-slim
RUN pip install --no-cache-dir youtube-transcript-api==1.2.4
WORKDIR /app
COPY server.py .
USER nobody
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')" || exit 1
CMD ["python", "-u", "server.py"]
