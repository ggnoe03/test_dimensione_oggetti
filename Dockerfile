# Usa un Python leggerissimo solo per fare da server web
FROM python:3.10-slim

WORKDIR /app

# Copia i tuoi file HTML, CSS e JS
COPY . .

# Apri la porta per Hugging Face
EXPOSE 7860

# Avvia un mini-server web integrato in Python
CMD ["python", "-m", "http.server", "7860"]
