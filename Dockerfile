FROM node:22-alpine
WORKDIR /app

ARG BUILD_SHA=local
ARG BUILD_TIME=unknown
ENV NODE_ENV=production \
    PORT=8080 \
    APP_COMMIT=${BUILD_SHA} \
    APP_BUILD_TIME=${BUILD_TIME}

LABEL org.opencontainers.image.source="https://github.com/NoName4Me/marketplace-e2e-web"
LABEL org.opencontainers.image.description="Marketplace E2E web application"

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:8080/readyz").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

CMD ["node", "src/server.mjs"]
