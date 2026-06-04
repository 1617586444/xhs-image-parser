FROM mcr.microsoft.com/playwright/python:v1.60.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./app.py
COPY xhs_parser ./xhs_parser

ENV PYTHONUNBUFFERED=1
ENV XHS_BROWSER_PROFILE_DIR=/tmp/xhs_browser_profile

EXPOSE 8876

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8876}"]
