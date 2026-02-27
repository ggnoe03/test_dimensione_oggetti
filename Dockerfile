# Usa una versione leggera di Python 3.10
FROM python:3.10-slim

# Installa le dipendenze di sistema minime per far funzionare OpenCV
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Hugging Face richiede di far girare l'app come utente non-root per sicurezza
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Copia e installa prima i requirements (ottimizza la velocità di build)
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia tutto il resto del tuo codice
COPY --chown=user . .

# Crea la cartella per i caricamenti e dalle i permessi di scrittura
RUN mkdir -p uploads && chmod 777 uploads

# Hugging Face Spaces ascolta SEMPRE sulla porta 7860
EXPOSE 7860

# Il comando finale per avviare il tuo server FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
