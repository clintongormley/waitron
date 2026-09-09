# The print agent — one bundled file on node 24. Build from the workspace root:
#   pnpm --filter @waitron/print-agent-app build
#   docker build -t waitron-print-agent apps/print-agent
# Run (LAN setup page on 9110; a USB printer needs its device passed in):
#   docker run -d --name print-agent -v waitron-print-agent:/var/lib/waitron-print-agent \
#     -p 9110:9110 --device /dev/usb/lp0 -e WAITRON_SERVER_URL=https://box.example waitron-print-agent
FROM node:24-alpine
ENV NODE_ENV=production WAITRON_STATE_DIR=/var/lib/waitron-print-agent WAITRON_SETUP_PORT=9110
RUN mkdir -p /var/lib/waitron-print-agent && chown node:node /var/lib/waitron-print-agent
COPY dist/print-agent.js /app/print-agent.js
USER node
VOLUME ["/var/lib/waitron-print-agent"]
EXPOSE 9110
CMD ["node", "/app/print-agent.js"]
