# Imagen oficial de Playwright: trae Chromium y todas sus dependencias de sistema.
# La versión de la imagen debe coincidir con la de "playwright" en package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Instalar dependencias (aprovecha caché de capas)
COPY package*.json ./
RUN npm install --omit=dev

# Asegura el navegador correcto para esta versión de Playwright
RUN npx playwright install chromium

# Copiar el resto del código
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
