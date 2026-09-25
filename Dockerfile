# syntax=docker/dockerfile:1.7
FROM node:22.14.0-bookworm-slim AS dependencies
WORKDIR /opt/campaigns
COPY package.json package-lock.json ./
COPY packages/campaigns-server/package.json packages/campaigns-server/package.json
COPY packages/campaigns-delivery/package.json packages/campaigns-delivery/package.json
COPY packages/campaigns-bridge/package.json packages/campaigns-bridge/package.json
COPY packages/sendrepute-node/package.json packages/sendrepute-node/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    CAMPAIGNS_PUBLIC_DIR=/opt/campaigns/public \
    CAMPAIGNS_DATA_DIR=/var/lib/sendrepute-campaigns
WORKDIR /opt/campaigns
RUN groupadd --system --gid 10001 campaigns \
 && useradd --system --uid 10001 --gid campaigns --home-dir /var/lib/sendrepute-campaigns campaigns \
 && install -d -o campaigns -g campaigns /var/lib/sendrepute-campaigns
COPY --from=dependencies --chown=campaigns:campaigns /opt/campaigns/node_modules ./node_modules
COPY --chown=campaigns:campaigns packages ./packages
COPY --chown=campaigns:campaigns public ./public
USER campaigns
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/campaigns/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "packages/campaigns-server/dist/cli.js"]
