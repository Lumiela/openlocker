# 1단계: 프론트 빌드 (Node)
FROM node:22-slim AS front
WORKDIR /front
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2단계: 실행 이미지 (파이썬)
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=front /front/dist ./dist
RUN useradd --uid 10001 --create-home app \
&& mkdir -p /app/data /app/workspace \
&& chown -R app:app /app/data /app/workspace
USER app
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]