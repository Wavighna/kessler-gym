# Optional static-preview container. Build from the repository root:
# docker build -f extras/Dockerfile -t kessler-preview .
# docker run --rm -p 127.0.0.1:8080:8080 kessler-preview
FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /site
COPY index.html favicon.svg ./

# Static files are readable without a privileged process or writable directory.
USER 10001:10001
EXPOSE 8080
CMD ["python", "-m", "http.server", "8080", "--bind", "0.0.0.0"]
