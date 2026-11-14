FROM node:24-alpine
LABEL org.opencontainers.image.title="Buggie team server" \
      org.opencontainers.image.source="https://github.com/dariovalo18/Buggie"
WORKDIR /app
COPY hub.ts server.ts ./
# the database lives in /data; a fresh named volume takes this owner, so the node user can write it
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
ENV HOST=0.0.0.0 PORT=8791 DB_FILE=/data/team.sqlite
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8791/v1/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.ts"]
